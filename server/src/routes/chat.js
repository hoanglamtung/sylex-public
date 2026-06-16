import express from 'express';
import rateLimit from 'express-rate-limit';
import ChatService from '../services/chatService.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { metricsCollector } from '../utils/metrics.js';
import { SUPPORTED_LANGUAGES } from '../config/supportedLanguages.js';

const router = express.Router();

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_CHAT || 200),
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('chat');
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        requestId: req.id,
      },
    });
  },
});

// Initialize chat service
const chatService = new ChatService();
/**
 * POST /chat
 * Process natural language query
 */
router.post('/', limiter, optionalAuthMiddleware, async (req, res, next) => {
  const startTime = Date.now();
  try {
    // Validate request
    const { text, sessionId, context, language = 'en-US', imageBase64, imageMimeType, imageGcsUri, mode = 'personal', parentUid, grounding = false } = req.body;

    const VALID_MODES = ['personal', 'voice', 'business', 'kids', 'car'];
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}`,
          requestId: req.id,
        },
      });
    }

    if (language && !SUPPORTED_LANGUAGES.includes(language)) {
      return res.status(400).json({
        error: {
          code: 'UNSUPPORTED_LANGUAGE',
          message: `Unsupported language code. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
          requestId: req.id,
        },
      });
    }

    if (!text) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Text is required',
          requestId: req.id,
        },
      });
    }

    if (text.length > 500) {
      return res.status(400).json({
        error: {
          code: 'TEXT_TOO_LONG',
          message: 'Text exceeds maximum length of 500 characters',
          requestId: req.id,
        },
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Session ID is required',
          requestId: req.id,
        },
      });
    }

    logger.info('Chat request received', {
      requestId: req.id,
      sessionId,
      textLength: text.length,
      language,
    });

    // Process chat
    // isPremium is set by the Firebase Auth middleware (#124/#125) via req.user.
    // If the token has no claim or the middleware is not yet active, defaults to false.
    // Never trust a client-supplied value — always read from req.user (server-verified).
    const isPremium = req.user?.isPremium ?? false;

    // Premium mode gate (#125):
    // personal + voice are free. business, kids, car require an active Premium subscription.
    // v2.0: extend PREMIUM_PLUS_MODES for precision/brain-router features.
    const PREMIUM_MODES = ['business', 'kids', 'car'];
    if (PREMIUM_MODES.includes(mode) && !isPremium) {
      return res.status(403).json({
        error: {
          code: 'PREMIUM_REQUIRED',
          message: `The "${mode}" assistant requires a Silverleaf Premium subscription.`,
          requestId: req.id,
        },
      });
    }

    // Build optional image attachment for multimodal queries (#135).
    // imageBase64 / imageGcsUri come from the client after it has
    // compressed and validated the file client-side (#131).
    let image = null;
    if (imageBase64 || imageGcsUri) {
      image = {
        ...(imageBase64  && { base64: imageBase64 }),
        ...(imageGcsUri  && { gcsUri: imageGcsUri }),
        mimeType: imageMimeType || 'image/jpeg',
      };
    }

    const result = await chatService.processChat({
      text,
      sessionId,
      context,
      language,
      isPremium,
      image,
      mode,
      parentUid,
      grounding: grounding === true, // #230 — sanitise: boolean only, never trust raw client value
    });

    const processingTimeMs = Date.now() - startTime;

    // Record metrics
    metricsCollector.recordLatency('chat', processingTimeMs);
    metricsCollector.recordRequest('chat', 200);

    // Set response headers
    res.setHeader('X-Processing-Time-Ms', processingTimeMs);

    // Send response
    res.json({
      requestId: req.id,
      sessionId,
      intent: result.intent,
      slots: result.slots,
      response: result.response,
      confidence: result.confidence,
      processingTimeMs,
    });

    logger.info('Chat request completed', {
      requestId: req.id,
      processingTimeMs,
      intent: result.intent,
      confidence: result.confidence,
    });

  } catch (error) {
    metricsCollector.recordError('chat', error.code || 'UNKNOWN');
    next(error);
  }
});

/**
 * GET /chat/sessions
 * Get session count (admin endpoint)
 */
