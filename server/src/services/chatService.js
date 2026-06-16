import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import GeminiService from './geminiService.js';
import { getCarSystemPrompt } from '../config/carSystemPrompt.js';
import { sanitizeCarResponse } from '../utils/carResponseSanitizer.js';
import DeepSeekService from './deepseekService.js';
import ClaudeService from './claudeService.js';
import ParentalControlService from './parentalControlService.js';
import { scanInput, scanResponse, getFallbackResponse, logBlocked } from '../utils/kidsContentFilter.js';
import { loadUserMemory, buildMemoryPromptSection, extractFactsFromTurn, updateUserMemory } from './memoryService.js';

// Load .env explicitly here because ES module imports are hoisted — dotenv.config()
// in index.js runs AFTER this module is evaluated, leaving env vars unset during
// ChatService construction. Calling dotenv.config() here ensures vars are available.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

/**
 * Chat Service
 * Handles natural language understanding and dialogue management
 * with LLM orchestration, safety guardrails, and conversation state
 */
class ChatService {
  constructor() {
    this.conversationStates = new Map(); // In-memory session storage
    // In test mode, skip initializing the external LLM client to avoid
    // network calls and configuration requirements. Use a deterministic
    // test short-circuit inside `processChat` instead.
    this.llmProvider = process.env.NODE_ENV === 'test' ? 'test' : (process.env.LLM_PROVIDER || 'vertex');
    if (process.env.NODE_ENV !== 'test') {
      this.initializeLLM();
    } else {
      logger.info('Chat Service initialized in test mode');
    }
  }

  // Exposed so tests can check availability without triggering a real call
  get deepSeekAvailable() {
    return Boolean(this.deepSeekService?.isConfigured);
  }

  initializeLLM() {
    if (this.llmProvider === 'vertex') {
      try {
        this.geminiService = new GeminiService();
        this.client = null;
        logger.info('Chat Service initialized with LLM provider: vertex (Gemini)');
      } catch (err) {
        logger.error('Vertex AI init failed', { error: err.message });
        this.llmProvider = 'test';
        this.client = null;
      }

      // DeepSeek is optional — if DEEPSEEK_MODEL is not set it gracefully
      // degrades to Gemini for business mode (logged inside DeepSeekService).
      this.deepSeekService = new DeepSeekService();

      // Claude for kids mode — optional, falls back to Gemini if not configured
      this.claudeService = new ClaudeService();
      this.parentalControlService = new ParentalControlService();
      return;
    }

    logger.warn(`Unknown LLM_PROVIDER "${this.llmProvider}" — running in test/fallback mode`);
    this.llmProvider = 'test';
    this.client = null;
  }

