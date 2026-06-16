// routes/parentalControls.js — #150
// GET /v1/parental-controls  — read current settings
// PUT /v1/parental-controls  — update settings
// Both require auth (parent must be signed in).

import express from 'express';
import authMiddleware from '../middleware/auth.js';
import ParentalControlService from '../services/parentalControlService.js';

const router = express.Router();
const parentalControlService = new ParentalControlService();

/**
 * GET /v1/parental-controls
 * Returns current parental control settings for the authenticated user.
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const { uid } = req.user;
    const controls = await parentalControlService.getControls(uid);
    res.status(200).json({ data: controls, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /v1/parental-controls
 * Body: { blockedTopics?: string[], sessionLimitMinutes?: number }
 */
router.put('/', authMiddleware, async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { blockedTopics, sessionLimitMinutes } = req.body;

    if (blockedTopics === undefined && sessionLimitMinutes === undefined) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Provide at least one of: blockedTopics, sessionLimitMinutes', requestId: req.id },
      });
    }

    await parentalControlService.updateControls(uid, { blockedTopics, sessionLimitMinutes });
    const updated = await parentalControlService.getControls(uid);

    res.status(200).json({ data: updated, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

export default router;