router.get('/sessions', (req, res) => {
  const count = chatService.getSessionCount();
  res.json({
    activeSessions: count,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /chat/stream  (#269)
 *
 * SSE streaming endpoint for personal and business modes.
 * Kids and car modes are rejected — they require full output scanning.
 *
 * Event format (text/event-stream):
 *   event: text
 *   data: {"delta":"<chunk>"}\n\n
 *
 *   event: meta
 *   data: {"intent":"...","action":"...","parameters":{...},"confidence":0.9}\n\n
 *
 * Backward compatibility (current RN client):
 *   data: {"delta":"<chunk>","done":false}\n\n
 *   ...
 *   data: {"delta":"","done":true,"meta":{...}}\n\n
 *   data: [DONE]\n\n
 *
 * Optional heartbeat (env-gated):
 *   : ping\n\n
 *
 * The client starts TTS on the first chunk, accumulates them, and uses
 * the final meta event for intent/action routing.
 */
router.post('/stream', limiter, optionalAuthMiddleware, async (req, res) => {
  const { text, sessionId, context, language = 'en-US', imageBase64, imageMimeType, imageGcsUri, mode = 'personal', grounding = false } = req.body;

  // Kids and car require full output scan/sanitize — streaming not supported
  const STREAMING_MODES = ['personal', 'voice', 'business'];
  if (!STREAMING_MODES.includes(mode)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: `Streaming is not supported for mode "${mode}". Use POST /chat instead.`,
        requestId: req.id,
      },
    });
  }

  if (!text || !sessionId) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'text and sessionId are required', requestId: req.id },
    });
  }

  if (language && !SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).json({
      error: { code: 'UNSUPPORTED_LANGUAGE', message: `Unsupported language: ${language}`, requestId: req.id },
    });
  }

  const isPremium = req.user?.isPremium ?? false;
  const PREMIUM_MODES = ['business'];
  if (PREMIUM_MODES.includes(mode) && !isPremium) {
    return res.status(403).json({
      error: { code: 'PREMIUM_REQUIRED', message: `The "${mode}" assistant requires a Silverleaf Premium subscription.`, requestId: req.id },
    });
  }

  let image = null;
  if (imageBase64 || imageGcsUri) {
    image = {
      ...(imageBase64 && { base64: imageBase64 }),
      ...(imageGcsUri && { gcsUri: imageGcsUri }),
      mimeType: imageMimeType || 'image/jpeg',
    };
  }

  // SSE headers — disable nginx/CDN buffering so chunks arrive immediately
  res.setHeader('Content-Type', 'text/event-stream');
  // no-transform prevents intermediaries from buffering/modifying chunks.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Request-ID', req.id);
  res.flushHeaders();
  // Disable Nagle to reduce small-chunk latency for TTS-first-byte UX.
  res.socket?.setNoDelay(true);

  const uid = req.user?.uid ?? null;
  const heartbeatMs = Math.max(0, parseInt(process.env.SSE_HEARTBEAT_MS || '0', 10) || 0);
  const startTime = Date.now();
  let clientDisconnected = false;
  let heartbeatTimer = null;
  let firstChunkLatencyMs = null;
  let firstProviderEventLatencyMs = null;
  let firstSseWriteLatencyMs = null;
  let firstSseWriteAfterProviderMs = null;
  let streamChunkCount = 0;

  req.on('close', () => {
    clientDisconnected = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  const writeEvent = (data, eventName = null) => {
    let frame = '';
    if (eventName) {
      frame += `event: ${eventName}\n`;
    }
    frame += `data: ${JSON.stringify(data)}\n\n`;
    res.write(frame);
    if (typeof res.flush === 'function') {
      res.flush();
    }
  };

  const writeRawEvent = (payload) => {
    res.write(`data: ${payload}\n\n`);
    if (typeof res.flush === 'function') {
      res.flush();
    }
  };

  const writeHeartbeat = () => {
    // SSE comment frame: ignored by clients, useful for keeping idle proxies alive.
    res.write(': ping\n\n');
    if (typeof res.flush === 'function') {
      res.flush();
    }
  };

  try {
    if (heartbeatMs > 0) {
      heartbeatTimer = setInterval(() => {
        if (clientDisconnected || res.writableEnded) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          return;
        }
        writeHeartbeat();
      }, heartbeatMs);
      if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }
    }

    const stream = chatService.processChatStream({
      text,
      sessionId,
      requestId: req.id,
      context,
      language,
      isPremium,
      image,
      mode,
      uid,
      grounding: grounding === true,
    });

    // #294 Option A — Adaptive timeout: emit a grounding_start event as the
    // very first SSE frame when grounding is active so the client can extend
    // its timeout budget before any text chunks arrive.
    // Default hint: 25 s; override via GROUNDING_STREAM_TIMEOUT_HINT_MS (min 20 s).
    // Guard: car/kids mode takes the buffered path — chatService skips grounding,
    // so don't mislead the client into extending its timeout unnecessarily.
    const willGround = grounding === true && mode !== 'car' && mode !== 'kids';
    if (willGround) {
      const timeoutHintMs = Math.max(20000, parseInt(process.env.GROUNDING_STREAM_TIMEOUT_HINT_MS || '25000', 10) || 25000);
      writeEvent({ timeoutHintMs }, 'grounding_start');
    }

    for await (const event of stream) {
      // Abort if client disconnected mid-stream
      if (clientDisconnected || res.writableEnded) break;

      const isTextDelta = !event?.done && typeof event?.delta === 'string' && event.delta.length > 0;
      if (isTextDelta) {
        streamChunkCount += 1;
        if (firstProviderEventLatencyMs === null) {
          // t1 - t0: time until first provider text event reaches route loop
          firstProviderEventLatencyMs = Date.now() - startTime;
          metricsCollector.recordLatency('chat_stream_first_provider_event', firstProviderEventLatencyMs);
        }
      }

      if (firstChunkLatencyMs === null && !event?.done && typeof event?.delta === 'string' && event.delta.length > 0) {
        firstChunkLatencyMs = Date.now() - startTime;
        metricsCollector.recordLatency('chat_stream_first_chunk', firstChunkLatencyMs);
      }

      if (event?.done) {
        if (event.meta?.truncated) {
          // #302 — Stream ended at MAX_TOKENS: the response is incomplete.
          // Emit an error frame so the client surfaces a retry state rather than
          // displaying or persisting a partial answer as a successful response.
          logger.warn('SSE: stream truncated at MAX_TOKENS — emitting error frame', { sessionId, requestId: req.id, streamChunkCount });
          metricsCollector.recordError('chat_stream', 'STREAM_TRUNCATED');
          writeEvent({ error: { code: 'STREAM_TRUNCATED', message: 'Response was cut short. Please try again.' }, done: true });
        } else {
          // New protocol: explicit final metadata event.
          writeEvent(event.meta || {}, 'meta');
          // Backward compatibility: keep legacy data-only done frame.
          writeEvent(event);
        }
      } else if (isTextDelta) {
        // Route-level SSE guard: never emit a JSON-shaped delta to the client.
        // chatService._normalizeStreamDelta already filters these, but this is
        // the last line of defense so old/rogue chunks never reach TTS.
        // Also catch preamble+JSON (≥2 structural LLM fields) for consistency (#295).
        const structuralHits = (event.delta.match(/"(?:intent|action|parameters)"\s*:/g) || []).length;
        const safeD = (event.delta.trimStart().startsWith('{') || structuralHits >= 2) ? '' : event.delta;
        if (!safeD) {
          // Structural JSON slipped through — log and skip this frame.
          logger.warn('SSE route: dropped JSON-shaped delta', { sessionId, requestId: req.id, preview: event.delta.slice(0, 60) });
          continue; // eslint-disable-line no-continue
        }
        // New protocol: explicit streamed text event.
        writeEvent({ delta: safeD }, 'text');
        // Backward compatibility: keep legacy data-only delta frame.
        writeEvent({ delta: safeD, done: false });
      } else {
        // Preserve legacy behavior for non-text intermediary frames.
        writeEvent(event);
      }

      if (isTextDelta && firstSseWriteLatencyMs === null) {
        // t2 - t0: time until first SSE write is executed
        firstSseWriteLatencyMs = Date.now() - startTime;
        // t2 - t1: route-side gap between first provider event and first SSE write
        firstSseWriteAfterProviderMs =
          firstProviderEventLatencyMs === null
            ? null
            : firstSseWriteLatencyMs - firstProviderEventLatencyMs;
        if (firstSseWriteAfterProviderMs !== null) {
          metricsCollector.recordLatency('chat_stream_first_write_after_provider', firstSseWriteAfterProviderMs);
        }
      }
    }

    if (!clientDisconnected && !res.writableEnded) {
      writeRawEvent('[DONE]');
      const processingTimeMs = Date.now() - startTime;
      metricsCollector.recordLatency('chat_stream', processingTimeMs);
      metricsCollector.recordRequest('chat_stream', 200);
      logger.info('Chat stream completed', {
        requestId: req.id,
        sessionId,
        processingTimeMs,
        streamChunkCount,
        firstChunkLatencyMs,
        firstProviderEventLatencyMs,
        firstSseWriteLatencyMs,
        firstSseWriteAfterProviderMs,
      });
      res.end();
    }
  } catch (error) {
    logger.error('Chat stream error', { error: error.message, requestId: req.id, sessionId });
    metricsCollector.recordError('chat_stream', error.code || 'UNKNOWN');
    if (!res.writableEnded) {
      if (error.code === 'RATE_LIMIT_EXCEEDED') {
        // Emit a localised spoken fallback delta so TTS still has audio to play
        // when the retry budget is exhausted — satisfies AC #3 from issue #293.
        const fallbackDelta = chatService._getRetryFallbackResponse(req.body?.language || 'en-US');
        writeEvent({ delta: fallbackDelta, done: false });
      }
      writeEvent({ error: { code: error.code || 'PROVIDER_ERROR', message: 'Stream error — please retry.' }, done: true });
      res.end();
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
});

export default router;
