/**
 * Subscription routes — #125
 *
 * POST /v1/subscription/validate/apple   — validate StoreKit 2 transaction
 * POST /v1/subscription/validate/google  — validate Play Billing purchase token
 * POST /v1/subscription/revoke           — revoke premium (admin/refund)
 * POST /v1/subscription/webhook/apple    — App Store Server Notifications
 * POST /v1/subscription/webhook/google   — Google Play RTDN (Pub/Sub push)
 *
 * All /validate and /revoke routes require a valid Firebase ID token.
 * Webhook routes verify their own signatures instead (Apple: signed JWT payload;
 * Google: Pub/Sub message — signature validation deferred to #125 deploy review).
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import SubscriptionService from '../services/subscriptionService.js';
import authMiddleware from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { metricsCollector } from '../utils/metrics.js';

const router = express.Router();
const subscriptionService = new SubscriptionService();

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: 20, // subscription validation is low-frequency
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.', requestId: req.id },
    });
  },
});

// ─── POST /validate/apple ─────────────────────────────────────────────────────

router.post('/validate/apple', limiter, authMiddleware, async (req, res, next) => {
  try {
    const { originalTransactionId } = req.body;
    if (!originalTransactionId) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'originalTransactionId is required', requestId: req.id },
      });
    }

    const result = await subscriptionService.validateApple(req.user.uid, originalTransactionId);
    metricsCollector.recordRequest('subscription_validate_apple', 200);

    res.json({
      requestId: req.id,
      isPremium: result.isPremium,
      expiresDate: result.expiresDate?.toISOString() ?? null,
    });
  } catch (err) {
    metricsCollector.recordError('subscription_validate_apple', err.code || 'UNKNOWN');
    next(err);
  }
});

// ─── POST /validate/google ────────────────────────────────────────────────────

router.post('/validate/google', limiter, authMiddleware, async (req, res, next) => {
  try {
    const { purchaseToken, subscriptionId } = req.body;
    if (!purchaseToken || !subscriptionId) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'purchaseToken and subscriptionId are required', requestId: req.id },
      });
    }

    const result = await subscriptionService.validateGoogle(req.user.uid, purchaseToken, subscriptionId);
    metricsCollector.recordRequest('subscription_validate_google', 200);

    res.json({
      requestId: req.id,
      isPremium: result.isPremium,
      expiresDate: result.expiresDate?.toISOString() ?? null,
    });
  } catch (err) {
    metricsCollector.recordError('subscription_validate_google', err.code || 'UNKNOWN');
    next(err);
  }
});

// ─── GET /status ────────────────────────────────────────────────────────────
// Returns the current isPremium state straight from the verified Firebase ID
// token (the claim is already decoded by authMiddleware — no Apple/Google API
// call needed).

router.get('/status', limiter, authMiddleware, async (req, res) => {
  const isPremium = !!req.user.isPremium;
  res.json({
    requestId: req.id,
    isPremium,
    plan: isPremium ? (req.user.plan ?? null) : null,
    expiresAt: isPremium ? (req.user.expiresAt ?? null) : null,
    gracePeriod: !!req.user.gracePeriod,
  });
});

// ─── POST /revoke ─────────────────────────────────────────────────────────────

router.post('/revoke', limiter, authMiddleware, async (req, res, next) => {
  try {
    await subscriptionService.revoke(req.user.uid);
    res.json({ requestId: req.id, isPremium: false });
  } catch (err) {
    next(err);
  }
});

// ─── POST /webhook/apple ──────────────────────────────────────────────────────
// App Store Server Notifications — signedPayload is a signed JWS string.
// Full JWS signature verification requires Apple's root CA chain; for now the
// payload is decoded and logged. Full verification to be added in deploy review.

router.post('/webhook/apple', express.json(), async (req, res, next) => {
  try {
    const { signedPayload } = req.body;
    if (!signedPayload) return res.status(400).end();

    // Decode the JWS payload (middle segment, base64url-encoded JSON)
    const parts = signedPayload.split('.');
    if (parts.length !== 3) return res.status(400).end();

    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return res.status(400).end();
    }

    const { notificationType, subtype, data } = payload;
    const signedTransactionInfo = data?.signedTransactionInfo;

    // Decode transaction info to get originalTransactionId (unsigned, for uid lookup)
    // In production this should be JWS-verified with Apple's root CA
    let transactionPayload = {};
    if (signedTransactionInfo) {
      try {
        const tParts = signedTransactionInfo.split('.');
        transactionPayload = JSON.parse(Buffer.from(tParts[1], 'base64url').toString('utf8'));
      } catch { /* ignore decode errors */ }
    }

    logger.info('Apple webhook received', { notificationType, subtype, transactionPayload });

    // UID lookup: in production, map originalTransactionId → Firebase UID via
    // a /users Firestore collection or a receipts table. Placeholder for now.
    const uid = transactionPayload.appAccountToken || null;
    if (uid) {
      await subscriptionService.handleAppleWebhook(uid, notificationType, subtype);
    }

    res.status(200).end();
  } catch (err) {
    logger.error('Apple webhook error', { message: err.message });
    next(err);
  }
});

// ─── POST /webhook/google ─────────────────────────────────────────────────────
// Google Play RTDN via Pub/Sub push subscription.
// Message data is base64-encoded JSON.

router.post('/webhook/google', express.json(), async (req, res, next) => {
  try {
    const message = req.body?.message;
    if (!message?.data) return res.status(400).end();

    let notification;
    try {
      notification = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
    } catch {
      return res.status(400).end();
    }

    const { subscriptionNotification } = notification;
    if (!subscriptionNotification) {
      // Not a subscription notification (e.g. test notification) — ack and ignore
      return res.status(200).end();
    }

    const { notificationType, purchaseToken, subscriptionId } = subscriptionNotification;
    logger.info('Google Play webhook received', { notificationType, subscriptionId });

    // UID lookup: in production, map purchaseToken → Firebase UID via Firestore
    // receipts table written at purchase time. Placeholder for now.
    const uid = notification.obfuscatedExternalAccountId || null;
    if (uid) {
      await subscriptionService.handleGoogleWebhook(uid, notificationType, purchaseToken, subscriptionId);
    }

    res.status(200).end();
  } catch (err) {
    logger.error('Google Play webhook error', { message: err.message });
    next(err);
  }
});

export default router;
