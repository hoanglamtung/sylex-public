/**
 * Reminders routes — #142 (sub-task of #119)
 *
 * GET    /v1/reminders      — list user's reminders
 * POST   /v1/reminders      — create reminder (structured or natural language)
 * PUT    /v1/reminders/:id  — update reminder
 * DELETE /v1/reminders/:id  — delete reminder
 *
 * All routes require auth. The client schedules local push notifications
 * using the `datetime` field returned by POST/PUT.
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import ReminderService from '../services/reminderService.js';
import authMiddleware from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { metricsCollector } from '../utils/metrics.js';

const router = express.Router();
const reminderService = new ReminderService();

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_CHAT || 200),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('reminders');
    res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.', requestId: req.id } });
  },
});

// GET /v1/reminders
router.get('/', limiter, authMiddleware, async (req, res, next) => {
  try {
    const reminders = await reminderService.list(req.user.uid);
    res.json({ reminders });
  } catch (err) {
    next(err);
  }
});

// POST /v1/reminders
router.post('/', limiter, authMiddleware, async (req, res, next) => {
  try {
    const reminder = await reminderService.create(req.user.uid, req.body);
    logger.info('Reminder created', { uid: req.user.uid, reminderId: reminder.id, title: reminder.title });
    res.status(201).json(reminder);
  } catch (err) {
    next(err);
  }
});

// PUT /v1/reminders/:id
router.put('/:id', limiter, authMiddleware, async (req, res, next) => {
  try {
    const reminder = await reminderService.update(req.user.uid, req.params.id, req.body);
    res.json(reminder);
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/reminders/:id
router.delete('/:id', limiter, authMiddleware, async (req, res, next) => {
  try {
    await reminderService.delete(req.user.uid, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
