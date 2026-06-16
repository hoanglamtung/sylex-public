/**
 * PremiumService — #128
 *
 * Server-side logic for premium-only features:
 *   1. Summaries   — summarise a conversation or spoken document (≤ 2000 tokens input)
 *   2. Planning    — AI-assisted trip/task planning via voice input → structured plan
 *   3. Long-form   — multi-step task orchestration with a 5-minute session cap
 *
 * All methods gate on isPremium. The flag MUST be passed from req.user (Firebase
 * Auth custom claim validation) — never from raw client input.
 *
 * Response shape is voice-ready JSON:
 *   { intent, action, parameters, text }
 */

import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import GeminiService from './geminiService.js';

// 5-minute cap for long-form task sessions (ms)
const LONG_FORM_SESSION_CAP_MS = 5 * 60 * 1000;

class PremiumService {
  constructor() {
    if (process.env.NODE_ENV === 'test') {
      this.geminiService = null;
      return;
    }
    this.geminiService = new GeminiService();
    // Track active long-form session start times keyed by sessionId
    this._longFormSessions = new Map();
  }

  // ─── Gate helper ───────────────────────────────────────────────────────────

  _requirePremium(isPremium) {
    if (!isPremium) {
      throw new AppError(
        'PREMIUM_REQUIRED',
        'This feature requires a premium subscription.',
        403,
      );
    }
  }

  // ─── 1. Summaries ──────────────────────────────────────────────────────────

  /**
   * Summarise a conversation transcript or spoken document.
   *
   * @param {string}  text       - Raw transcript / document text (max ~2000 tokens)
   * @param {string}  language   - BCP-47 language code
   * @param {boolean} isPremium  - Server-validated premium flag
   * @returns {Promise<{ summary: string, keyPoints: string[] }>}
   */
  async summarise(text, language, isPremium) {
    this._requirePremium(isPremium);

    if (!text || text.trim().length === 0) {
      throw new AppError('INVALID_REQUEST', 'Text is required for summarisation.', 400);
    }

    const messages = [
      {
        role: 'system',
        content: `You are a concise summarisation assistant. Always respond with valid JSON in this exact shape:
{
  "intent": "summarise",
  "action": "none",
  "parameters": { "keyPoints": ["<point 1>", "<point 2>", "..."] },
  "text": "<2–4 sentence spoken summary>"
}
Rules:
- "text" must be natural, voice-ready, under 80 words.
- "keyPoints" must be an array of 3–7 short bullet strings.
- Never include markdown or explanations outside the JSON.
- Respond ONLY in the language indicated by the device.`,
      },
      {
        role: 'user',
        content: `Please summarise the following:\n\n${text}`,
      },
    ];

    const result = await this._callLLM(messages, language);
    const parsed = this._parse(result.content);

    logger.info('PremiumService.summarise completed', { language, model: result.model });

    return {
      summary: parsed.text,
      keyPoints: parsed.parameters?.keyPoints ?? [],
    };
  }

  // ─── 2. Planning ───────────────────────────────────────────────────────────

