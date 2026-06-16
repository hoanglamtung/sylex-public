// parentalControlService.js — #150
// CRUD for parent-configured controls (topic blocklist + session time limit).
// Settings stored in Firestore: /users/{parentUid}/parentalControls/settings
// Enforced server-side on every kids mode request before the LLM is called.

import { createRequire } from 'module';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const require = createRequire(import.meta.url);

// In-memory session tracking: { uid -> { startedAt: number } }
const activeSessions = new Map();

function getFirestore() {
  const admin = require('firebase-admin');
  return admin.firestore();
}

const COLLECTION_PATH = (uid) => `users/${uid}/parentalControls/settings`;

class ParentalControlService {
  /**
   * Read current parental controls for a parent UID.
   * Returns defaults if no settings exist yet.
   *
   * @param {string} parentUid
   * @returns {Promise<{ blockedTopics: string[], sessionLimitMinutes: number }>}
   */
  async getControls(parentUid) {
    try {
      const db = getFirestore();
      const doc = await db.doc(COLLECTION_PATH(parentUid)).get();

      if (!doc.exists) {
        return { blockedTopics: [], sessionLimitMinutes: 0 };
      }

      const data = doc.data();
      return {
        blockedTopics:         data.blockedTopics         ?? [],
        sessionLimitMinutes:   data.sessionLimitMinutes   ?? 0,
      };
    } catch (err) {
      logger.error('ParentalControlService.getControls error', { uid: parentUid, error: err.message });
      throw new AppError('INTERNAL_ERROR', 'Failed to read parental controls', 500);
    }
  }

  /**
   * Update parental controls.
   *
   * @param {string} parentUid
   * @param {{ blockedTopics?: string[], sessionLimitMinutes?: number }} settings
   */
  async updateControls(parentUid, settings) {
    const { blockedTopics, sessionLimitMinutes } = settings;

    if (blockedTopics !== undefined && !Array.isArray(blockedTopics)) {
      throw new AppError('INVALID_REQUEST', 'blockedTopics must be an array of strings', 400);
    }
    if (sessionLimitMinutes !== undefined && (typeof sessionLimitMinutes !== 'number' || sessionLimitMinutes < 0)) {
      throw new AppError('INVALID_REQUEST', 'sessionLimitMinutes must be a non-negative number', 400);
    }

    try {
      const db = getFirestore();
      const update = { updatedAt: new Date() };
      if (blockedTopics       !== undefined) update.blockedTopics       = blockedTopics;
      if (sessionLimitMinutes !== undefined) update.sessionLimitMinutes = sessionLimitMinutes;

      await db.doc(COLLECTION_PATH(parentUid)).set(update, { merge: true });
      logger.info('Parental controls updated', { uid: parentUid });
    } catch (err) {
      logger.error('ParentalControlService.updateControls error', { uid: parentUid, error: err.message });
      throw new AppError('INTERNAL_ERROR', 'Failed to update parental controls', 500);
    }
  }

  /**
   * Enforce parental controls before an LLM call.
   * Throws AppError if the request is blocked.
   *
   * @param {string} parentUid
   * @param {string} sessionId
   * @param {string} requestText
   */
  async enforce(parentUid, sessionId, requestText) {
    const controls = await this.getControls(parentUid);

    // ── Blocked topic check ────────────────────────────────────────────────
    if (controls.blockedTopics.length > 0) {
      const lowerText = requestText.toLowerCase();
      const matched = controls.blockedTopics.find(topic => lowerText.includes(topic.toLowerCase()));
      if (matched) {
        logger.warn('Parental control: topic blocked', { uid: parentUid, topic: matched });
        throw new AppError('PARENTAL_BLOCK', 'This topic is not allowed.', 403);
      }
    }

    // ── Session time limit check ───────────────────────────────────────────
    if (controls.sessionLimitMinutes > 0) {
      const now = Date.now();
      if (!activeSessions.has(sessionId)) {
        activeSessions.set(sessionId, { startedAt: now });
      }
      const { startedAt } = activeSessions.get(sessionId);
      const elapsedMinutes = (now - startedAt) / 60_000;

      if (elapsedMinutes >= controls.sessionLimitMinutes) {
        logger.info('Parental control: session limit reached', { uid: parentUid, sessionId, elapsedMinutes });
        throw new AppError('SESSION_LIMIT_REACHED', 'Session time limit reached. Please take a break!', 403);
      }
    }
  }

  /**
   * Clear session tracking when a session ends.
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    activeSessions.delete(sessionId);
  }
}

export default ParentalControlService;