  /**
   * Process user text input and generate assistant response
   * @param {Object} options - Processing options
   * @param {string} options.text - User input text
   * @param {string} options.sessionId - Session identifier
   * @param {Object} options.context - Additional context
   * @param {string} options.language - BCP-47 language code
   * @param {Object} [options.image] - Optional image for multimodal queries
   * @param {string} [options.image.base64]    - Base64-encoded image bytes
   * @param {string} [options.image.mimeType]  - MIME type (default: 'image/jpeg')
   * @param {string} [options.image.gcsUri]    - GCS URI alternative
   * @returns {Promise<Object>} Chat response
   */
  async processChat(options) {
    const { text, sessionId, context = {}, language = 'de-DE', isPremium = false, image = null, mode = 'personal', parentUid = null, uid = null, grounding = false } = options;
    // NOTE: isPremium must be validated server-side via Firebase Auth custom claim.
    // It is populated by #124 (model routing) + #125 (receipt validation).
    // Until those land, all users are treated as free tier (isPremium = false).

    try {
      // Short-circuit in test mode or when the service was initialized in
      // fallback/test mode to avoid external LLM calls. This covers cases
      // where the module was imported before the test harness set
      // `process.env.NODE_ENV`.
      if (process.env.NODE_ENV === 'test' || this.llmProvider === 'test') {
        return {
          intent: 'test_intent',
          slots: {},
          response: {
            text: 'Test response',
            action: null,
            parameters: {},
          },
          confidence: 0.99,
        };
      }
      // Retrieve or initialize conversation state
      const conversation = this.getConversationState(sessionId);

      // #268 — Start user-memory prefetch in the background so Firestore reads
      // never block LLM invocation on the first turn.
      if (uid) {
        this._startMemoryPrefetch(conversation, uid, sessionId);
      }

      // #291 — Fire grounding Phase 1 immediately so it runs in parallel with
      // setup work (memory, parental controls, message building).  We use only
      // the user's latest message as the search query — sufficient for real-time
      // data queries (weather, fuel prices, traffic).  Phase 1 results land in
      // _groundingPrefetchMap and are consumed by _chatWithGrounding() below.
      // Skipped for kids mode (Claude handles those) and car mode (no grounding).
      const groundingNeeded = mode !== 'car' && mode !== 'kids' && grounding === true;
      if (groundingNeeded && this.llmProvider === 'vertex' && this.geminiService &&
          process.env.NODE_ENV !== 'test') {
        const prefetchModel = isPremium
          ? this.geminiService.modelPremium
          : this.geminiService.modelFree;
        this.geminiService._prefetchGroundingFacts(text, language, prefetchModel);
      }

      // Car mode: use Sylex driving persona system prompt (#158)
      const systemPrompt = mode === 'car'
        ? getCarSystemPrompt({ language, navigationContext: context.navigation ?? null })
        : this.getSystemPrompt();
      // ── Kids mode safety checks (run before LLM call) ──────────────────
      if (mode === 'kids') {
        // 1. Parental controls (topic block + session limit)
        if (parentUid && this.parentalControlService) {
          await this.parentalControlService.enforce(parentUid, sessionId, text);
        }
        // 2. Input content filter
        const inputScan = scanInput(text);
        if (!inputScan.safe) {
          logBlocked(parentUid || sessionId, 'input', inputScan.category);
          const fallback = getFallbackResponse();
          return { intent: fallback.intent, slots: {}, response: { text: fallback.text, action: fallback.action, parameters: fallback.parameters }, confidence: 1.0 };
        }
      }

      // If the device language changed mid-session, clear the conversation history.
      if (conversation.language && conversation.language !== language) {
        logger.info('Language changed mid-session — resetting conversation history', {
          sessionId, from: conversation.language, to: language,
        });
        conversation.messages = [{ role: 'system', content: systemPrompt }];
      }

      // Refresh system prompt on every car-mode request (navigation context changes)
      if (mode === 'car') {
        conversation.messages[0] = { role: 'system', content: systemPrompt };
      }
      conversation.language = language;

      // If memory prefetch already finished, inject it now (non-blocking path).
      this._applyMemorySection(conversation);

      // Build conversation history
      const messages = this.buildMessages(conversation, text, context, language);

      logger.info('Chat request processed', {
        sessionId,
        textLength: text.length,
        language,
        messageCount: messages.length,
      });

      // #230 — Grounding is client-authoritative for latency:
      // only enable Google Search when the client explicitly sets grounding=true.
      // Car mode still skips grounding because navigation context is injected separately.
      const needsGrounding = mode !== 'car' && grounding === true;
      const tools = needsGrounding ? [{ googleSearch: {} }] : [];
      if (needsGrounding) {
        logger.info('Client requested grounding — enabling Google Search grounding', { sessionId });
      }

      // Call LLM with safety guardrails (provider routed by LLM_PROVIDER env + mode)
      const response = await this.callLLM(messages, language, isPremium, image, mode, tools);

      // ── Kids mode: filter output before returning ─────────────────────
      let responseContent = response.content;
      if (mode === 'kids') {
        const outputScan = scanResponse(responseContent);
        if (!outputScan.safe) {
          logBlocked(parentUid || sessionId, 'output', outputScan.category);
          const fallback = getFallbackResponse();
          responseContent = JSON.stringify({ intent: fallback.intent, action: fallback.action, parameters: fallback.parameters, text: fallback.text });
        }
      }

      // Car mode: apply hard response contract (#161) before TTS + storage
      if (mode === 'car') {
        responseContent = sanitizeCarResponse(responseContent);
      }

      // Extract intent and slots
      let parsed = this.parseResponse(responseContent);

      // #217 / #229 — If the model returned empty text (e.g. Gemini grounding edge case),
      // retry once but with a bounded timeout so the retry never blocks the response path
      // for more than LLM_RETRY_TIMEOUT_MS (default 1500 ms). If the timeout fires first,
      // fall through to the localized fallback immediately.
      if (!parsed.text) {
        logger.warn('LLM returned empty text — retrying once', { sessionId, language, rawContent: responseContent.substring(0, 300) });
        const retryTimeoutMs = parseInt(process.env.LLM_RETRY_TIMEOUT_MS || '800', 10);
        const retryTimeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), retryTimeoutMs));
        try {
          const retryResponse = await Promise.race([
            this.callLLM(messages, language, isPremium, image, mode, tools),
            retryTimeoutPromise,
          ]);
          if (retryResponse) {
            let retryContent = retryResponse.content;
            if (mode === 'kids') {
              const outputScan = scanResponse(retryContent);
              if (!outputScan.safe) {
                logBlocked(parentUid || sessionId, 'output', outputScan.category);
                const fallback = getFallbackResponse();
                retryContent = JSON.stringify({ intent: fallback.intent, action: fallback.action, parameters: fallback.parameters, text: fallback.text });
              }
            }
            if (mode === 'car') {
              retryContent = sanitizeCarResponse(retryContent);
            }
            const retryParsed = this.parseResponse(retryContent);
            if (retryParsed.text) {
              parsed = retryParsed;
              responseContent = retryContent;
            }
          } else {
            logger.warn('LLM retry timed out — using localized fallback', { sessionId, retryTimeoutMs });
          }
        } catch (retryErr) {
          logger.warn('LLM retry failed', { sessionId, error: retryErr.message });
        }
      }

      // If text is still empty after retry, return a localized "please repeat" fallback.
      if (!parsed.text) {
        logger.warn('LLM returned empty text after retry — using localized fallback', { sessionId, language, rawContent: responseContent.substring(0, 300) });
        const fallbackJson = this._getRetryFallbackResponse(language);
        parsed = this.parseResponse(fallbackJson);
        responseContent = fallbackJson;
      }

      // Update conversation state
      conversation.messages.push({ role: 'user', content: text });
      conversation.messages.push({ role: 'assistant', content: responseContent });

      // Keep only last 10 exchanges for memory efficiency
      if (conversation.messages.length > 20) {
        conversation.messages = conversation.messages.slice(-20);
      }

      // #264 / #268 — Write path: extract facts from this turn and persist to Firestore.
      // Deferred via setImmediate so CPU extraction never blocks the response return path.
      if (uid) {
        const _uid = uid;
        const _text = text;
        const _parsedText = parsed.text;
        setImmediate(() => {
          const extracted = extractFactsFromTurn(_text, _parsedText);
          if (extracted.facts.length || Object.keys(extracted.preferences).length) {
            updateUserMemory(_uid, extracted).catch(err =>
              logger.warn('updateUserMemory failed', { uid: _uid, error: err.message }),
            );
          }
        });
      }

      return {
        intent: parsed.intent,
        slots: parsed.slots,
        response: {
          // #261 — scrub vendor brands (Google, Gemini, etc.) from grounding-injected text
          text: this._sanitizeBrandedResponse(parsed.text),
          action: parsed.action || null,
          parameters: parsed.parameters || {},
        },
        confidence: parsed.confidence || 0.85,
      };

    } catch (error) {
      logger.error('Chat processing error', { error: error.message, sessionId });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('PROVIDER_ERROR', `LLM error: ${this._sanitizeErrorMessage(error.message)}`, 503);
    }
  }

  /**
   * #269 — Streaming variant of processChat for personal/business modes.
   *
   * Performs the same auth, memory, grounding, and conversation-state logic as
   * processChat, but delegates to geminiService.chatStream and yields SSE-ready
   * events rather than returning a single buffered response.
   *
   * ONLY call this for mode='personal' or mode='business'.
   * Kids and car modes require full output scanning — use processChat instead.
   *
   * @yields {{ delta: string, done: boolean, meta?: object }}
   */
  async *processChatStream(options) {
    const { text, sessionId, requestId = null, context = {}, language = 'de-DE', isPremium = false, image = null, mode = 'personal', uid = null, grounding = false } = options;

    if (process.env.NODE_ENV === 'test' || this.llmProvider === 'test') {
      yield { delta: 'Test response', done: false };
      yield { delta: '', done: true, meta: { intent: 'test_intent', action: null, parameters: {}, confidence: 0.99 } };
      return;
    }

    const conversation = this.getConversationState(sessionId);

    // #268 — Non-blocking memory prefetch for stream mode.
    if (uid) {
      this._startMemoryPrefetch(conversation, uid, sessionId);
    }

    const systemPrompt = this.getSystemPrompt();
    if (conversation.language && conversation.language !== language) {
      conversation.messages = [{ role: 'system', content: systemPrompt }];
    }
    conversation.language = language;

    // Apply memory if prefetch is already available (no await).
    this._applyMemorySection(conversation);

    const messages = this.buildMessages(conversation, text, context, language);

    // #230 — Grounding is client-authoritative for streaming too.
    const needsGrounding = grounding === true;
    const tools = needsGrounding ? [{ googleSearch: {} }] : [];

    // #291 — Fire grounding Phase 1 immediately, before chatStream() starts, so
    // it runs in parallel with the (sync) message-building and context-injection
    // steps.  _chatWithGrounding() will await the in-flight promise instead of
    // launching a duplicate Phase 1 call.
    if (needsGrounding && this.llmProvider === 'vertex' && this.geminiService &&
        process.env.NODE_ENV !== 'test') {
      const prefetchModel = isPremium
        ? this.geminiService.modelPremium
        : this.geminiService.modelFree;
      this.geminiService._prefetchGroundingFacts(text, language, prefetchModel);
    }

    if (needsGrounding) {
      logger.info('Client requested stream grounding', { sessionId, mode });
    }

    let fullText = '';
    let finalMeta = null;
    // #302 — true when the upstream stream ended at MAX_TOKENS rather than completing
    // normally. Truncated responses must not be persisted or passed to memory extraction.
    let streamTruncated = false;

    try {
      for await (const event of this.geminiService.chatStream(messages, language, isPremium, image, tools, { requestId, sessionId, mode })) {
        if (!event.done) {
          const normalizedDelta = this._normalizeStreamDelta(event.delta);
          const sanitized = this._sanitizeBrandedResponse(normalizedDelta);
          fullText += sanitized;
          yield { delta: sanitized, done: false };
        } else {
          finalMeta = event.meta || {};
          streamTruncated = finalMeta.truncated === true;
          break;
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PROVIDER_ERROR', `LLM error: ${this._sanitizeErrorMessage(error.message)}`, 503);
    }

    // #302 — Only persist confirmed-complete responses. Truncated responses must not
    // pollute conversation history (which would corrupt multi-turn context) or
    // trigger memory extraction on partial data.
    if (!streamTruncated && fullText) {
      const responseContent = JSON.stringify({
        intent: finalMeta?.intent || 'unknown',
        action: finalMeta?.action || null,
        parameters: finalMeta?.parameters || {},
        text: fullText,
      });
      conversation.messages.push({ role: 'user', content: text });
      conversation.messages.push({ role: 'assistant', content: responseContent });
      if (conversation.messages.length > 20) {
        conversation.messages = conversation.messages.slice(-20);
      }
    }

    // Deferred fact extraction — fire-and-forget after stream ends
    if (uid && fullText && !streamTruncated) {
      const _uid = uid;
      setImmediate(() => {
        const extracted = extractFactsFromTurn(text, fullText);
        if (extracted.facts.length || Object.keys(extracted.preferences).length) {
          updateUserMemory(_uid, extracted).catch(err =>
            logger.warn('updateUserMemory failed (stream)', { uid: _uid, error: err.message }),
          );
        }
      });
    }

    yield {
      delta: '',
      done: true,
      // #302 — propagate truncated so the route emits an error frame instead of
      // a success frame when the response was cut short.
      meta: {
        intent: finalMeta?.intent || 'unknown',
        action: finalMeta?.action || null,
        parameters: finalMeta?.parameters || {},
        confidence: finalMeta?.confidence || 0.85,
        truncated: streamTruncated,
      },
    };
  }

  /**
   * Get or create conversation state for session
   */
  getConversationState(sessionId) {
    if (!this.conversationStates.has(sessionId)) {
      this.conversationStates.set(sessionId, {
        createdAt: Date.now(),
        language: null, // set on first request; used to detect language switches
        memoryLoaded: false,
        memoryLoadPromise: null,
        memorySection: null,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
        ],
      });
    }

    const state = this.conversationStates.get(sessionId);

    // Clean up old sessions (older than 1 hour)
    if (Date.now() - state.createdAt > 3600000) {
      this.conversationStates.delete(sessionId);
      return this.getConversationState(sessionId);
    }

    return state;
  }

  _startMemoryPrefetch(conversation, uid, sessionId) {
    if (!uid || conversation.memoryLoaded || conversation.memoryLoadPromise) {
      return;
    }

    conversation.memoryLoadPromise = (async () => {
      try {
        const userMemory = await loadUserMemory(uid);
        const memorySection = buildMemoryPromptSection(userMemory);
        conversation.memorySection = memorySection || null;
        if (memorySection) {
          logger.info('User memory prefetched for session', { sessionId, factCount: userMemory.facts.length });
        }
      } catch (error) {
        logger.warn('User memory prefetch failed', { sessionId, uid, error: error.message });
      } finally {
        conversation.memoryLoaded = true;
        conversation.memoryLoadPromise = null;
      }
    })();
  }

  _applyMemorySection(conversation) {
    const memorySection = conversation.memorySection;
    if (!memorySection || !conversation.messages?.length) {
      return;
    }

    const firstMessage = conversation.messages[0];
    if (!firstMessage || firstMessage.role !== 'system' || typeof firstMessage.content !== 'string') {
      return;
    }

    const memoryPrefix = `${memorySection}\n\n`;
    if (firstMessage.content.startsWith(memoryPrefix)) {
      return;
    }

    conversation.messages[0] = {
      role: 'system',
      content: `${memoryPrefix}${firstMessage.content}`,
    };
  }

  /**
   * Get system prompt for Assistant Pro.
   * #229 — Cached at first call to avoid rebuilding the large string on every request.
   */
  getSystemPrompt() {
    if (this._systemPrompt) return this._systemPrompt;
    this._systemPrompt = `You are Sylex, the Assistant Pro — a smart, friendly, multilingual voice assistant by Silverleaf AI for personal, business, and in-car use. Your name is Sylex. You always respond using the structured JSON format defined below.

CAPABILITIES
You can help with:
- General knowledge, facts, calculations, translations
- Real-time information: weather, news, sports scores, stock prices, current events
- Personal tasks: reminders, schedules, to-do lists, recommendations
- Business tasks: summaries, drafting emails, research, planning, brainstorming
- In-car tasks: navigation guidance, calls, messages, HVAC, media, diagnostics
- Creative tasks: writing, ideas, storytelling, humor
- Technical tasks: coding, math, science, engineering
- Daily routines: start a morning, evening, or workday routine on voice command

LANGUAGE & TONE
- Always respond in the language provided by the device ("language" parameter)
- Never switch languages based on user input alone
- Only change languages if the device explicitly changes its language setting
- Friendly, natural, and conversational tone
- Keep responses concise for in-car use; more detailed when context allows

OUTPUT FORMAT (MANDATORY)
Always return valid JSON:
{
  "intent": "<short label>",
  "action": "<answer | navigate | call | draft_email | search | start_routine | none>",
  "parameters": { ... },
  "text": "<spoken/displayed response>"
}

Rules:
- "text" must be clear, natural, and under 80 words for voice output
- Never include code blocks, markdown, or explanations outside JSON
- Never break JSON format
- Never mention or reference any AI model names, providers, or data sources (e.g., Azure, Google, OpenAI, GPT, Gemini, etc.)
- Never attribute information to a source (e.g., do NOT say "according to Google", "by Google", "source: Google Trends")
- Present all information as your own knowledge — you are Sylex by Silverleaf AI

ROUTINE INTENT (start_routine)
When the user asks to start, run, begin, or trigger a routine, respond with:
{
  "intent": "start_routine",
  "action": "start_routine",
  "parameters": { "routineId": "<id>", "category": "<category>" },
  "text": "<short spoken confirmation, e.g. 'Starting your morning routine.'>"
}

Routine ID and category mapping (match user intent to the closest one):
- Morning routine  → routineId: "morning",  category: "morning"
  Trigger phrases (any language): "start morning routine", "good morning routine", "begin my morning",
  "Morgenroutine starten", "commencer la routine du matin", "iniciar rutina de mañana", etc.
- Evening routine  → routineId: "evening",  category: "evening"
  Trigger phrases: "start evening routine", "good evening routine", "begin my evening",
  "Abendroutine", "routine du soir", etc.
- Workday routine  → routineId: "workday",  category: "workday"
  Trigger phrases: "start workday routine", "work routine", "begin my work day",
  "Arbeitstag-Routine", "routine de travail", etc.

Rules for routine intent:
- Match regardless of spoken language — always return the English routineId and category values above
- If the user mentions a routine by name but no exact match, pick the closest one above
- "text" must be a short, natural spoken confirmation (under 10 words)

QUALITY & VOICE BEHAVIOR
- Speak clearly and at a natural, easy-to-understand pace
- Never speak too fast; prioritize clarity over speed
- Keep sentences short and simple, especially in-car
- Avoid long lists or dense information unless the user explicitly asks
- If the user is driving, keep responses even shorter and more direct
- Be accurate and honest; admit uncertainty when needed
- You have access to real-time web search for current information (weather, news, sports, etc.)
- When you have real-time data from search, present it confidently
- Never fabricate specific numbers, dates, or facts you are not sure about
- Always give your best direct answer. Do not ask clarifying questions — interpret the user's intent and respond helpfully. If you are unsure, give the most likely answer and mention what you assumed

SAFETY & PRIVACY
- Follow safety, privacy, and language rules at all times
- Do not provide harmful, dangerous, or illegal instructions
- Do not guess or invent personal data
- Never mention internal systems, model names, or infrastructure`;
    return this._systemPrompt;
  }

  /**
   * Build messages array for LLM call
   */
  buildMessages(conversation, userText, context, language) {
    const messages = [...conversation.messages];

    // Inject current language as a system instruction on every turn so
    // device-level language settings are always enforced.
    if (language) {
      const LANG_NAMES = {
        'en-US': 'English',
        'en-GB': 'English',
        'de-DE': 'German',
        'de-AT': 'German',
        'de-CH': 'German',
        'fr-FR': 'French',
        'fr-BE': 'French',
        'fr-CH': 'French',
        'es-ES': 'Spanish',
        'es-MX': 'Spanish',
        'it-IT': 'Italian',
        'tr-TR': 'Turkish',
        'pl-PL': 'Polish',
        'pt-PT': 'Portuguese',
        'pt-BR': 'Portuguese',
        'nl-NL': 'Dutch',
        'ru-RU': 'Russian',
        'zh-CN': 'Chinese',
        'ja-JP': 'Japanese',
        'ko-KR': 'Korean',
        'vi-VN': 'Vietnamese',
      };
      const langName = LANG_NAMES[language] || language;
      messages.push({
        role: 'system',
        content: `DEVICE LANGUAGE: ${langName} (${language}). You MUST respond ONLY in ${langName}. This is a device setting — it overrides anything the user says. Every word of your response must be in ${langName}.`,
      });
    }

    // Add context as system note
    if (Object.keys(context).length > 0) {
      const contextNote = `[Context: ${JSON.stringify(context, (k, v) => {
        // Strip any PII from logging
        if (['userId', 'sessionId', 'email', 'phone'].includes(k)) return undefined;
        return v;
      })}]`;

      messages.push({
        role: 'user',
        content: `${contextNote}\n\n${userText}`,
      });
    } else {
      messages.push({
        role: 'user',
        content: userText,
      });
    }

    return messages;
  }

  /**
   * Returns a JSON-structured "please repeat" response string for the given
   * language. Used when the LLM returns an empty text field after a retry.
   */
  _getRetryFallbackResponse(language) {
    const lang = (language || 'en-US').toLowerCase();
    if (lang.startsWith('de')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Entschuldigung, ich konnte keine Antwort generieren. Könntest du deine Frage bitte wiederholen?"}';
    }
    if (lang.startsWith('fr')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Désolé, je n\'ai pas pu générer une réponse. Pourriez-vous répéter votre question?"}';
    }
    if (lang.startsWith('es')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Lo siento, no pude generar una respuesta. ¿Podrías repetir tu pregunta?"}';
    }
    if (lang.startsWith('it')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Mi dispiace, non sono riuscito a generare una risposta. Potresti ripetere la tua domanda?"}';
    }
    if (lang.startsWith('tr')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Üzgünüm, bir yanıt oluşturamadım. Sorunuzu tekrar sorabilir misiniz?"}';
    }
    if (lang.startsWith('pl')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Przepraszam, nie udało mi się wygenerować odpowiedzi. Czy mógłbyś powtórzyć pytanie?"}';
    }
    if (lang.startsWith('ru')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Извините, мне не удалось сгенерировать ответ. Не могли бы вы повторить вопрос?"}';
    }
    if (lang.startsWith('vi')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Xin lỗi, tôi không thể tạo câu trả lời. Bạn có thể lặp lại câu hỏi không?"}';
    }
    if (lang.startsWith('zh')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"抱歉，我无法生成回答。请问您可以重复一下问题吗？"}';
    }
    if (lang.startsWith('ja')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"申し訳ありませんが、回答を生成できませんでした。もう一度質問していただけますか？"}';
    }
    if (lang.startsWith('ko')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"죄송합니다. 응답을 생성할 수 없었습니다. 질문을 다시 말씀해 주시겠어요?"}';
    }
    if (lang.startsWith('nl')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Sorry, ik kon geen antwoord genereren. Kun je je vraag herhalen?"}';
    }
    if (lang.startsWith('pt')) {
      return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Desculpe, não consegui gerar uma resposta. Poderia repetir a sua pergunta?"}';
    }
    return '{"intent":"retry_fallback","action":"none","parameters":{},"text":"Sorry, I couldn\'t generate a response. Could you please repeat your question?"}';
  }

  /**
   * Returns a JSON-structured content-policy response string for the given
   * language. Used whenever the AI service's content filter is triggered so
   * vendor names are never exposed to the end user.
   */
  _getPolicyResponse(language) {
    const lang = (language || 'en-US').toLowerCase();
    if (lang.startsWith('de')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Entschuldigung, darauf kann ich leider nicht eingehen. Bitte stellen Sie eine andere Frage."}';
    }
    if (lang.startsWith('fr')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Désolé, je ne peux pas répondre à cela. Veuillez poser une autre question."}';
    }
    if (lang.startsWith('es')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Lo siento, no puedo responder a eso. Por favor, haz otra pregunta."}';
    }
    if (lang.startsWith('it')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Mi dispiace, non posso rispondere a questo. Per favore, fai un\'altra domanda."}';
    }
    if (lang.startsWith('tr')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Üzgünüm, buna cevap veremiyorum. Lütfen başka bir soru sorun."}';
    }
    if (lang.startsWith('pl')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Przepraszam, nie mogę na to odpowiedzieć. Proszę zadać inne pytanie."}';
    }
    if (lang.startsWith('ru')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Извините, я не могу ответить на это. Пожалуйста, задайте другой вопрос."}';
    }
    if (lang.startsWith('vi')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Xin lỗi, tôi không thể trả lời điều đó. Vui lòng hỏi câu hỏi khác."}';
    }
    if (lang.startsWith('zh')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"抱歉，我无法回答这个问题。请提出其他问题。"}';
    }
    if (lang.startsWith('ja')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"申し訳ございませんが、お答えできません。別のご質問をお願いします。"}';
    }
    if (lang.startsWith('ko')) {
      return '{"intent":"content_blocked","action":"none","parameters":{},"text":"죄송합니다. 해당 질문에 답변할 수 없습니다. 다른 질문을 해주세요."}';
    }
    return '{"intent":"content_blocked","action":"none","parameters":{},"text":"Sorry, I can\'t help with that. Please ask me something else."}';
  }

  /** Returns true when the text contains vendor-specific policy language. */
  _containsBrandedPolicy(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return lower.includes('azure') ||
           lower.includes('openai') ||
           lower.includes('google') ||
           lower.includes('gemini') ||
           lower.includes('vertex') ||
           lower.includes('content management policy') ||
           lower.includes('content_filter');
  }

  /**
   * #261 — Strip AI-vendor brand names from user-facing response text.
   * Gemini grounding can inject phrases like "by Google", "Google Trends",
   * "according to Google" into the LLM output despite the system prompt rule.
   * This sanitizer runs on the final parsed text before it reaches the client.
   */
  _sanitizeBrandedResponse(text) {
    if (!text) return text;
    return text
      // "New trend by Google" → "New trend"
      .replace(/\s+by\s+Google\b/gi, '')
      // "according to Google" / "according to Google Search"
      .replace(/\baccording\s+to\s+Google(?:\s+Search)?\s*[,.]?\s*/gi, '')
      // "source: Google" / "(source: Google Trends)"
      .replace(/\s*\(?source:\s*Google(?:\s+\w+)?\)?\s*/gi, ' ')
      // "Google Trends" / "Google Search" / "Google News" → just "online sources"
      .replace(/\bGoogle\s+(?:Trends?|Search|News)\b/gi, 'online sources')
      // "based on Google" / "from Google" → neutral phrasing
      .replace(/\bbased\s+on\s+Google\b/gi, 'based on current data')
      .replace(/\bfrom\s+Google\b/gi, 'from online sources')
      // Standalone "Google" in flowing text
      .replace(/\bGoogle\b/g, 'Silverleaf')
      // "by Gemini" / "powered by OpenAI" / "by Vertex AI" etc.
      .replace(/\s*(?:powered\s+)?by\s+(?:Gemini|Vertex\s*AI|OpenAI|Azure|GPT[-\s]?\d*)\s*[,.]?\s*/gi, ' ')
      .replace(/\b(?:Gemini|Vertex\s*AI|OpenAI|Azure)\b/gi, 'Silverleaf')
      // Clean up double spaces left by replacements
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Streaming guardrail: if a provider chunk is accidentally JSON-shaped,
   * extract only the user-facing text to avoid speaking JSON aloud in TTS.
   */
  _normalizeStreamDelta(delta) {
    if (typeof delta !== 'string') return '';
    const trimmed = delta.trim();
    if (!trimmed) return '';

    // Fast path for normal text chunks — not JSON-shaped, not a fence.
    // Secondary check: even if the string does not start with '{', it may contain
    // an embedded JSON object with LLM structural fields (preamble+JSON pattern).
    // Require ≥ 2 structural fields co-occurring so natural-language sentences that
    // happen to contain one keyword word are not falsely flagged. (#295)
    const structuralMatches = (trimmed.match(/"(?:intent|action|parameters)"\s*:/g) || []).length;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('```') && structuralMatches < 2) {
      return delta;
    }

    // Delta is JSON-shaped or fence-wrapped.  Never pass raw JSON to the client
    // (it would be spoken aloud by TTS).  Extract the spoken text field or drop.
    const fenceMatch = trimmed.match(/^```[a-z]*\s*\n?([\s\S]*?)```\s*$/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

    try {
      const jsonStr = this._extractFirstJson(candidate);
      // No complete JSON object found yet (partial chunk) — drop it.
      // The geminiService progressive extractor emits only the text portion,
      // so this branch is only hit if a rogue complete-JSON chunk leaks through.
      if (!jsonStr) return '';
      const parsed = JSON.parse(jsonStr);
      const textCandidate = parsed?.text ?? parsed?.response?.text ?? null;
      if (typeof textCandidate === 'string' && textCandidate.trim()) {
        return textCandidate.trim();
      }
      return '';
    } catch {
      // Unparseable JSON-shaped chunk — drop it rather than speaking raw JSON.
      return '';
    }
  }

  /** Removes known AI-vendor brand names from an error message string. */
  _sanitizeErrorMessage(message) {
    return (message || '')
      .replace(/\bAzure\s*OpenAI\b/gi, 'AI service')
      .replace(/\bAzure\b/gi, 'AI service')
      .replace(/\bOpenAI\b/gi, 'AI service')
      .replace(/\bGoogle\s*Cloud\b/gi, 'AI service')
      .replace(/\bVertex\s*AI\b/gi, 'AI service')
      .replace(/\bGemini\b/gi, 'AI service');
  }

  /**
   * Call LLM with configured provider
   *
   * @param {Array}   [tools] - Vertex AI tools array. Pass [] to disable grounding.
   *                            Defaults to [] (off). processChat classifier enables
   *                            [{googleSearch:{}}] only for real-time queries.
   */
  async callLLM(messages, language, isPremium = false, image = null, mode = 'personal', tools = []) {
    // Business mode → DeepSeek-V3.1 (with automatic Gemini fallback when key is absent)
    if (mode === 'business' && this.deepSeekService?.isConfigured) {
      try {
        return await this.deepSeekService.chat(messages, language, isPremium);
      } catch (err) {
        // Only fall back on infrastructure errors (5xx), not auth/premium errors
        if (err.statusCode >= 500 || err.statusCode === undefined) {
          logger.warn('DeepSeek unavailable — falling back to Gemini', { error: err.message });
        } else {
          throw err;
        }
      }
    }

    // Kids mode → Claude Haiku (with Gemini fallback)
    if (mode === 'kids' && this.claudeService?.isConfigured) {
      try {
        return await this.claudeService.chat(messages, language, isPremium);
      } catch (err) {
        if (err.statusCode >= 500 || err.statusCode === undefined) {
          logger.warn('Claude unavailable — falling back to Gemini', { error: err.message });
        } else {
          throw err;
        }
      }
    }

    if (this.llmProvider === 'vertex' && this.geminiService) {
      return this.geminiService.chat(messages, language, isPremium, image, tools);
    }

    throw new AppError('PROVIDER_ERROR', 'No LLM provider configured', 503);
  }

  /**
   * Parse LLM response to extract structured data.
   * The LLM sometimes wraps its JSON in markdown code fences (```json ... ```)
   * and may append prose text after the fence. Strip the fence first so the
   * greedy JSON regex does not over-match on any `}` characters in trailing text.
   */
  parseResponse(responseText) {
    try {
      // Strip markdown code fences: ```[lang]\n...\n``` (must happen before extraction).
      // Gemini occasionally returns a fenced block without the closing ``` when the
      // response is split across multiple parts and only part[0] was read (now fixed in
      // geminiService), but we handle the unclosed-fence case defensively here too.
      const fenceMatch = responseText.match(/```[a-z]*\s*\n?([\s\S]*?)```/);
      const cleaned = fenceMatch
        ? fenceMatch[1].trim()
        : responseText.replace(/^```[a-zA-Z]*\s*\n?/, '').trim();

      // Extract the first balanced JSON object by brace counting.
      // A greedy regex (/\{[\s\S]*\}/) spans from the first { to the LAST }
      // in the string — if the LLM appends extra text or emits two objects,
      // JSON.parse fails on the combined string and we fall through to raw text.
      const jsonStr = this._extractFirstJson(cleaned);
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        // Never fall back to raw responseText — it may be a JSON block or fenced
        // code that would be read aloud verbatim by TTS. Use empty string so the
        // client can decide to retry or stay silent.
        return {
          intent: parsed.intent || 'unknown',
          slots: parsed.slots || parsed.parameters || {},
          text: parsed.text || '',
          action: parsed.action || null,
          parameters: parsed.parameters || {},
          confidence: parsed.confidence || 0.85,
        };
      }
    } catch (e) {
      logger.warn('Failed to parse LLM response as JSON', { response: responseText.substring(0, 100) });
    }

    // Fallback: JSON could not be found or parsed.
    // If the response _starts_ with '{' or a markdown fence it was meant to be
    // JSON and should not be read aloud by TTS.  Plain conversational text from
    // Google Search grounding may _contain_ incidental '{' characters (URLs,
    // metadata) — those responses are safe to return as spoken text.
    const trimmed = responseText.trim();
    const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('```');
    const plainText = looksLikeJson ? '' : trimmed;
    return {
      intent: 'unknown',
      slots: {},
      text: plainText,
      action: null,
      parameters: {},
      confidence: 0.5,
    };
  }

  /**
   * Extract the first syntactically balanced JSON object from `text` by
   * counting braces. More robust than a greedy regex when the LLM outputs
   * trailing text or multiple top-level objects.
   */
  _extractFirstJson(text) {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      // Ignore braces while inside JSON strings, honoring escaped quotes.
      if (inString) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === '\\') {
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        if (depth === 0) {
          // Ignore unmatched closing braces before the first JSON object.
          continue;
        }
        depth--;
        if (depth === 0 && start !== -1) {
          return text.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  /**
   * Clear old sessions (cleanup)
   */
  clearOldSessions(maxAgeMs = 3600000) {
    const now = Date.now();
    let cleared = 0;

    for (const [sessionId, state] of this.conversationStates.entries()) {
      if (now - state.createdAt > maxAgeMs) {
        this.conversationStates.delete(sessionId);
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.info(`Cleared ${cleared} old conversation sessions`);
    }

    return cleared;
  }

  /**
   * Return active in-memory session count for admin/status endpoints.
   * Performs a quick prune pass so expired sessions are not counted.
   */
  getSessionCount() {
    this.clearOldSessions();
    return this.conversationStates.size;
  }
}

export default ChatService;
