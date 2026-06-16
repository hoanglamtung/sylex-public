// geminiService.js
// Vertex AI / Gemini backend for Assistant Pro — Issue #134
//
// Architecture:
//   chat() routes all requests through one of two paths:
//
//   1. Grounding path (_chatWithGrounding)  — queries that need real-time data
//      Phase 1: googleSearch grounding model → raw factual prose (max 512 tokens)
//      Phase 2: structured-output model → valid JSON using facts as context
//      (responseMimeType + responseSchema cannot be combined with googleSearch,
//       so the two phases are kept strictly separate)
//
//   2. Structured path (_chatStructured)  — all other queries
//      Single call with responseMimeType:'application/json' + responseSchema.
//      Gemini is constrained at token level — markdown fences are impossible.
//
// Both paths share _runStructuredCall for the JSON-formatting step and
// _extractCandidate for safety-check + multi-part joining.
// Output shape: { content: string, usage: object|null, model: string }

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { VertexAI } from '@google-cloud/vertexai';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

/**
 * GeminiService
 * Wraps Vertex AI Generative AI for chat completions.
 * Interface mirrors chatService.callLLM() so the provider router in
 * ChatService can swap backends transparently.
 *
 * Model routing (server-side only — NEVER trust client claims):
 *   isPremium = false → VERTEX_AI_MODEL_FREE    (required — set in .env)
 *   isPremium = true  → VERTEX_AI_MODEL_PREMIUM (required — set in .env)
 *
 * Response format:
 *   All paths guarantee valid JSON output. Non-grounding queries use
 *   responseMimeType:'application/json' + responseSchema (token-level enforcement).
 *   Grounding queries use a two-phase pipeline — Phase 1 retrieves facts via
 *   Google Search, Phase 2 formats them via structured output — because Vertex AI
 *   does not allow responseSchema to be combined with googleSearch tools.
 *
 * Retry:
 *   _withRetry() provides exponential-backoff retry on RESOURCE_EXHAUSTED / 429
 *   errors only. All other errors propagate immediately.
 */
class GeminiService {
  constructor() {
    this.modelFree    = process.env.VERTEX_AI_MODEL_FREE;
    this.modelPremium = process.env.VERTEX_AI_MODEL_PREMIUM;
    this.groundingCacheTtlMs = Math.max(0, parseInt(process.env.GROUNDING_PHASE1_CACHE_TTL_MS || '0', 10) || 0);
    this.groundingCacheMaxEntries = Math.max(1, parseInt(process.env.GROUNDING_PHASE1_CACHE_MAX_ENTRIES || '200', 10) || 200);
    this.groundingFactsMaxChars = Math.max(400, parseInt(process.env.GROUNDING_FACTS_MAX_CHARS || '1800', 10) || 1800);
    this.structuredMaxOutputTokens = Math.max(256, parseInt(process.env.STRUCTURED_MAX_OUTPUT_TOKENS || '1024', 10) || 1024);

    // Phase 1 token budget: generous enough to capture full search result summaries.
    // Thinking models (Gemini 2.5 Pro) consume thinking tokens from this budget, so
    // we default to 768 rather than the old hardcoded 512. (#292)
    this.groundingPhase1MaxOutputTokens = Math.max(256, parseInt(process.env.GROUNDING_PHASE1_MAX_OUTPUT_TOKENS || '768', 10) || 768);
    // Phase 2 token budget: must accommodate thinking tokens (Gemini 2.5 Pro) PLUS
    // the JSON response.  Thinking alone can consume 500-1000 tokens, so the old
    // default of 768 caused MAX_TOKENS truncation on premium queries.  Default 2048
    // gives thinking room to breathe while keeping the response well within limits. (#292)
    this.groundingPhase2MaxOutputTokens = Math.max(512, parseInt(process.env.GROUNDING_PHASE2_MAX_OUTPUT_TOKENS || '2048', 10) || 2048);
    this.streamRetryMaxAttempts = Math.max(1, parseInt(process.env.STREAM_RETRY_MAX_ATTEMPTS || '2', 10) || 2);
    this.streamRetryBaseDelayMs = Math.max(50, parseInt(process.env.STREAM_RETRY_BASE_DELAY_MS || '300', 10) || 300);
    // Hard cap on total ms spent waiting across all retry attempts for stream-path calls.
    // Prevents rate-limit backoff from consuming the client's 15s timeout window (#293).
    this.streamRetryTotalBudgetMs = Math.max(500, parseInt(process.env.STREAM_RETRY_TOTAL_BUDGET_MS || '3000', 10) || 3000);
    this.streamFirstDeltaTimeoutMs = Math.max(3000, parseInt(process.env.STREAM_FIRST_DELTA_TIMEOUT_MS || '12000', 10) || 12000);
    this.streamTextOnly = String(process.env.STREAM_TEXT_ONLY || '').toLowerCase() === 'true';
    this.streamTextMaxOutputTokens = Math.max(128, parseInt(process.env.STREAM_TEXT_MAX_OUTPUT_TOKENS || '768', 10) || 768);
    // Default raised from 256 to 512: grounding payloads up to ~2400 chars
    // (~600 tokens) require more headroom for the model to finish a full sentence
    // without hitting MAX_TOKENS truncation. (#273 run 3 — factsLength 2434 truncated)
    this.groundingTextMaxOutputTokens = Math.max(96, parseInt(process.env.GROUNDING_TEXT_MAX_OUTPUT_TOKENS || '512', 10) || 512);
    this.groundingCache = new Map();
    // In-flight promise map for parallel grounding prefetch (#291).
    // Maps cacheKey → Promise<string> so concurrent calls sharing the same query
    // reuse a single Phase 1 call rather than launching duplicates.
    this._groundingPrefetchMap = new Map();

    if (process.env.NODE_ENV === 'test') {
      this.vertexAI = null;
      logger.info('GeminiService initialized in test mode');
      return;
    }

    this._init();
  }

  _containsSensitiveCacheBypassHint(text) {
    if (!text) return false;
    return /\b(password|passcode|pin|otp|one[-\s]?time\s+code|secret|token|api\s*key|credit\s*card|card\s*number|cvv|iban|bank\s*account|ssn|social\s+security|passwort|konto)\b/i.test(text);
  }

