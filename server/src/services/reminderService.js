/**
 * ReminderService — #142 (sub-task of #119)
 *
 * Stores structured reminders per user in Firestore.
 * Supports natural-language parsing via Gemini (e.g. "Remind me to call the
 * garage at 5pm" → { title, datetime, recurring }).
 *
 * The client is responsible for scheduling local push notifications using
 * the `datetime` value returned by the server. The server never fires
 * push notifications directly.
 *
 * Firestore path: /users/{uid}/reminders/{reminderId}
 */

import { createRequire } from 'module';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import GeminiService from './geminiService.js';

const require = createRequire(import.meta.url);

// ─── Firestore helper ─────────────────────────────────────────────────────────

function _getDb() {
  if (process.env.NODE_ENV === 'test') return null;
  let admin;
  try { admin = require('firebase-admin'); } catch { return null; }
  try { return admin.firestore(); } catch { return null; }
}

function _remindersRef(uid) {
  const db = _getDb();
  if (!db) return null;
  return db.collection('users').doc(uid).collection('reminders');
}

// ─── Service ──────────────────────────────────────────────────────────────────

class ReminderService {
  constructor() {
    this.geminiService = process.env.NODE_ENV === 'test' ? null : new GeminiService();
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async list(uid) {
    const ref = _remindersRef(uid);
    if (!ref) return [];
    const snap = await ref.orderBy('datetime', 'asc').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * Create a reminder.
   * Accepts either a structured body or `naturalText` for NLP parsing.
   *
   * @param {string} uid
   * @param {object} data
   * @param {string} [data.title]       — required if naturalText not provided
   * @param {string} [data.datetime]    — ISO 8601, required if naturalText not provided
   * @param {string|null} [data.recurring] — 'daily'|'weekly'|'monthly'|null
   * @param {string} [data.naturalText] — free-text input for NLP parsing
   * @param {string} [data.timezone]    — IANA tz string, used with naturalText
   */
  async create(uid, data) {
    let { title, datetime, recurring = null, naturalText, timezone = 'UTC' } = data;

    if (naturalText) {
      const parsed = await this._parseNaturalLanguage(naturalText, timezone);
      title    = parsed.title;
      datetime = parsed.datetime;
      recurring = parsed.recurring ?? null;
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw new AppError('INVALID_REQUEST', 'Reminder title is required.', 400);
    }
    if (!datetime) {
      throw new AppError('INVALID_REQUEST', 'Reminder datetime is required.', 400);
    }
    // Basic ISO 8601 validation
    if (isNaN(Date.parse(datetime))) {
      throw new AppError('INVALID_REQUEST', 'datetime must be a valid ISO 8601 string.', 400);
    }
    if (recurring && !['daily', 'weekly', 'monthly'].includes(recurring)) {
      throw new AppError('INVALID_REQUEST', 'recurring must be daily, weekly, monthly, or null.', 400);
    }

    const doc = {
      title: title.trim(),
      datetime,
      recurring,
      createdAt: this._serverTimestamp(),
      updatedAt: this._serverTimestamp(),
    };

    const ref = _remindersRef(uid);
    if (!ref) return { id: 'test-reminder-id', ...doc };

    const docRef = await ref.add(doc);
    return { id: docRef.id, ...doc };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(uid, reminderId, data) {
    const ref = _remindersRef(uid);
    if (!ref) return { id: reminderId, ...data };

    const snap = await ref.doc(reminderId).get();
    if (!snap.exists) throw new AppError('NOT_FOUND', 'Reminder not found.', 404);

    if (data.datetime && isNaN(Date.parse(data.datetime))) {
      throw new AppError('INVALID_REQUEST', 'datetime must be a valid ISO 8601 string.', 400);
    }

    const update = {
      ...data,
      updatedAt: this._serverTimestamp(),
    };
    delete update.createdAt;

    await ref.doc(reminderId).update(update);
    return { id: reminderId, ...snap.data(), ...update };
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async delete(uid, reminderId) {
    const ref = _remindersRef(uid);
    if (!ref) return;

    const snap = await ref.doc(reminderId).get();
    if (!snap.exists) throw new AppError('NOT_FOUND', 'Reminder not found.', 404);

    await ref.doc(reminderId).delete();
  }

  // ─── NLP parsing ──────────────────────────────────────────────────────────

  /**
   * Parse a natural language reminder string into structured data using Gemini.
   * Returns { title, datetime (ISO 8601), recurring }
   */
  async _parseNaturalLanguage(naturalText, timezone) {
    if (process.env.NODE_ENV === 'test' || !this.geminiService) {
      // Deterministic test stub
      return {
        title: naturalText,
        datetime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        recurring: null,
      };
    }

    const now = new Date().toISOString();
    const prompt = `You are a reminder parser. Extract a structured reminder from the following text.
Current time (UTC): ${now}
User timezone: ${timezone}

Input: "${naturalText}"

Respond with ONLY a JSON object, no markdown, no explanation:
{
  "title": "<short reminder title, max 80 chars>",
  "datetime": "<ISO 8601 datetime in UTC>",
  "recurring": <null | "daily" | "weekly" | "monthly">
}

Rules:
- Interpret relative times (e.g. "at 5pm", "tomorrow morning") relative to current time in the user timezone
- If no time is mentioned, default to 1 hour from now
- If no date is mentioned, assume today
- Title should be concise and action-oriented`;

    try {
      const response = await this.geminiService.chat(
        [{ role: 'user', content: prompt }],
        false, // Use free model for NLP parsing
      );

      const raw = response.content.trim();
      // Strip any accidental markdown code fences
      const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(json);

      if (!parsed.title || !parsed.datetime) {
        throw new Error('Missing required fields in parsed reminder');
      }
      return parsed;
    } catch (err) {
      logger.error('Reminder NLP parsing failed', { error: err.message, naturalText });
      throw new AppError('PARSE_ERROR', 'Could not parse the reminder. Please provide a title and time explicitly.', 422);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _serverTimestamp() {
    try {
      const admin = require('firebase-admin');
      return admin.firestore.FieldValue.serverTimestamp();
    } catch {
      return new Date().toISOString();
    }
  }
}

export default ReminderService;
