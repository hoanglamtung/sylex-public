/**
 * Premium feature routes — #128
 *
 * POST /v1/premium/summarise   — summarise a transcript or document
 * POST /v1/premium/plan        — AI-assisted trip/task planning
 * POST /v1/premium/orchestrate — multi-step task orchestration (5-min session cap)
 * DELETE /v1/premium/orchestrate/:sessionId — explicitly end a long-form session
 *
 * All routes gate on isPremium from req.user (Firebase Auth custom claim, #125).
 * Until #125 ships, isPremium defaults to false and all calls return 403.
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import PremiumService from '../services/premiumService.js';
import authMiddleware from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { metricsCollector } from '../utils/metrics.js';

const router = express.Router();

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_CHAT || 200),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('premium');
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        requestId: req.id,
      },
    });
  },
});

const premiumService = new PremiumService();

// ─── Helper ──────────────────────────────────────────────────────────────────

function getPremiumFlag(req) {
  // isPremium must come from the server-verified Firebase Auth custom claim.
  // req.user is populated by the auth middleware (#125).
  // Until that middleware lands, all requests are treated as free tier.
  return req.user?.isPremium ?? false;
}

// ─── POST /summarise ─────────────────────────────────────────────────────────

router.post('/summarise', limiter, authMiddleware, async (req, res, next) => {
  const startTime = Date.now();
  try {
    const { text, language = 'de-DE' } = req.body;

    if (!text) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'text is required', requestId: req.id },
      });
    }

    if (text.length > 8000) {
      return res.status(400).json({
        error: { code: 'TEXT_TOO_LONG', message: 'text exceeds 8000 characters (~2000 tokens)', requestId: req.id },
      });
    }

    const isPremium = getPremiumFlag(req);
    const result = await premiumService.summarise(text, language, isPremium);
    const processingTimeMs = Date.now() - startTime;

    metricsCollector.recordLatency('premium_summarise', processingTimeMs);
    metricsCollector.recordRequest('premium_summarise', 200);
    res.setHeader('X-Processing-Time-Ms', processingTimeMs);

    res.json({ requestId: req.id, ...result, processingTimeMs });

    logger.info('Premium summarise completed', { requestId: req.id, processingTimeMs });
  } catch (error) {
    metricsCollector.recordError('premium_summarise', error.code || 'UNKNOWN');
    next(error);
  }
});

// ─── POST /plan ──────────────────────────────────────────────────────────────

router.post('/plan', limiter, authMiddleware, async (req, res, next) => {
  const startTime = Date.now();
  try {
    const { prompt, language = 'de-DE' } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'prompt is required', requestId: req.id },
      });
    }

    if (prompt.length > 500) {
      return res.status(400).json({
        error: { code: 'TEXT_TOO_LONG', message: 'prompt exceeds 500 characters', requestId: req.id },
      });
    }

    const isPremium = getPremiumFlag(req);
    const result = await premiumService.plan(prompt, language, isPremium);
    const processingTimeMs = Date.now() - startTime;

    metricsCollector.recordLatency('premium_plan', processingTimeMs);
    metricsCollector.recordRequest('premium_plan', 200);
    res.setHeader('X-Processing-Time-Ms', processingTimeMs);

    res.json({ requestId: req.id, ...result, processingTimeMs });

    logger.info('Premium plan completed', { requestId: req.id, processingTimeMs });
  } catch (error) {
    metricsCollector.recordError('premium_plan', error.code || 'UNKNOWN');
    next(error);
  }
});

// ─── POST /orchestrate ───────────────────────────────────────────────────────

router.post('/orchestrate', limiter, authMiddleware, async (req, res, next) => {
  const startTime = Date.now();
  try {
    const { prompt, sessionId, language = 'de-DE' } = req.body;

    if (!prompt) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'prompt is required', requestId: req.id },
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'sessionId is required', requestId: req.id },
      });
    }

    if (prompt.length > 500) {
      return res.status(400).json({
        error: { code: 'TEXT_TOO_LONG', message: 'prompt exceeds 500 characters', requestId: req.id },
      });
    }

    const isPremium = getPremiumFlag(req);
    const result = await premiumService.orchestrate(prompt, sessionId, language, isPremium);
    const processingTimeMs = Date.now() - startTime;

    metricsCollector.recordLatency('premium_orchestrate', processingTimeMs);
    metricsCollector.recordRequest('premium_orchestrate', 200);
    res.setHeader('X-Processing-Time-Ms', processingTimeMs);

    res.json({ requestId: req.id, ...result, processingTimeMs });

    logger.info('Premium orchestrate completed', { requestId: req.id, processingTimeMs, sessionId });
  } catch (error) {
    metricsCollector.recordError('premium_orchestrate', error.code || 'UNKNOWN');
    next(error);
  }
});

// ─── DELETE /orchestrate/:sessionId ─────────────────────────────────────────

router.delete('/orchestrate/:sessionId', (req, res) => {
  premiumService.endLongFormSession(req.params.sessionId);
  res.json({ requestId: req.id, ended: true });
});

export default router;