  _normalizeCacheQuery(text) {
    return (text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  _buildGroundingCacheKey(userQuery, language, modelName) {
    if (this.groundingCacheTtlMs <= 0) return null;
    const normalizedQuery = this._normalizeCacheQuery(userQuery);
    if (!normalizedQuery) return null;
    if (this._containsSensitiveCacheBypassHint(normalizedQuery)) return null;
    return `${language || 'unknown'}|${modelName || 'unknown'}|${normalizedQuery}`;
  }

  /**
   * Dedup map key for _groundingPrefetchMap — always content-based, independent
   * of whether the persistent grounding cache (TTL) is enabled. (#291)
   *
   * Unlike _buildGroundingCacheKey this never returns null when the cache is
   * disabled (TTL=0), so concurrent users never collide on a null key.
   *
   * @returns {string|null} null only when the query is empty or sensitive.
   */
  _buildPrefetchMapKey(userQuery, language, modelName) {
    const normalized = this._normalizeCacheQuery(userQuery);
    if (!normalized) return null;
    if (this._containsSensitiveCacheBypassHint(normalized)) return null;
    return `${language || 'unknown'}|${modelName || 'unknown'}|${normalized}`;
  }

  _getGroundingCacheValue(cacheKey) {
    if (!cacheKey) return null;
    const cached = this.groundingCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.groundingCache.delete(cacheKey);
      return null;
    }
    // Touch entry so frequently used keys remain hot in insertion-order map.
    this.groundingCache.delete(cacheKey);
    this.groundingCache.set(cacheKey, cached);
    return cached.facts;
  }

  _setGroundingCacheValue(cacheKey, facts) {
    if (!cacheKey || !facts || this.groundingCacheTtlMs <= 0) return;
    const expiresAt = Date.now() + this.groundingCacheTtlMs;
    this.groundingCache.set(cacheKey, { facts, expiresAt });
    while (this.groundingCache.size > this.groundingCacheMaxEntries) {
      const oldestKey = this.groundingCache.keys().next().value;
      if (!oldestKey) break;
      this.groundingCache.delete(oldestKey);
    }
  }

  _trimGroundedFacts(facts) {
    if (!facts || typeof facts !== 'string') return '';
    if (facts.length <= this.groundingFactsMaxChars) return facts;
    // Truncate at a sentence boundary so phase 2 never receives half-sentences,
    // which confuse the model and can push it to exceed its output token budget. (#292)
    const candidate = facts.slice(0, this.groundingFactsMaxChars);
    // Walk backwards to find the last sentence-ending punctuation followed by
    // whitespace (or end of string).  Accept '.', '!' and '?' as sentence ends.
    const sentRe = /[.!?][\s]/g;
    sentRe.lastIndex = 0; // defensive reset in case regex is ever hoisted to module scope (#292)
    let lastEnd = -1;
    let m;
    while ((m = sentRe.exec(candidate)) !== null) {
      lastEnd = m.index + 1; // keep the punctuation, drop the trailing space
    }
    // Only use the sentence boundary when it is beyond 40 % of the limit to
    // avoid extreme truncation on fact blocks that start with a very long sentence.
    const cutPoint = lastEnd > this.groundingFactsMaxChars * 0.4 ? lastEnd : candidate.length;
    return `${candidate.slice(0, cutPoint).trim()}\n[facts trimmed]`;
  }

  _init() {
    const project  = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

    if (!project) {
      throw new Error(
        'GOOGLE_CLOUD_PROJECT is required when LLM_PROVIDER=vertex. ' +
        'Set it in .env or via Application Default Credentials.'
      );
    }
    if (!this.modelFree) {
      throw new Error('VERTEX_AI_MODEL_FREE is required. Set it in .env.');
    }
    if (!this.modelPremium) {
      throw new Error('VERTEX_AI_MODEL_PREMIUM is required. Set it in .env.');
    }

    this.vertexAI = new VertexAI({ project, location });

    logger.info('GeminiService initialized', {
      project,
      location,
      modelFree: this.modelFree,
      modelPremium: this.modelPremium,
    });
  }

  /**
   * Convert OpenAI-style messages[] → Gemini { systemInstruction, contents[] }
   *
   * Rules:
   *  - role "system" → collected into systemInstruction (Gemini system prompt)
   *  - role "user"   → { role: "user",  parts: [{ text }] }
   *  - role "assistant" → { role: "model", parts: [{ text }] }
   *  - Consecutive messages from the same role are merged (Gemini requirement)
   *
   * @param {Array}  messages   - OpenAI-style messages array
   * @param {object} [image]    - Optional image attachment for the last user turn
   * @param {string} [image.base64]    - Base64-encoded image data (preferred)
   * @param {string} [image.mimeType] - MIME type, e.g. 'image/jpeg' (default: 'image/jpeg')
   * @param {string} [image.gcsUri]   - GCS URI alternative (gs://…)
   */
  _toGeminiContents(messages, image = null) {
    const systemTexts = [];
    const contents    = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemTexts.push(msg.content);
        continue;
      }

      const geminiRole = msg.role === 'assistant' ? 'model' : 'user';

      // Merge consecutive same-role turns (Gemini requires strict alternation)
      if (contents.length > 0 && contents[contents.length - 1].role === geminiRole) {
        contents[contents.length - 1].parts.push({ text: msg.content });
      } else {
        contents.push({ role: geminiRole, parts: [{ text: msg.content }] });
      }
    }

    // Gemini requires the first content entry to be from "user"
    while (contents.length > 0 && contents[0].role !== 'user') {
      contents.shift();
    }

    // Attach image to the last user turn (multimodal — #135)
    if (image && contents.length > 0) {
      const lastUserIdx = [...contents].map(c => c.role).lastIndexOf('user');
      if (lastUserIdx !== -1) {
        if (image.base64) {
          contents[lastUserIdx].parts.push({
            inline_data: {
              mime_type: image.mimeType || 'image/jpeg',
              data: image.base64,
            },
          });
        } else if (image.gcsUri) {
          contents[lastUserIdx].parts.push({
            file_data: {
              mime_type: image.mimeType || 'image/jpeg',
              file_uri: image.gcsUri,
            },
          });
        }
      }
    }

    const systemInstruction =
      systemTexts.length > 0
        ? { parts: systemTexts.map(t => ({ text: t })) }
        : undefined;

