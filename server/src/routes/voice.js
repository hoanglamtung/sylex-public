import express from 'express';
import rateLimit from 'express-rate-limit';
import ChatService from '../services/chatService.js';
import TtsService from '../services/ttsService.js';
import authMiddleware from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { SUPPORTED_LANGUAGES } from '../config/supportedLanguages.js';
import { metricsCollector } from '../utils/metrics.js';

const router = express.Router();

// Stricter rate limit — pipeline is more expensive than individual endpoints
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_VOICE || 50),
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many voice requests. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('voice');
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many voice requests. Please try again later.',
        requestId: req.id,
      },
    });
  },
});

// Service singletons
const chatService = new ChatService();
const ttsService = new TtsService();

/**
 * POST /v1/voice/text
 * Text-only voice pipeline: text in → chat → response text out (#215)
 *
 * The sole voice endpoint. Client performs STT on-device, sends the transcript
 * here, and handles TTS on-device. Server does LLM chat only (skipTts=true
 * by default from the client). Old audio-upload endpoint was removed in PR #228.
 *
 * JSON body fields:
 *   text       — transcript from on-device STT (required)
 *   sessionId  — conversation session ID (required)
 *   mode       — personal | voice | business | kids | car (default: personal)
 *   language   — BCP-47 language code (default: en-US)
 *   parentUid  — required when mode = kids
 *   skipTts    — skip server TTS; client handles playback (default: false)
 */
router.post('/text', limiter, authMiddleware, express.json(), async (req, res, next) => {
  const startTime = Date.now();
  const timings = {};

  try {
    const {
      text,
      sessionId,
      mode = 'personal',
      language = 'en-US',
      parentUid = null,
      skipTts = false,
      grounding = false, // #230 — client-supplied real-time query hint
    } = req.body || {};

    if (!text || !text.trim()) {
      throw new AppError('INVALID_REQUEST', 'text is required', 400);
    }
    if (!sessionId) {
      throw new AppError('INVALID_REQUEST', 'sessionId is required', 400);
    }

    const VALID_MODES = ['personal', 'voice', 'business', 'kids', 'car'];
    if (!VALID_MODES.includes(mode)) {
      throw new AppError('INVALID_MODE', `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}`, 400);
    }

    if (language && !SUPPORTED_LANGUAGES.includes(language)) {
      throw new AppError('UNSUPPORTED_LANGUAGE', `Unsupported language code. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`, 400);
    }

    const isPremium = req.user?.isPremium ?? false;
    if (!isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'The voice pipeline requires a Silverleaf Premium subscription.', 403);
    }

    logger.info('Voice text pipeline request', { requestId: req.id, sessionId, mode, language, textLength: text.trim().length });

    // --- Chat ---
    const chatStart = Date.now();
    const chatResult = await chatService.processChat({
      text: text.trim(),
      sessionId,
      language,
      isPremium,
      mode,
      parentUid,
      grounding: grounding === true, // #230 — sanitise: boolean only, never trust raw client value
      uid: req.user?.uid ?? null, // #227 — for long-term user memory lookup
    });
    timings.chatMs = Date.now() - chatStart;

    const raw = chatResult?.response;
    const responseText = (typeof raw === 'string' ? raw : raw?.text) || chatResult?.text || '';

    logger.info('Chat complete', { requestId: req.id, responseLength: responseText.length, chatMs: timings.chatMs });

    // --- TTS ---
    // skipTts=true: client handles TTS on-device (#220/#221) — skip server synthesis to save cost + latency.
    let audioBase64 = null;
    if (!skipTts && responseText) {
      const ttsStart = Date.now();
      const ttsResult = await ttsService.synthesize({
        text: responseText,
        language,
        audioFormat: 'mp3',
        speakingRate: mode === 'car' ? 0.9 : parseFloat(process.env.TTS_SPEAKING_RATE || 1.0),
      });
      timings.ttsMs = Date.now() - ttsStart;
      audioBase64 = ttsResult.audioData.toString('base64');
    } else {
      if (!skipTts) logger.warn('Chat returned empty text — skipping TTS', { requestId: req.id });
      timings.ttsMs = 0;
    }
    timings.totalMs = Date.now() - startTime;

    logger.info('Voice text pipeline complete', { requestId: req.id, ...timings });

    metricsCollector.recordLatency('voice_text', timings.totalMs);
    metricsCollector.recordRequest('voice_text', 200);

    res.setHeader('X-Processing-Time-Ms', timings.totalMs);
    res.setHeader('X-Chat-Time-Ms', timings.chatMs);
    res.setHeader('X-TTS-Time-Ms', timings.ttsMs);

    return res.json({
      transcript: text.trim(),
      response: responseText,
      audio: audioBase64,
      audioMimeType: 'audio/mpeg',
      sessionId,
      language,
      mode,
    });

  } catch (err) {
    metricsCollector.recordRequest('voice_text', err.statusCode || 500);
    next(err);
  }
});

export default router;