  /**
   * Generate an AI-assisted plan from a voice/text prompt.
   * Returns a structured, voice-ready plan with ordered steps.
   *
   * @param {string}  prompt     - User's planning request (e.g. "plan a road trip to Munich")
   * @param {string}  language   - BCP-47 language code
   * @param {boolean} isPremium  - Server-validated premium flag
   * @returns {Promise<{ title: string, steps: string[], text: string }>}
   */
  async plan(prompt, language, isPremium) {
    this._requirePremium(isPremium);

    if (!prompt || prompt.trim().length === 0) {
      throw new AppError('INVALID_REQUEST', 'A planning prompt is required.', 400);
    }

    const messages = [
      {
        role: 'system',
        content: `You are a planning assistant. Always respond with valid JSON in this exact shape:
{
  "intent": "plan",
  "action": "none",
  "parameters": { "title": "<plan title>", "steps": ["<step 1>", "<step 2>", "..."] },
  "text": "<spoken introduction to the plan, under 60 words>"
}
Rules:
- "steps" must be an ordered array of 3–10 concise action strings.
- "text" is what the assistant reads aloud before listing the steps.
- Never include markdown or explanations outside the JSON.
- Respond ONLY in the language indicated by the device.`,
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    const result = await this._callLLM(messages, language);
    const parsed = this._parse(result.content);

    logger.info('PremiumService.plan completed', { language, model: result.model });

    return {
      title: parsed.parameters?.title ?? '',
      steps: parsed.parameters?.steps ?? [],
      text: parsed.text,
    };
  }

  // ─── 3. Long-form task orchestration ───────────────────────────────────────

  /**
   * Parse a multi-step voice intent and return an ordered list of sub-tasks.
   * Enforces a 5-minute session cap per sessionId.
   *
   * @param {string}  prompt     - Multi-step request (e.g. "plan route, check weather, add to calendar")
   * @param {string}  sessionId  - Used to enforce the 5-min session cap
   * @param {string}  language   - BCP-47 language code
   * @param {boolean} isPremium  - Server-validated premium flag
   * @returns {Promise<{ tasks: Array<{order:number, task:string, action:string}>, text: string }>}
   */
  async orchestrate(prompt, sessionId, language, isPremium) {
    this._requirePremium(isPremium);

    if (!prompt || prompt.trim().length === 0) {
      throw new AppError('INVALID_REQUEST', 'A task prompt is required.', 400);
    }

    // Enforce 5-minute session cap
    const now = Date.now();
    const sessionStart = this._longFormSessions.get(sessionId);
    if (sessionStart) {
      if (now - sessionStart > LONG_FORM_SESSION_CAP_MS) {
        this._longFormSessions.delete(sessionId);
        throw new AppError(
          'SESSION_CAP_EXCEEDED',
          'The 5-minute long-form session limit has been reached. Please start a new session.',
          429,
        );
      }
    } else {
      this._longFormSessions.set(sessionId, now);
      // Auto-expire after cap to avoid memory leaks
      setTimeout(() => this._longFormSessions.delete(sessionId), LONG_FORM_SESSION_CAP_MS);
    }

    const messages = [
      {
        role: 'system',
        content: `You are a multi-step task orchestration assistant. Always respond with valid JSON:
{
  "intent": "orchestrate",
  "action": "none",
  "parameters": {
    "tasks": [
      { "order": 1, "task": "<task description>", "action": "<navigate|search|draft|reminder|none>" },
      ...
    ]
  },
  "text": "<spoken confirmation of the plan, under 60 words>"
}
Rules:
- Break the user's request into 2–8 ordered sub-tasks.
- Each "action" must be one of: navigate, search, draft, reminder, none.
- "text" is what the assistant reads aloud.
- Never include markdown or explanations outside the JSON.
- Respond ONLY in the language indicated by the device.`,
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    const result = await this._callLLM(messages, language);
    const parsed = this._parse(result.content);

    logger.info('PremiumService.orchestrate completed', {
      sessionId,
      language,
      model: result.model,
      taskCount: parsed.parameters?.tasks?.length ?? 0,
    });

    return {
      tasks: parsed.parameters?.tasks ?? [],
      text: parsed.text,
    };
  }

  /**
   * Explicitly end a long-form session (clears the 5-min cap timer).
   */
  endLongFormSession(sessionId) {
    this._longFormSessions.delete(sessionId);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async _callLLM(messages, language) {
    if (process.env.NODE_ENV === 'test') {
      return {
        content: '{"intent":"test","action":"none","parameters":{},"text":"Test response"}',
        model: 'test',
      };
    }
    // Premium features always use the premium model
    return this.geminiService.chat(messages, language, /* isPremium= */ true);
  }

  _parse(responseText) {
    try {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_) {
      // fall through to default
    }
    return { intent: 'unknown', action: 'none', parameters: {}, text: responseText };
  }
}

export default PremiumService;