    return { systemInstruction, contents };
  }

  /**
   * Shared response schema for structured output.
   * Gemini is constrained at token level to emit only valid JSON matching this shape.
   */
  get _responseSchema() {
    return {
      type: 'object',
      properties: {
        // Keep text first so stream consumers can emit spoken output sooner.
        text:       { type: 'string', maxLength: 480 },
        intent:     { type: 'string' },
        action:     { type: 'string', enum: ['answer', 'navigate', 'call', 'draft_email', 'search', 'none'] },
        parameters: { type: 'object' },
        confidence: { type: 'number' },
      },
      required: ['text', 'intent', 'action'],
    };
  }

  /**
   * Extract and validate a candidate's text parts from a Gemini result.
   * Joins all text parts (grounding can split across parts) and returns the
   * joined string, or null if the candidate was blocked.
   */
  _extractCandidate(result, language, modelName) {
    const candidate = result.response?.candidates?.[0];
    if (
      !candidate ||
      candidate.finishReason === 'SAFETY' ||
      candidate.finishReason === 'BLOCKLIST' ||
      candidate.finishReason === 'PROHIBITED_CONTENT' ||
      candidate.finishReason === 'SPII'
    ) {
      logger.warn('Gemini content blocked', { finishReason: candidate?.finishReason, language });
      return { blocked: true, truncated: false, text: null };
    }
    // MAX_TOKENS means the generation was cut off.  Return truncated=true so
    // structured-output callers can attempt JSON recovery rather than forwarding
    // broken JSON to the client. (#292)
    const truncated = candidate.finishReason === 'MAX_TOKENS';
    if (truncated) {
      logger.warn('Gemini response truncated at max tokens', { model: modelName, language });
    }
    const text = candidate.content?.parts
      ?.filter(p => typeof p.text === 'string')
      .map(p => p.text)
      .join('') || '';
    return { blocked: false, truncated, text };
  }

  /**
   * Call Gemini via Vertex AI.
   *
   * Grounding queries (tools=[{googleSearch:{}}]) use a two-phase approach:
   *   Phase 1 — grounding model fetches real-time facts via Google Search.
   *   Phase 2 — structured-output model formats those facts into valid JSON.
   * This guarantees structured JSON output for ALL queries without exception.
   *
   * Non-grounding queries use a single call with responseMimeType=application/json
   * + responseSchema, constraining the model at token level to valid JSON.
   *
   * @param {Array}   messages   - OpenAI-style messages (system, user, assistant)
   * @param {string}  language   - BCP-47 language code (e.g. 'de-DE')
   * @param {boolean} isPremium  - Server-validated premium flag
   * @param {object}  [image]    - Optional image for multimodal queries (premium only)
   * @param {Array}   [tools]    - Pass [{googleSearch:{}}] to enable grounding, [] to disable.
   * @returns {Promise<{ content: string, usage: object|null, model: string }>}
   */
  async chat(messages, language, isPremium = false, image = null, tools = []) {
    // Test mode short-circuit — matches chatService.js pattern
    if (process.env.NODE_ENV === 'test') {
      return {
        content: '{"intent":"test_intent","action":null,"parameters":{},"text":"Test response"}',
        usage: null,
        model: 'test',
      };
    }

    const modelName = (isPremium || image) ? this.modelPremium : this.modelFree;
    const needsGrounding = Array.isArray(tools) && tools.length > 0;

    return needsGrounding
      ? this._chatWithGrounding(messages, language, modelName, image)
      : this._chatStructured(messages, language, modelName, image);
  }

  /**
   * Phase 1+2 grounding pipeline.
   * Phase 1: googleSearch grounding → raw factual prose.
   * Phase 2: structured output → valid JSON using the grounded facts as context.
   */
  async _chatWithGrounding(messages, language, modelName, image) {
    const { systemInstruction, contents } = this._toGeminiContents(messages, image);
    if (contents.length === 0) {
      throw new AppError('INVALID_REQUEST', 'No user content to send to Gemini', 400);
    }

    const userQuery = contents[contents.length - 1]?.parts?.map(p => p.text).join(' ') || '';
    const cacheKey = this._buildGroundingCacheKey(userQuery, language, modelName);
    const cachedFacts = this._getGroundingCacheValue(cacheKey);
    if (cachedFacts) {
      logger.info('Grounding phase 1 cache hit', {
        language,
        model: modelName,
        factsLength: cachedFacts.length,
      });
      const trimmedFacts = this._trimGroundedFacts(cachedFacts);
      const formattingContents = [{
        role: 'user',
        parts: [{
          text: `GROUNDED FACTS (from real-time search):\n${trimmedFacts}\n\nUSER QUERY: ${userQuery}\n\nUsing ONLY the grounded facts above, respond in the required JSON format in language: ${language}. Keep text concise (max 2 short sentences).`,
        }],
      }];
      return this._runStructuredCall(formattingContents, systemInstruction, modelName, language, {
        maxOutputTokens: this.groundingPhase2MaxOutputTokens,
      });
    }

    // ── Phase 1: fetch grounded facts ────────────────────────────────────
    // Check in-flight prefetch first: chatService may have started Phase 1 in
    // parallel with request setup.  Look up via the content-based prefetchKey
    // (never null) to avoid cross-user collisions when TTL=0. (#291 Fix 1)
    let groundedFacts = '';
    const prefetchKey = this._buildPrefetchMapKey(userQuery, language, modelName);
    const prefetchPromise = prefetchKey ? this._groundingPrefetchMap.get(prefetchKey) : undefined;
    if (prefetchPromise) {
      try {
        groundedFacts = await prefetchPromise || '';
        if (groundedFacts) {
          logger.info('Grounding phase 1: using parallel pre-fetched facts', { factsLength: groundedFacts.length, language });
        }
      } catch {
        // Prefetch failed — fall through to inline Phase 1 below.
      }
    }

    if (!groundedFacts) {
      // Inline Phase 1: no prefetch available or prefetch returned empty.
      const groundingModel = this.vertexAI.getGenerativeModel({
        model: modelName,
        ...(systemInstruction && { systemInstruction }),
        generationConfig: { maxOutputTokens: this.groundingPhase1MaxOutputTokens, temperature: 0.1 },
        tools: [{ googleSearch: {} }],
      });
      try {
        // Use stream-appropriate retry params so rate-limit backoff stays bounded (#293).
        const result1 = await this._withRetry(
          () => groundingModel.generateContent({ contents }),
          this.streamRetryMaxAttempts,
          this.streamRetryBaseDelayMs,
          this.streamRetryTotalBudgetMs
        );
        const { blocked, truncated: phase1Truncated, text } = this._extractCandidate(result1, language, modelName);
        if (blocked) return { content: this._getPolicyResponse(language), usage: null, model: modelName };
        if (phase1Truncated) {
          // Phase 1 hit MAX_TOKENS — grounded facts may be cut off mid-sentence.
          // Phase 2 will receive incomplete information; log so this surfaces in
          // production rather than silently producing degraded answers. (#292)
          logger.warn('Grounding phase 1 truncated at max tokens — facts may be incomplete', { model: modelName, language });
        }
        groundedFacts = text;
        this._setGroundingCacheValue(cacheKey, groundedFacts);
        logger.info('Grounding phase 1 complete (inline)', { factsLength: groundedFacts.length, language, phase1Truncated: phase1Truncated ?? false });
      } catch (error) {
        if (this._isRateLimitError(error)) throw new AppError('RATE_LIMIT_EXCEEDED', 'AI service is temporarily busy. Please try again in a moment.', 429);
        throw new AppError('PROVIDER_ERROR', `AI provider error: ${this._sanitizeErrorMessage(error.message)}`, 503);
      }
    }

    // ── Phase 2: format as structured JSON ───────────────────────────────
    // Build a fresh single-turn prompt that injects the grounded facts so the
    // structured-output model has all the information it needs.
    const trimmedFacts = this._trimGroundedFacts(groundedFacts);
    const formattingContents = [{
      role: 'user',
      parts: [{
        text: `GROUNDED FACTS (from real-time search):\n${trimmedFacts}\n\nUSER QUERY: ${userQuery}\n\nUsing ONLY the grounded facts above, respond in the required JSON format in language: ${language}. Keep text concise (max 2 short sentences).`,
      }],
    }];

    return this._runStructuredCall(formattingContents, systemInstruction, modelName, language, {
      maxOutputTokens: this.groundingPhase2MaxOutputTokens,
      retryMaxAttempts: this.streamRetryMaxAttempts,
      retryBaseDelayMs: this.streamRetryBaseDelayMs,
      retryTotalBudgetMs: this.streamRetryTotalBudgetMs,
    });
  }

  /**
   * Single-call structured output (no grounding).
   * responseMimeType + responseSchema constrain Gemini at token level.
   */
  async _chatStructured(messages, language, modelName, image) {
    const { systemInstruction, contents } = this._toGeminiContents(messages, image);
    if (contents.length === 0) {
      throw new AppError('INVALID_REQUEST', 'No user content to send to Gemini', 400);
    }
    return this._runStructuredCall(contents, systemInstruction, modelName, language, {
      maxOutputTokens: this.structuredMaxOutputTokens,
    });
  }

  /**
   * Shared structured-output call. Always returns valid JSON via responseSchema.
   */
  async _runStructuredCall(contents, systemInstruction, modelName, language, options = {}) {
    const maxOutputTokens = Math.max(128, options.maxOutputTokens || this.structuredMaxOutputTokens);
    // Allow callers (e.g. grounding phase 2 via stream path) to override retry params
    // so the total backoff budget stays bounded (#293).
    const retryMaxAttempts  = options.retryMaxAttempts  ?? this.retryMaxAttempts;
    const retryBaseDelayMs  = options.retryBaseDelayMs  ?? this.retryBaseDelayMs;
    const retryTotalBudgetMs = options.retryTotalBudgetMs ?? Infinity;
    const structuredModel = this.vertexAI.getGenerativeModel({
      model: modelName,
      ...(systemInstruction && { systemInstruction }),
      generationConfig: {
        maxOutputTokens,
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: this._responseSchema,
      },
    });

    try {
      const result = await this._withRetry(
        () => structuredModel.generateContent({ contents }),
        retryMaxAttempts,
        retryBaseDelayMs,
        retryTotalBudgetMs
      );
      const { blocked, truncated, text } = this._extractCandidate(result, language, modelName);
      if (blocked) return { content: this._getPolicyResponse(language), usage: null, model: modelName };

      // MAX_TOKENS: generation stopped mid-stream.  With responseSchema the JSON is
      // almost certainly incomplete.  Attempt to salvage a usable .text value; if
      // recovery fails, return empty so chatService's retry path kicks in. (#292)
      if (truncated) {
        try {
          const jsonStr = this._extractFirstJsonObject(text);
          if (jsonStr) {
            const partial = JSON.parse(jsonStr);
            if (partial?.text) {
              logger.info('Recovered partial JSON from MAX_TOKENS truncation', { model: modelName, textLength: partial.text.length });
              return { content: jsonStr, usage: null, model: modelName, truncated: true };
            }
          }
        } catch { /* unrecoverable */ }
        logger.warn('MAX_TOKENS truncation unrecoverable — returning empty for retry path', { model: modelName });
        return { content: '', usage: null, model: modelName, truncated: true };
      }

      // Return raw empty string when text is empty so chatService detects it
      // immediately and routes to the localized retry fallback without parsing
      // a JSON shell that masks the empty-text condition.
      if (!text) {
        logger.warn('Gemini structured call returned empty text', { model: modelName, language });
        return { content: '', usage: null, model: modelName };
      }
      return {
        content: text,
        usage: result.response?.usageMetadata
          ? {
              prompt_tokens:     result.response.usageMetadata.promptTokenCount,
              completion_tokens: result.response.usageMetadata.candidatesTokenCount,
              total_tokens:      result.response.usageMetadata.totalTokenCount,
            }
          : null,
        model: modelName,
      };
    } catch (error) {
      if (this._isRateLimitError(error)) {
        logger.warn('Vertex AI quota exhausted after retries', { model: modelName });
        throw new AppError(
          'RATE_LIMIT_EXCEEDED',
          'AI service is temporarily busy. Please try again in a moment.',
          429
        );
      }
      throw new AppError(
        'PROVIDER_ERROR',
        `AI provider error: ${this._sanitizeErrorMessage(error.message)}`,
        503
      );
    }
  }

  /**
   * Returns true for Vertex AI rate-limit / quota-exhausted errors.
   * Handles HTTP 429, gRPC RESOURCE_EXHAUSTED (code 8), and message-based detection.
   */
  _isRateLimitError(error) {
    if (!error) return false;
    if (error.status === 429 || error.statusCode === 429) return true;
    if (error.code === 8) return true; // gRPC RESOURCE_EXHAUSTED
    const msg = (error.message || '').toUpperCase();
    return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('QUOTA_EXCEEDED');
  }

  /**
   * Extract the first balanced JSON object from an arbitrary string.
   * Used by the MAX_TOKENS truncation recovery path in _runStructuredCall. (#292)
   *
   * @param {string} text
   * @returns {string|null}
   */
  _extractFirstJsonObject(text) {
    if (!text) return null;
    let depth = 0;
    let start = -1;
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\') { escapeNext = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        if (depth === 0) continue; // ignore orphan closing braces
        depth--;
        if (depth === 0 && start !== -1) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  /**
   * Given the raw text content returned by a grounding call, return safe
   * plain text suitable for TTS.
   *
   * If the model ignored the plain-text instruction and returned JSON (or
   * prefixed JSON with prose), extract only the `text` field.  If nothing
   * useful can be extracted, return an empty string — silence is always
   * better than speaking raw JSON aloud. (#295)
   *
   * @param {string} raw
   * @returns {string}
   */
  _extractPlainTextFromGroundingResult(raw) {
    if (!raw) return '';
    const structural = /"(?:intent|action|parameters)"\s*:/.test(raw);
    if (!raw.startsWith('{') && !structural) return raw; // plain text — no guard needed
    try {
      const jsonStr = this._extractFirstJsonObject(raw) || raw;
      const parsed = JSON.parse(jsonStr);
      return (parsed?.text || '').trim();
    } catch {
      // Could not parse — if there's no JSON at all, return raw;
      // if there's structural JSON mixed in, drop to empty string.
      return structural ? '' : raw;
    }
  }

  /**
   * Start grounding Phase 1 (Google Search) early and return a Promise that
   * resolves to the raw factual text.  The caller fires this immediately after
   * receiving the request so Phase 1 runs in parallel with setup work
   * (memory prefetch, parental controls, message building). (#291)
   *
   * An internal promise map deduplicates concurrent requests with the same
   * query — each unique query triggers at most one live Phase 1 call at a time.
   *
   * @param {string} userQuery  The user's latest message text.
   * @param {string} language   BCP-47 language code.
   * @param {string} modelName  Vertex AI model ID.
   * @returns {Promise<string>} Grounded facts, or '' on failure.
   */
  _prefetchGroundingFacts(userQuery, language, modelName) {
    if (!userQuery || process.env.NODE_ENV === 'test') return Promise.resolve('');

    // Use a content-based key that is always non-null so concurrent users with
    // different queries can never collide on a null entry (#291 Fix 1).
    const prefetchKey = this._buildPrefetchMapKey(userQuery, language, modelName);
    if (!prefetchKey) return Promise.resolve(''); // empty or sensitive query

    // Persistent cache key (may be null when TTL=0 — that's fine for cache only).
    const cacheKey = this._buildGroundingCacheKey(userQuery, language, modelName);

    // Immediate cache hit — no API call needed.
    const cached = this._getGroundingCacheValue(cacheKey);
    if (cached) return Promise.resolve(cached);

    // Dedup: reuse an in-flight promise for the same query.
    if (this._groundingPrefetchMap.has(prefetchKey)) {
      return this._groundingPrefetchMap.get(prefetchKey);
    }

    // Phase 1 uses only the user query (no conversation history) so it can
    // start before buildMessages() completes.  For real-time queries (weather,
    // fuel, traffic) the query alone is sufficient for Google Search. (#291)
    const contents = [{ role: 'user', parts: [{ text: userQuery }] }];
    const groundingModel = this.vertexAI.getGenerativeModel({
      model: modelName,
      generationConfig: { maxOutputTokens: this.groundingPhase1MaxOutputTokens, temperature: 0.1 },
      tools: [{ googleSearch: {} }],
    });

    const promise = this._withRetry(
      () => groundingModel.generateContent({ contents }),
      this.streamRetryMaxAttempts,
      this.streamRetryBaseDelayMs,
      this.streamRetryTotalBudgetMs
    ).then(result => {
      // Fix 3: check blocked so we don't cache a policy response or let
      // _chatWithGrounding waste a second API call on an already-blocked query.
      const { blocked, text } = this._extractCandidate(result, language, modelName);
      if (blocked) {
        logger.warn('Grounding prefetch blocked by safety policy', { language, model: modelName });
        return '';
      }
      const facts = text || '';
      if (facts) this._setGroundingCacheValue(cacheKey, facts);
      logger.info('Grounding prefetch phase 1 complete', { factsLength: facts.length, language, model: modelName });
      return facts;
    }).catch(err => {
      logger.warn('Grounding prefetch failed — inline Phase 1 will run as fallback', { error: err.message });
      return ''; // _chatWithGrounding will start a fresh Phase 1
    }).finally(() => {
      this._groundingPrefetchMap.delete(prefetchKey);
    });

    this._groundingPrefetchMap.set(prefetchKey, promise);
    return promise;
  }

  /**
   * Execute fn() with exponential backoff retry — only on rate-limit errors.
   * Delay schedule (with up to 1 s jitter): ~2 s, ~4 s, ~8 s …
   * All other errors propagate immediately without retrying.
   *
   * @param {Function} fn             - Async function to execute
   * @param {number}   maxAttempts    - Total attempts before giving up (default: 3)
   * @param {number}   baseDelayMs    - Base delay in ms; doubles each attempt (default: 2000)
   * @param {number}   totalBudgetMs  - Hard cap on total ms spent waiting across all retries.
   *                                    Pass streamRetryTotalBudgetMs for stream-path calls to
   *                                    prevent backoff from consuming the client timeout (#293).
   */
  async _withRetry(fn, maxAttempts = 3, baseDelayMs = 1000, totalBudgetMs = Infinity) {
    let lastError;
    let totalDelaySpent = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!this._isRateLimitError(error)) throw error;
        lastError = error;
        if (attempt < maxAttempts - 1) {
          const remaining = totalBudgetMs - totalDelaySpent;
          if (remaining <= 0) {
            logger.warn('Vertex AI rate limit: retry budget exhausted, giving up early', {
              attempt: attempt + 1,
              maxAttempts,
              totalBudgetMs,
              totalDelaySpent,
            });
            break;
          }
          const rawDelay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
          const delay = Math.min(rawDelay, remaining);
          totalDelaySpent += delay;
          logger.warn('Vertex AI rate limit hit, retrying', {
            attempt: attempt + 1,
            maxAttempts,
            delayMs: delay,
            totalBudgetMs,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * Returns a neutral JSON policy response without exposing vendor names.
   */
  _getPolicyResponse(language) {
    const lang = (language || 'en-US').toLowerCase();
    if (lang.startsWith('de')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Entschuldigung, darauf kann ich leider nicht eingehen. Bitte stellen Sie eine andere Frage."}';
    }
    if (lang.startsWith('fr')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"D\u00e9sol\u00e9, je ne peux pas r\u00e9pondre \u00e0 cela. Veuillez poser une autre question."}';
    }
    if (lang.startsWith('es')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Lo siento, no puedo responder a eso. Por favor, haz otra pregunta."}';
    }
    if (lang.startsWith('it')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Mi dispiace, non posso rispondere a questo. Per favore, fai un\'altra domanda."}';
    }
    if (lang.startsWith('tr')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"\u00dczg\u00fcn\u00fcm, buna cevap veremiyorum. L\u00fctfen ba\u015fka bir soru sorun."}';
    }
    if (lang.startsWith('pl')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Przepraszam, nie mog\u0119 na to odpowiedzie\u0107. Prosz\u0119 zada\u0107 inne pytanie."}';
    }
    if (lang.startsWith('ru')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"\u0418\u0437\u0432\u0438\u043d\u0438\u0442\u0435, \u044f \u043d\u0435 \u043c\u043e\u0433\u0443 \u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c \u043d\u0430 \u044d\u0442\u043e. \u041f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430, \u0437\u0430\u0434\u0430\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 \u0432\u043e\u043f\u0440\u043e\u0441."}';
    }
    if (lang.startsWith('vi')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Xin l\u1ed7i, t\u00f4i kh\u00f4ng th\u1ec3 tr\u1ea3 l\u1eddi \u0111i\u1ec1u \u0111\u00f3. Vui l\u00f2ng h\u1ecfi c\u00e2u h\u1ecfi kh\u00e1c."}';
    }
    if (lang.startsWith('zh')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"\u62b1\u6b49\uff0c\u6211\u65e0\u6cd5\u56de\u7b54\u8fd9\u4e2a\u95ee\u9898\u3002\u8bf7\u63d0\u51fa\u5176\u4ed6\u95ee\u9898\u3002"}';
    }
    if (lang.startsWith('ja')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"\u7533\u3057\u8a33\u3054\u3056\u3044\u307e\u305b\u3093\u304c\u3001\u304a\u7b54\u3048\u3067\u304d\u307e\u305b\u3093\u3002\u5225\u306e\u3054\u8cea\u554f\u3092\u304a\u9858\u3044\u3057\u307e\u3059\u3002"}';
    }
    if (lang.startsWith('ko')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"\uc8c4\uc1a1\ud569\ub2c8\ub2e4. \ud574\ub2f9 \uc9c8\ubb38\uc5d0 \ub2f5\ubcc0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \ub2e4\ub978 \uc9c8\ubb38\uc744 \ud574\uc8fc\uc138\uc694."}';
    }
    return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Sorry, I can\'t help with that. Please ask me something else."}';
  }

  /** Strip AI vendor names from error messages before surfacing to clients. */
  _sanitizeErrorMessage(message) {
    return (message || '')
      .replace(/\bGoogle\s*Cloud\b/gi, 'AI service')
      .replace(/\bVertex\s*AI\b/gi, 'AI service')
      .replace(/\bGemini\b/gi, 'AI service');
  }

  /**
   * #269 — Streaming variant of chat() for personal/business modes.
   *
   * Yields text delta chunks from Gemini's generateContentStream so the caller
   * can forward them to the client via SSE before the full response is assembled.
   *
   * Grounding queries are NOT streamed (two-phase pipeline buffers everything);
   * they fall back to the standard chat() path and yield a single final chunk.
   *
   * Kids and car modes must NOT use this method — their output requires a full
   * scan/sanitize pass before any text is forwarded to the client.
   *
   * @yields {{ delta: string, done: boolean, meta?: object }}
   *   delta  — incremental text (empty string on the final done=true event)
   *   done   — true only on the terminal event
   *   meta   — present on done=true: { intent, action, parameters, confidence, usage, model }
   */
  async *chatStream(messages, language, isPremium = false, image = null, tools = [], streamContext = {}) {
    if (process.env.NODE_ENV === 'test') {
      yield { delta: 'Test response', done: false };
      yield { delta: '', done: true, meta: { intent: 'test_intent', action: null, parameters: {}, confidence: 0.99, usage: null, model: 'test' } };
      return;
    }

    let modelName = (isPremium || image) ? this.modelPremium : this.modelFree;
    const streamMode = streamContext?.mode || null;
    const latencySensitiveStreamMode = streamMode === 'personal' || streamMode === 'voice';
    const streamLowLatencyModel = process.env.VERTEX_AI_MODEL_STREAM_LOW_LATENCY;

    // #272 optimization: prefer a low-latency model for voice/personal streaming.
    // If not configured, keep existing model routing unchanged.
    if (latencySensitiveStreamMode && !image && streamLowLatencyModel) {
      modelName = streamLowLatencyModel;
    }
    const needsGrounding = Array.isArray(tools) && tools.length > 0;

    // Grounding path: buffer via existing pipeline, yield as single chunk
    if (needsGrounding) {
      if (this.streamTextOnly) {
        const textResult = await this._chatWithGroundingText(messages, language, modelName, image);
        // Guard: if the model returned JSON despite the plain-text instruction,
        // extract only the spoken text field rather than yielding raw JSON. (#295)
        const rawText = (textResult.content || '').trim();
        const text = this._extractPlainTextFromGroundingResult(rawText);
        if (text) {
          yield { delta: text, done: false };
        }
        yield {
          delta: '',
          done: true,
          meta: {
            intent: 'unknown',
            action: null,
            parameters: {},
            confidence: 0.8,
            usage: textResult.usage || null,
            model: modelName,
            // #306 — propagate truncated so the route emits a STREAM_TRUNCATED error
            // frame instead of a success meta frame when content was cut short.
            truncated: textResult.truncated === true,
          },
        };
        return;
      }

      const result = await this._chatWithGrounding(messages, language, modelName, image);
      let text = '';
      let groundingMeta = { intent: 'unknown', action: null, parameters: {}, confidence: 0.5 };
      try {
        const parsed = JSON.parse(result.content);
        text = parsed.text || '';
        groundingMeta = { intent: parsed.intent || 'unknown', action: parsed.action || null, parameters: parsed.parameters || {}, confidence: parsed.confidence || 0.85 };
      } catch {
        // Top-level JSON.parse failed — content may have preamble prose before the
        // JSON object. Extract using brace-counting so we never yield raw JSON to
        // TTS. Silence is always better than speaking "intent colon … action colon …".
        // (#295)
        try {
          const jsonStr = this._extractFirstJsonObject(result.content);
          if (jsonStr) {
            const fallback = JSON.parse(jsonStr);
            text = fallback?.text || '';
            groundingMeta = { intent: fallback.intent || 'unknown', action: fallback.action || null, parameters: fallback.parameters || {}, confidence: fallback.confidence || 0.5 };
          }
        } catch { /* no usable JSON — text stays empty, emit silence */ }
      }
      if (text) yield { delta: text, done: false };
      // Propagate truncated flag so the route can emit an error frame instead of
      // treating a partial grounding response as a successful completion. (#302)
      yield { delta: '', done: true, meta: { ...groundingMeta, usage: null, model: modelName, truncated: result.truncated === true } };
      return;
    }

    yield* this._streamStructured(messages, language, modelName, image, streamContext);
  }

  /**
   * Grounding stream fast-path for STREAM_TEXT_ONLY mode.
   * Uses a single grounding call (googleSearch) and asks for concise plain text,
   * avoiding phase-2 structured JSON formatting to reduce latency.
   */
  async _chatWithGroundingText(messages, language, modelName, image) {
    const { systemInstruction, contents } = this._toGeminiContents(messages, image);
    if (contents.length === 0) {
      throw new AppError('INVALID_REQUEST', 'No user content to send to Gemini', 400);
    }

    const userQuery = contents[contents.length - 1]?.parts?.map(p => p.text).join(' ') || '';
    const cacheKey = this._buildGroundingCacheKey(`text:${userQuery}`, language, modelName);
    const cachedAnswer = this._getGroundingCacheValue(cacheKey);
    if (cachedAnswer) {
      return { content: cachedAnswer, usage: null, model: modelName };
    }

    const textOnlySystemInstruction = {
      parts: [
        ...((systemInstruction?.parts) || []),
        {
          text: `Return plain conversational text only in language ${language}. Do not output JSON, markdown code fences, or metadata fields. Keep the answer concise (max 2 short sentences).`,
        },
      ],
    };

    const groundingModel = this.vertexAI.getGenerativeModel({
      model: modelName,
      systemInstruction: textOnlySystemInstruction,
      generationConfig: {
        maxOutputTokens: this.groundingTextMaxOutputTokens,
        temperature: 0.2,
      },
      tools: [{ googleSearch: {} }],
    });

    try {
      // Use stream-appropriate retry params so rate-limit backoff stays bounded (#293).
      const result = await this._withRetry(
        () => groundingModel.generateContent({ contents }),
        this.streamRetryMaxAttempts,
        this.streamRetryBaseDelayMs,
        this.streamRetryTotalBudgetMs
      );
      const { blocked, truncated, text } = this._extractCandidate(result, language, modelName);
      if (blocked) {
        return { content: this._getPolicyResponse(language), usage: null, model: modelName };
      }

      // #306 — log truncation so it surfaces in Cloud Run logs rather than silently
      // producing an empty response that the caller cannot distinguish from success.
      if (truncated) {
        logger.warn('_chatWithGroundingText: MAX_TOKENS truncation — content may be empty', { model: modelName, language });
      }

      const cleaned = (text || '').trim();
      const usage = result.response?.usageMetadata
        ? {
            prompt_tokens: result.response.usageMetadata.promptTokenCount,
            completion_tokens: result.response.usageMetadata.candidatesTokenCount,
            total_tokens: result.response.usageMetadata.totalTokenCount,
          }
        : null;

      if (cleaned) {
        this._setGroundingCacheValue(cacheKey, cleaned);
      }

      // #306 — propagate truncated so chatStream can emit a STREAM_TRUNCATED error
      // frame instead of resolving with replyText: ''.
      return { content: cleaned, usage, model: modelName, truncated: truncated === true };
    } catch (error) {
      if (this._isRateLimitError(error)) {
        throw new AppError('RATE_LIMIT_EXCEEDED', 'AI service is temporarily busy. Please try again in a moment.', 429);
      }
      throw new AppError('PROVIDER_ERROR', `AI provider error: ${this._sanitizeErrorMessage(error.message)}`, 503);
    }
  }

  /**
   * Internal streaming path for non-grounding queries.
   * Uses generateContentStream — Gemini emits tokens as they are generated.
   * We accumulate them and extract the JSON `text` field progressively.
   *
   * Because Gemini emits valid JSON fragments across chunks, we buffer the
   * full raw stream and parse JSON once complete — but yield the `text` value
   * incrementally using a simple regex-based extractor that works on partial JSON.
   */
  async *_streamStructured(messages, language, modelName, image, streamContext = {}) {
    const { systemInstruction, contents } = this._toGeminiContents(messages, image);
    if (contents.length === 0) {
      throw new AppError('INVALID_REQUEST', 'No user content to send to Gemini', 400);
    }

    const streamSystemInstruction = this.streamTextOnly
      ? {
          parts: [
            ...((systemInstruction?.parts) || []),
            {
              text: 'STREAM_TEXT_ONLY mode is active. Return plain conversational text only. Do not output JSON, markdown code fences, or metadata fields.',
            },
          ],
        }
      : systemInstruction;

    const generationConfig = this.streamTextOnly
      ? {
          maxOutputTokens: this.streamTextMaxOutputTokens,
          temperature: 0.3,
        }
      : {
          maxOutputTokens: 1024,
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: this._responseSchema,
        };

    const streamModel = this.vertexAI.getGenerativeModel({
      model: modelName,
      ...(streamSystemInstruction && { systemInstruction: streamSystemInstruction }),
      generationConfig,
    });

    let rawAccumulated = '';
    let textYieldedUpTo = 0; // byte offset into the text field we have yielded so far
    const providerStreamStart = Date.now();
    let providerFirstChunkLatencyMs = null;
    let providerRawChunkCount = 0;
    let textFieldDetectedLatencyMs = null;
    let firstTextDeltaLatencyMs = null;
    // #302 — track whether Vertex AI ended the stream at MAX_TOKENS (truncated).
    let streamTruncated = false;

    const decodeJsonStringPrefix = (escaped) => {
      if (!escaped) return '';
      // Trim trailing escape fragments until JSON.parse can decode safely.
      // This allows early first-delta emission on partial chunks.
      let safe = escaped;
      while (safe.length > 0) {
        try {
          return JSON.parse(`"${safe}"`);
        } catch {
          safe = safe.slice(0, -1);
        }
      }
      return '';
    };

    // Delegate to class method so the extractor is reachable from other paths (#295).
    const extractFirstJsonObject = (text) => this._extractFirstJsonObject(text);

    try {
      const streamResult = await this._withRetry(() =>
        streamModel.generateContentStream({ contents })
      , this.streamRetryMaxAttempts, this.streamRetryBaseDelayMs, this.streamRetryTotalBudgetMs);

      const streamIterator = streamResult.stream[Symbol.asyncIterator]();

      const nextChunkWithTimeout = async (timeoutMs) => {
        let timer;
        try {
          return await Promise.race([
            streamIterator.next(),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                reject(new AppError('PROVIDER_TIMEOUT', 'AI provider stream timed out', 503));
              }, timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      while (true) {
        const waitingForFirstDelta = firstTextDeltaLatencyMs === null;
        const timeoutMs = waitingForFirstDelta ? this.streamFirstDeltaTimeoutMs : 30000;
        const nextItem = await nextChunkWithTimeout(timeoutMs);
        if (nextItem.done) break;

        const chunk = nextItem.value;
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        // Safety block mid-stream — abort immediately
        const fr = candidate.finishReason;
        if (fr === 'SAFETY' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT' || fr === 'SPII') {
          logger.warn('Gemini stream blocked mid-response', { finishReason: fr, language });
          yield { delta: '', done: true, meta: { intent: 'content_blocked', action: 'none', parameters: {}, confidence: 1.0, usage: null, model: modelName } };
          return;
        }

        // #302 — MAX_TOKENS means the model was cut off mid-response. Mark as truncated
        // so the done event signals an incomplete stream rather than a successful one.
        if (fr === 'MAX_TOKENS') {
          logger.warn('Gemini stream hit MAX_TOKENS — response truncated', { model: modelName, language });
          streamTruncated = true;
        }

        const chunkText = candidate.content?.parts
          ?.filter(p => typeof p.text === 'string')
          .map(p => p.text)
          .join('') || '';

        if (chunkText.length > 0) {
          providerRawChunkCount += 1;
          if (providerFirstChunkLatencyMs === null) {
            providerFirstChunkLatencyMs = Date.now() - providerStreamStart;
          }
        }

        rawAccumulated += chunkText;

        if (this.streamTextOnly) {
          // If the model is returning JSON despite the plain-text instruction
          // (because the car system prompt mandates JSON), fall through to the
          // progressive "text" field extraction below instead of yielding raw JSON.
          const isJsonOutput = rawAccumulated.trimStart().startsWith('{');
          if (!isJsonOutput) {
            // True plain text — yield chunk directly.
            // Guard: only count/yield chunks with real content; whitespace-only
            // chunks must not set firstTextDeltaLatencyMs (misleading telemetry)
            // or reach chatService._normalizeStreamDelta as empty frames. (#273)
            if (chunkText.trim()) {
              if (firstTextDeltaLatencyMs === null) {
                firstTextDeltaLatencyMs = Date.now() - providerStreamStart;
              }
              yield { delta: chunkText, done: false };
            }
            continue;
          }
          // Fall through to progressive JSON text extraction
        }

        // Progressive extraction of the `text` field value from partial JSON.
        // Pattern: ..."text":"<value here>  (may be split across chunks)
        // We look for the opening of the text value and yield new characters as they arrive.
        const textFieldMatch = rawAccumulated.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textFieldMatch) {
          if (textFieldDetectedLatencyMs === null) {
            textFieldDetectedLatencyMs = Date.now() - providerStreamStart;
          }
          // Full text field is now available — yield anything not yet yielded
          const fullText = decodeJsonStringPrefix(textFieldMatch[1]);
          if (fullText.length > textYieldedUpTo) {
            const delta = fullText.slice(textYieldedUpTo);
            textYieldedUpTo = fullText.length;
            if (delta) {
              if (firstTextDeltaLatencyMs === null) {
                firstTextDeltaLatencyMs = Date.now() - providerStreamStart;
              }
              yield { delta, done: false };
            }
          }
        } else {
          // Text field is still being streamed — try to yield partial content
          // safely (only emit complete characters outside JSON escape sequences).
          const partialMatch = rawAccumulated.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/);
          if (partialMatch) {
            if (textFieldDetectedLatencyMs === null) {
              textFieldDetectedLatencyMs = Date.now() - providerStreamStart;
            }
            const partialText = decodeJsonStringPrefix(partialMatch[1]);
            if (partialText.length > textYieldedUpTo) {
              const delta = partialText.slice(textYieldedUpTo);
              textYieldedUpTo = partialText.length;
              if (delta) {
                if (firstTextDeltaLatencyMs === null) {
                  firstTextDeltaLatencyMs = Date.now() - providerStreamStart;
                }
                yield { delta, done: false };
              }
            }
          }
        }
      }

      // Stream complete — parse full JSON for metadata
      const aggregated = await streamResult.response;
      const usage = aggregated.usageMetadata
        ? { prompt_tokens: aggregated.usageMetadata.promptTokenCount, completion_tokens: aggregated.usageMetadata.candidatesTokenCount, total_tokens: aggregated.usageMetadata.totalTokenCount }
        : null;

      let meta = { intent: 'unknown', action: null, parameters: {}, confidence: 0.85, usage, model: modelName };
      // Parse full JSON for metadata — also run in streamTextOnly when model returned JSON.
      if (!this.streamTextOnly || rawAccumulated.trimStart().startsWith('{')) {
        try {
          // Extract first balanced JSON object from accumulated raw output.
          // Quote/escape-aware parsing avoids false object boundaries on braces in strings.
          const jsonStr = extractFirstJsonObject(rawAccumulated);
          if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            meta = {
              intent: parsed.intent || 'unknown',
              action: parsed.action || null,
              parameters: parsed.parameters || {},
              confidence: parsed.confidence || 0.85,
              usage,
              model: modelName,
            };
          }
        } catch { /* use default meta */ }
      }

      // #306 — End-of-stream recovery: if nothing was yielded (textYieldedUpTo === 0)
      // but raw content accumulated, the progressive extractor failed to match —
      // most commonly because the model returned `"text": null` instead of a quoted
      // string despite STREAM_TEXT_ONLY mode.  Attempt a full JSON parse and yield
      // any usable text field as a single delta before the done event.
      if (textYieldedUpTo === 0 && rawAccumulated) {
        try {
          const jsonStr = extractFirstJsonObject(rawAccumulated);
          if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            const recovered =
              (typeof parsed?.text === 'string' && parsed.text.trim()) ||
              (typeof parsed?.response?.text === 'string' && parsed.response.text.trim()) ||
              (typeof parsed?.message === 'string' && parsed.message.trim()) ||
              null;
            if (recovered) {
              logger.info('_streamStructured: recovered text via end-of-stream JSON parse (#306)', { model: modelName, textLength: recovered.length });
              if (firstTextDeltaLatencyMs === null) {
                firstTextDeltaLatencyMs = Date.now() - providerStreamStart;
              }
              yield { delta: recovered, done: false };
            }
          }
        } catch { /* unrecoverable — will resolve with empty replyText */ }
      }

      if (!rawAccumulated) {
        logger.warn('Gemini stream returned empty response', { model: modelName, language });
      }

      logger.info('Gemini stream telemetry', {
        requestId: streamContext?.requestId ?? null,
        sessionId: streamContext?.sessionId ?? null,
        model: modelName,
        language,
        streamTextOnly: this.streamTextOnly,
        providerFirstChunkLatencyMs,
        textFieldDetectedLatencyMs,
        firstTextDeltaLatencyMs,
        providerRawChunkCount,
        providerStreamDurationMs: Date.now() - providerStreamStart,
      });

      // #302 — include truncated flag so callers can distinguish a complete stream
      // from one that was cut short at MAX_TOKENS.
      yield { delta: '', done: true, meta: { ...meta, truncated: streamTruncated } };

    } catch (error) {
      if (this._isRateLimitError(error)) {
        throw new AppError('RATE_LIMIT_EXCEEDED', 'AI service is temporarily busy. Please try again in a moment.', 429);
      }
      if (error instanceof AppError && error.code === 'PROVIDER_TIMEOUT') {
        throw error;
      }
      throw new AppError('PROVIDER_ERROR', `AI provider error: ${this._sanitizeErrorMessage(error.message)}`, 503);
    }
  }
}

export default GeminiService;
