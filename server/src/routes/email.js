// routes/email.js — #146
// POST /v1/email/draft      — generate email draft from prompt
// POST /v1/email/summarize  — extract key info from email thread
// Both routes require auth + premium.

import express from 'express';
import authMiddleware from '../middleware/auth.js';
import EmailService, { TONES } from '../services/emailService.js';
import logger from '../utils/logger.js';

const router = express.Router();
const emailService = new EmailService();

/**
 * POST /v1/email/draft
 * Body: { prompt: string, tone?: 'formal'|'professional'|'concise' }
 * Response: { subject: string, body: string }
 */
router.post('/draft', authMiddleware, async (req, res, next) => {
  try {
    const { prompt, tone = 'professional' } = req.body;
    const { uid, isPremium = false } = req.user;

    if (!prompt) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'prompt is required', requestId: req.id },
      });
    }
    if (typeof prompt !== 'string' || prompt.length > 2000) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'prompt must be a string ≤ 2000 characters', requestId: req.id },
      });
    }
    if (!TONES.includes(tone)) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: `tone must be one of: ${TONES.join(', ')}`, requestId: req.id },
      });
    }

    const result = await emailService.draftEmail(uid, prompt, tone, isPremium);

    res.status(200).json({ data: result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/email/summarize
 * Body: { threadText: string }
 * Response: { sender: string, keyAsks: string[], deadlines: string[], summary: string }
 */
router.post('/summarize', authMiddleware, async (req, res, next) => {
  try {
    const { threadText } = req.body;
    const { uid, isPremium = false } = req.user;

    if (!threadText) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'threadText is required', requestId: req.id },
      });
    }
    if (typeof threadText !== 'string' || threadText.length > 10000) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'threadText must be a string ≤ 10000 characters', requestId: req.id },
      });
    }

    const result = await emailService.summarizeThread(uid, threadText, isPremium);

    res.status(200).json({ data: result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

export default router;
