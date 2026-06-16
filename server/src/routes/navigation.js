import express from 'express';
import authMiddleware from '../middleware/auth.js';
import navigationService from '../services/navigationService.js';
import { OFFLINE_COMMANDS } from '../config/offlineCommands.js';
import { AppError } from '../utils/errors.js';
import { metricsCollector } from '../utils/metrics.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /v1/navigation/context — #157
 * Returns the current route context from Google Maps Routes API.
 * Used by the client to display navigation info in car mode
 * and optionally pass context back to POST /v1/voice/text.
 *
 * Premium required (car mode is Premium).
 *
 * Query params:
 *   origin       — origin address or "lat,lng" (required)
 *   destination  — destination address or "lat,lng" (required)
 *   lat          — current device latitude (required)
 *   lng          — current device longitude (required)
 *   language     — BCP-47 language code (default: de-DE)
 */
router.get('/context', authMiddleware, async (req, res, next) => {
  const startTime = Date.now();
  try {
    const { origin, destination, lat, lng, language = 'de-DE' } = req.query;

    if (!origin || !destination) {
      throw new AppError('INVALID_REQUEST', 'origin and destination are required', 400);
    }
    if (!lat || !lng) {
      throw new AppError('INVALID_REQUEST', 'lat and lng (current location) are required', 400);
    }

    const isPremium = req.user?.isPremium ?? false;
    if (!isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Navigation context requires a Silverleaf Premium subscription.', 403);
    }

    // If Maps API key not configured, return 204 (graceful degradation)
    if (!navigationService.isConfigured) {
      logger.warn('Navigation context requested but GOOGLE_MAPS_API_KEY not set');
      return res.status(204).end();
    }

    const context = await navigationService.getRouteContext({
      origin,
      destination,
      currentLocation: `${lat},${lng}`,
      language,
    });

    if (!context) {
      return res.status(204).end();
    }

    metricsCollector.recordLatency('navigation', Date.now() - startTime);
    metricsCollector.recordRequest('navigation', 200);

    return res.json(context);

  } catch (err) {
    metricsCollector.recordRequest('navigation', err.statusCode || 500);
    next(err);
  }
});

/**
 * GET /v1/navigation/offline-commands — #159
 * Returns the Sylex offline command catalog.
 * No auth required — public, client should cache for 24h.
 */
router.get('/offline-commands', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json(OFFLINE_COMMANDS);
});

export default router;
