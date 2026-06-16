// routes/meeting.js — #147
// POST /v1/meeting/extract — extract decisions, action items, open questions
//                            from a meeting transcript.
// Requires auth + premium.

import express from 'express';
import authMiddleware from '../middleware/auth.js';
import MeetingService from '../services/meetingService.js';

const router = express.Router();
const meetingService = new MeetingService();

/**
 * POST /v1/meeting/extract
 * Body:     { transcript: string }
 * Response: { decisions: string[], actionItems: [...], openQuestions: string[], plainText: string }
 */
router.post('/extract', authMiddleware, async (req, res, next) => {
  try {
    const { transcript } = req.body;
    const { uid, isPremium = false } = req.user;

    if (!transcript) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'transcript is required', requestId: req.id },
      });
    }
    if (typeof transcript !== 'string' || transcript.length > 50000) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'transcript must be a string ≤ 50000 characters', requestId: req.id },
      });
    }

    const result = await meetingService.extractMeetingNotes(uid, transcript, isPremium);

    res.status(200).json({ data: result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

export default router;
