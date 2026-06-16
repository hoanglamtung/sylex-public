// emailService.js — #146
// AI-powered email drafting and email thread summarization for business mode.
// Uses DeepSeek-V3.1 via the ChatService router (mode='business').
// Premium-only. No email content is stored server-side beyond the request lifecycle.

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

export const TONES = ['formal', 'professional', 'concise'];

const MAX_PROMPT_CHARS  = 2_000;
const MAX_THREAD_CHARS  = 10_000;

class EmailService {
  constructor() {
    // Prefer DeepSeek for business tasks; fall back to Gemini if not configured.
    this.deepSeek = new DeepSeekService();
    this.gemini   = null;

    if (!this.deepSeek.isConfigured) {
      try {
        this.gemini = new GeminiService();
        logger.info('EmailService: DeepSeek not configured — using Gemini fallback');
      } catch (err) {
        logger.error('EmailService: No LLM provider available', { error: err.message });
      }
    } else {
      logger.info('EmailService initialized with DeepSeek');
    }
  }

  /**
   * Call the best available LLM with a single-turn prompt.
   * @private
   */
  async _call(systemPrompt, userPrompt, isPremium) {
    const messages = [
      { role: 'system',  content: systemPrompt },
      { role: 'user',    content: userPrompt   },
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
   * Generate an email draft (subject + body) from a prompt.
   *
   * @param {string}  uid       - Firebase UID (for logging/rate-limit extensions)
   * @param {string}  prompt    - User's intent / voice transcript
   * @param {string}  tone      - One of TONES (default: 'professional')
   * @param {boolean} isPremium - Must be true
   * @returns {Promise<{ subject: string, body: string }>}
   */
  async draftEmail(uid, prompt, tone = 'professional', isPremium = false) {
    if (!isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Email drafting requires a premium subscription', 403);
    }
    if (!TONES.includes(tone)) {
      throw new AppError('INVALID_REQUEST', `Invalid tone. Must be one of: ${TONES.join(', ')}`, 400);
    }
    if (!prompt || typeof prompt !== 'string') {
      throw new AppError('INVALID_REQUEST', 'prompt is required', 400);
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new AppError('INVALID_REQUEST', `prompt must be ≤ ${MAX_PROMPT_CHARS} characters`, 400);
    }

    const systemPrompt = `You are a professional email writer. Generate a ${tone} email based on the user's input.
Always respond with valid JSON in exactly this format (no markdown, no extra keys):
{ "subject": "<email subject line>", "body": "<full email body, use \\n for line breaks>" }
Rules:
- Keep subject concise (≤ 10 words)
- Body should match the requested tone
- Never include placeholder brackets like [Name] unless explicitly part of the prompt
- Do not include any explanation outside the JSON`;

    try {
      const { content } = await this._call(systemPrompt, prompt, isPremium);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.subject || !parsed.body) throw new Error('Missing subject or body fields');

      logger.info('Email draft generated', { uid, tone, promptLength: prompt.length });
      return { subject: parsed.subject, body: parsed.body };
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('Email draft failed', { uid, error: err.message });
      throw new AppError('PROVIDER_ERROR', 'Failed to generate email draft', 503);
    }
  }

  /**
   * Summarize an email thread — extract sender, key asks, deadlines, and a summary.
   *
   * @param {string}  uid        - Firebase UID
   * @param {string}  threadText - Pasted email thread text
   * @param {boolean} isPremium  - Must be true
   * @returns {Promise<{ sender: string, keyAsks: string[], deadlines: string[], summary: string }>}
   */
  async summarizeThread(uid, threadText, isPremium = false) {
    if (!isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Email summarization requires a premium subscription', 403);
    }
    if (!threadText || typeof threadText !== 'string') {
      throw new AppError('INVALID_REQUEST', 'threadText is required', 400);
    }
    if (threadText.length > MAX_THREAD_CHARS) {
      throw new AppError('INVALID_REQUEST', `threadText must be ≤ ${MAX_THREAD_CHARS} characters`, 400);
    }

    const systemPrompt = `You are an expert at analyzing email threads. Extract the key information and respond with valid JSON in exactly this format (no markdown, no extra keys):
{
  "sender": "<primary sender name or email>",
  "keyAsks": ["<ask 1>", "<ask 2>"],
  "deadlines": ["<deadline 1>"],
  "summary": "<2–4 sentence summary of the thread>"
}
Rules:
- keyAsks: list what the sender is requesting or expecting (empty array if none)
- deadlines: list any explicit dates or deadlines mentioned (empty array if none)
- summary: concise, neutral, factual
- Do not include any explanation outside the JSON`;

    try {
      const { content } = await this._call(systemPrompt, threadText, isPremium);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);

      logger.info('Email thread summarized', { uid, threadLength: threadText.length });
      return {
        sender:    parsed.sender    ?? '',
        keyAsks:   parsed.keyAsks   ?? [],
        deadlines: parsed.deadlines ?? [],
        summary:   parsed.summary   ?? '',
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error('Email summarization failed', { uid, error: err.message });
      throw new AppError('PROVIDER_ERROR', 'Failed to summarize email thread', 503);
    }
  }
}

export default EmailService;
