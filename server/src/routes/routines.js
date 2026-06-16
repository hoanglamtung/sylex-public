/**
 * Routines routes — #141 (sub-task of #119)
 *
 * GET    /v1/routines            — list built-in templates + user's custom routines
 * POST   /v1/routines            — create custom routine (auth + premium)
 * PUT    /v1/routines/:id        — update custom routine (auth)
 * DELETE /v1/routines/:id        — delete custom routine (auth)
 * POST   /v1/routines/:id/execute — execute routine steps via Gemini (auth)
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import RoutineService from '../services/routineService.js';
import authMiddleware, { optionalAuthMiddleware } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { metricsCollector } from '../utils/metrics.js';

const router = express.Router();
const routineService = new RoutineService();

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_CHAT || 200),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('routines');
    res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.', requestId: req.id } });
  },
});

// GET /v1/routines — built-ins available to all; custom routines require auth
router.get('/', limiter, optionalAuthMiddleware, async (req, res, next) => {
  try {
    const uid = req.user?.uid ?? 'anonymous';
    const result = await routineService.list(uid);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /v1/routines — create custom routine (premium only)
router.post('/', limiter, authMiddleware, async (req, res, next) => {
  try {
    if (!req.user.isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Creating custom routines requires a premium subscription.', 403);
    }
    const routine = await routineService.create(req.user.uid, req.body);
    logger.info('Custom routine created', { uid: req.user.uid, routineId: routine.id });
    res.status(201).json(routine);
  } catch (err) {
    next(err);
  }
});

// PUT /v1/routines/:id — update custom routine
// Accepts optional triggerTime ("HH:MM") and repeatDays (number[0-6]) for #238.
router.put('/:id', limiter, authMiddleware, async (req, res, next) => {
  try {
    const { triggerTime, repeatDays } = req.body;
    if (triggerTime !== undefined) {
      if (typeof triggerTime !== 'string' || !/^\d{2}:\d{2}$/.test(triggerTime)) {
        throw new AppError('INVALID_INPUT', 'triggerTime must be "HH:MM" (24-hour).', 400);
      }
      const [h, m] = triggerTime.split(':').map(Number);
      if (h < 0 || h > 23 || m < 0 || m > 59) {
        throw new AppError('INVALID_INPUT', 'triggerTime hour must be 0-23, minute 0-59.', 400);
      }
    }
    if (repeatDays !== undefined) {
      if (!Array.isArray(repeatDays) || repeatDays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new AppError('INVALID_INPUT', 'repeatDays must be an array of integers 0-6.', 400);
      }
    }
    const routine = await routineService.update(req.user.uid, req.params.id, req.body);
    res.json(routine);
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/routines/:id — delete custom routine
router.delete('/:id', limiter, authMiddleware, async (req, res, next) => {
  try {
    await routineService.delete(req.user.uid, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /v1/routines/:id/execute — execute routine steps via Gemini
router.post('/:id/execute', limiter, authMiddleware, async (req, res, next) => {
  const startTime = Date.now();
  try {
    const { context = {} } = req.body;
    const results = await routineService.execute(
      req.user.uid,
      req.params.id,
      context,
      req.user.isPremium ?? false,
    );

    const processingTimeMs = Date.now() - startTime;
    logger.info('Routine executed', { uid: req.user.uid, routineId: req.params.id, steps: results.length, processingTimeMs });
    metricsCollector.recordLatency('routines', processingTimeMs);

    res.json({ routineId: req.params.id, steps: results, processingTimeMs });
  } catch (err) {
    next(err);
  }
});

export default router;
