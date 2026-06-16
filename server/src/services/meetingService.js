// meetingService.js — #147
// AI-powered meeting notes extraction for business mode.
// Extracts key decisions, action items (with owner + deadline), and open questions
// from spoken transcripts or pasted meeting notes.
// Uses DeepSeek-V3.1 via the business mode router, with Gemini fallback.
// Premium-only. No transcript is stored server-side beyond the request lifecycle.

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import DeepSeekService from './deepseekService.js';
import GeminiService from './geminiService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

// ~30 minutes of speech at ~130 words/min ≈ 3,900 words ≈ 5,000 tokens
// 50,000 chars is a safe ceiling that covers that comfortably.
const MAX_TRANSCRIPT_CHARS = 50_000;

class MeetingService {
  constructor() {
    this.deepSeek = new DeepSeekService();
    this.gemini   = null;

    if (!this.deepSeek.isConfigured) {
      try {
        this.gemini = new GeminiService();
        logger.info('MeetingService: DeepSeek not configured — using Gemini fallback');
      } catch (err) {
        logger.error('MeetingService: No LLM provider available', { error: err.message });
      }
    } else {
      logger.info('MeetingService initialized with DeepSeek');
    }
  }

  /** @private */
  async _call(systemPrompt, userPrompt, isPremium) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ];

    if (this.deepSeek.isConfigured) {
      return this.deepSeek.chat(messages, 'en-US', isPremium);
    }
    if (this.gemini) {
      return this.gemini.chat(messages, 'en-US', isPremium, null);
    }
    throw new AppError('PROVIDER_ERROR', 'No LLM provider configured', 503);
  }

  /**
   * Extract structured notes from a meeting transcript.
   *
   * @param {string}  uid        - Firebase UID (for logging)
   * @param {string}  transcript - Meeting notes or spoken transcript
   * @param {boolean} isPremium  - Must be true
   * @returns {Promise<{
   *   decisions:    string[],
   *   actionItems:  Array<{ task: string, owner?: string, deadline?: string }>,
   *   openQuestions: string[],
   *   plainText:    string
   * }>}
   */
  async extractMeetingNotes(uid, transcript, isPremium = false) {
    if (!isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Meeting extraction requires a premium subscription', 403);
    }
    if (!transcript || typeof transcript !== 'string') {
      throw new AppError('INVALID_REQUEST', 'transcript is required', 400);
    }
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      throw new AppError(
        'INVALID_REQUEST',
        `transcript must be ≤ ${MAX_TRANSCRIPT_CHARS} characters (approx. 30 minutes)`,
        400,
      );
    }

    const systemPrompt = `You are an expert meeting analyst. Extract structured notes from the meeting transcript and respond with valid JSON in exactly this format (no markdown, no extra keys):
{
  "decisions": ["<decision 1>", "<decision 2>"],
  "actionItems": [
    { "task": "<task description>", "owner": "<name or null>", "deadline": "<date/time or null>" }
  ],
  "openQuestions": ["<question 1>"]
}
Rules:
- decisions: concrete decisions that were made during the meeting (empty array if none)  
- actionItems: specific tasks assigned or implied with optional owner and deadline; use null for missing fields
- openQuestions: unresolved questions or topics flagged for follow-up (empty array if none)
- Keep each item concise and factual — do not invent information not present in the transcript
- Do not include any explanation outside the JSON`;

    try {
      const { content } = await this._call(systemPrompt, transcript, isPremium);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);

      const decisions      = parsed.decisions      ?? [];
      const actionItems    = parsed.actionItems    ?? [];
      const openQuestions  = parsed.openQuestions  ?? [];

      // Build plain-text export for clipboard copy on the client
      const plainText = this._buildPlainText(decisions, actionItems, openQuestions);

      logger.info('Meeting notes extracted', {
        uid,
        transcriptLength: transcript.length,
        decisions: decisions.length,
        actionItems: actionItems.length,
        openQuestions: openQuestions.length,
      });

      return { decisions, actionItems, openQuestions, plainText };
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('Meeting extraction failed', { uid, error: err.message });
      throw new AppError('PROVIDER_ERROR', 'Failed to extract meeting notes', 503);
    }
  }

  /** @private */
  _buildPlainText(decisions, actionItems, openQuestions) {
    const lines = [];

    if (decisions.length) {
      lines.push('DECISIONS');
      decisions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
      lines.push('');
    }

    if (actionItems.length) {
      lines.push('ACTION ITEMS');
      actionItems.forEach((a, i) => {
        let line = `${i + 1}. ${a.task}`;
        if (a.owner)    line += ` — Owner: ${a.owner}`;
        if (a.deadline) line += ` — Due: ${a.deadline}`;
        lines.push(line);
      });
      lines.push('');
    }

    if (openQuestions.length) {
      lines.push('OPEN QUESTIONS');
      openQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    }

    return lines.join('\n').trim();
  }
}

export default MeetingService;
