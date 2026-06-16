/**
 * RoutineService — #141 (sub-task of #119)
 *
 * Manages voice-triggered daily routines:
 *   - Built-in templates: Morning, Evening, Workday (available to all users)
 *   - Custom routines: per-user CRUD stored in Firestore (premium only)
 *   - Execute: runs routine steps sequentially through Gemini
 *
 * Firestore path: /users/{uid}/routines/{routineId}
 */

import { createRequire } from 'module';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import GeminiService from './geminiService.js';
import navigationService from './navigationService.js';

// Detect routing intent: "Route from X to Y", "Navigate from X to Y", "Directions from X to Y"
const ROUTE_RE = /^(?:route|navigate|directions?|get (?:route|directions?))\s+from\s+(.+?)\s+to\s+(.+)/i;

// System instruction for routine step Gemini calls.
// Tells the model to reply in plain text (not JSON), always give a useful answer
// (grounding is disabled for routine steps to prevent Vertex AI search-API failures).
const ROUTINE_STEP_SYSTEM = 'You are a helpful car assistant. Answer the user\'s question in 1-3 concise plain-text sentences. Do NOT use JSON or markdown. For questions about current conditions such as weather, traffic, or fuel prices, give your best estimate or general guidance based on your training knowledge. Always provide a helpful, specific answer — never say you cannot answer or lack the information.';

const require = createRequire(import.meta.url);

// ─── Built-in templates (available to all users) ──────────────────────────────

export const BUILTIN_ROUTINES = [
  {
    id: 'morning',
    name: 'Morning Briefing',
    description: 'Start your day — weather, calendar, and traffic overview.',
    triggerPhrase: 'good morning',
    builtin: true,
    steps: [
      { order: 1, id: 'weather',  prompt: 'Give me a brief, friendly weather summary for today. Keep it under 3 sentences.' },
      { order: 2, id: 'calendar', prompt: 'Summarise my schedule for today in a natural, spoken format. If no events are known, say "Your day looks clear — a great time to focus."' },
      { order: 3, id: 'traffic',  prompt: 'Give a short commute / traffic tip for this morning. Keep it practical and under 2 sentences.' },
    ],
  },
  {
    id: 'evening',
    name: 'Evening Wind-Down',
    description: 'Wrap up your day — summary, tomorrow preview, reminders.',
    triggerPhrase: 'good evening',
    builtin: true,
    steps: [
      { order: 1, id: 'day_summary',    prompt: 'Give a brief, warm summary of how the day might have gone. Keep it positive and under 3 sentences.' },
      { order: 2, id: 'tomorrow',       prompt: 'Summarise what is scheduled for tomorrow. If nothing is known, say "Tomorrow looks free — a good time to plan something." ' },
      { order: 3, id: 'reminders',      prompt: 'Remind the user to check any pending tasks or reminders before bed. Keep it gentle, under 2 sentences.' },
    ],
  },
  {
    id: 'workday',
    name: 'Workday Focus',
    description: 'Kick off your work session — meetings, tasks, focus prompt.',
    triggerPhrase: 'start workday',
    builtin: true,
    steps: [
      { order: 1, id: 'meetings',     prompt: 'List any meetings or calls scheduled for today in a brief spoken format. If none, say "No meetings today — great time for deep work."' },
      { order: 2, id: 'tasks',        prompt: 'Suggest the top 3 things to focus on today based on typical work priorities. Keep it energetic and under 3 sentences.' },
      { order: 3, id: 'focus_prompt', prompt: 'Give a short motivational focus prompt to start the work session. One sentence, upbeat.' },
    ],
  },
];

// ─── Firestore helper ─────────────────────────────────────────────────────────

function _getDb() {
  if (process.env.NODE_ENV === 'test') return null;
  let admin;
  try { admin = require('firebase-admin'); } catch { return null; }
  try { return admin.firestore(); } catch { return null; }
}

function _routinesRef(uid) {
  const db = _getDb();
  if (!db) return null;
  return db.collection('users').doc(uid).collection('routines');
}

// ─── Service ──────────────────────────────────────────────────────────────────

class RoutineService {
  constructor() {
    this.geminiService = process.env.NODE_ENV === 'test' ? null : new GeminiService();
  }

  // ─── List ────────────────────────────────────────────────────────────────

  /**
   * Returns built-in templates + user's custom routines.
   * Built-ins are available to all users.
   */
  async list(uid) {
    const custom = await this._listCustom(uid);
    return { builtin: BUILTIN_ROUTINES, custom };
  }

  async _listCustom(uid) {
    const ref = _routinesRef(uid);
    if (!ref) return []; // test / no Firestore
    const snap = await ref.orderBy('createdAt', 'asc').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  // ─── Create ──────────────────────────────────────────────────────────────

  /**
   * Create a custom routine for a user (premium only — gate enforced in route).
   * @param {string} uid
   * @param {{ name, description, triggerPhrase, steps: Array<{order,id,prompt}> }} data
   */
  async create(uid, data) {
    const { name, description = '', triggerPhrase = '', steps } = data;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('INVALID_REQUEST', 'Routine name is required.', 400);
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new AppError('INVALID_REQUEST', 'Routine must have at least one step.', 400);
    }
    if (steps.length > 10) {
      throw new AppError('INVALID_REQUEST', 'Routine cannot have more than 10 steps.', 400);
    }

    const normalised = steps.map((s, i) => ({
      order:  typeof s.order === 'number' ? s.order : i + 1,
      id:     s.id || `step_${i + 1}`,
      prompt: s.prompt,
    }));

    const doc = {
      name: name.trim(),
      description: description.trim(),
      triggerPhrase: triggerPhrase.trim(),
      steps: normalised,
      builtin: false,
      createdAt: this._serverTimestamp(),
      updatedAt: this._serverTimestamp(),
    };

    // Test mode — return stub
    if (!_routinesRef(uid)) {
      return { id: 'test-routine-id', ...doc };
    }

    const ref = await _routinesRef(uid).add(doc);
    return { id: ref.id, ...doc };
  }

  // ─── Update ──────────────────────────────────────────────────────────────

  async update(uid, routineId, data) {
    const ref = _routinesRef(uid);
    if (!ref) return { id: routineId, ...data };

    const snap = await ref.doc(routineId).get();
    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Routine not found.', 404);
    }
    if (snap.data().builtin) {
      throw new AppError('FORBIDDEN', 'Built-in routines cannot be modified.', 403);
    }

    const update = { ...data, updatedAt: this._serverTimestamp() };
    // Don't allow overriding builtin flag
    delete update.builtin;
    delete update.createdAt;

    await ref.doc(routineId).update(update);
    return { id: routineId, ...snap.data(), ...update };
  }

  // ─── Delete ──────────────────────────────────────────────────────────────

  async delete(uid, routineId) {
    const ref = _routinesRef(uid);
    if (!ref) return;

    const snap = await ref.doc(routineId).get();
    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Routine not found.', 404);
    }
    if (snap.data().builtin) {
      throw new AppError('FORBIDDEN', 'Built-in routines cannot be deleted.', 403);
    }

    await ref.doc(routineId).delete();
  }

  // ─── Execute ─────────────────────────────────────────────────────────────

  /**
   * Execute a routine by running each step through Gemini sequentially.
   * Returns an ordered array of step results.
   *
   * @param {string} uid
   * @param {string} routineId  — built-in id ('morning'|'evening'|'workday') or Firestore doc id
   * @param {object} context    — optional context injected into prompts (e.g. { location })
   * @param {boolean} isPremium
   */
  async execute(uid, routineId, context = {}, isPremium) {
    // Resolve routine definition
    const routine = await this._resolve(uid, routineId);

    // Custom routine execution requires premium
    if (!routine.builtin && !isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Custom routine execution requires a premium subscription.', 403);
    }

    const results = [];
    const sortedSteps = [...routine.steps].sort((a, b) => a.order - b.order);

    // Test mode short-circuit
    if (process.env.NODE_ENV === 'test' || !this.geminiService) {
      return sortedSteps.map(step => ({
        stepId: step.id,
        order:  step.order,
        text:   `[test] Response for step: ${step.id}`,
      }));
    }

    const contextNote = Object.keys(context).length
      ? `\n\nContext: ${JSON.stringify(context)}`
      : '';

    for (const step of sortedSteps) {
      try {
        // ─── Navigation / routing step ──────────────────────────────────────
        const routeMatch = step.prompt.match(ROUTE_RE);
        // geminiPrompt defaults to raw step prompt; routing steps override it below
        // so Gemini receives a proper estimation request instead of a bare "Route from X to Y".
        let geminiPrompt = step.prompt + contextNote;

        if (routeMatch) {
          const origin      = routeMatch[1].trim();
          const destination = routeMatch[2].trim();

          if (navigationService.isConfigured) {
            const routeCtx = await navigationService.getRouteContext({ origin, destination });

            if (routeCtx) {
              const parts = [
                `Route from ${routeCtx.origin} to ${routeCtx.destination}:`,
                `${routeCtx.distanceKm} km, approximately ${routeCtx.etaMinutes} minutes.`,
              ];
              if (routeCtx.nextManoeuvre) parts.push(`First: ${routeCtx.nextManoeuvre}.`);
              if (routeCtx.trafficCondition && routeCtx.trafficCondition !== 'unknown') {
                parts.push(`Traffic: ${routeCtx.trafficCondition}.`);
              }
              results.push({ stepId: step.id, order: step.order, text: parts.join(' ') });
              continue;
            }
            // Maps API returned null — fall through to Gemini with enriched prompt
            logger.warn('NavigationService returned null, falling back to Gemini', { routineId, stepId: step.id });
          }

          // Rewrite prompt so Gemini gives a useful distance/time estimate rather
          // than refusing to navigate without real-time data.
          geminiPrompt = `Estimate the route from ${origin} to ${destination}. Give the approximate distance in kilometres and typical drive time. Keep it to 2 sentences.${contextNote}`;
        }

        // ─── General Gemini step ─────────────────────────────────────────────
        // Try with search grounding first (helps weather/traffic queries).
        // If the grounding API throws (e.g. for fuel-price queries), retry
        // once without grounding so Gemini answers from training knowledge.
        let response;
        try {
          response = await this.geminiService.chat(
            [
              { role: 'system', content: ROUTINE_STEP_SYSTEM },
              { role: 'user',   content: geminiPrompt },
            ],
            'en',      // language
            isPremium, // premium flag (use correct model)
            null,      // no image
            // tools: default → [{ googleSearch: {} }] — grounding enabled
          );
        } catch (groundingErr) {
          logger.warn('Routine step grounding failed, retrying without grounding', {
            routineId, stepId: step.id, error: groundingErr.message,
          });
          response = await this.geminiService.chat(
            [
              { role: 'system', content: ROUTINE_STEP_SYSTEM },
              { role: 'user',   content: geminiPrompt },
            ],
            'en',
            isPremium,
            null,
            [], // grounding disabled for retry
          );
        }
        // Defensive: if Gemini returns a JSON string (e.g. car-assistant format),
        // extract the human-readable `text` field rather than exposing raw JSON.
        let stepText = response.content ?? '';
        try {
          const parsed = JSON.parse(stepText);
          if (parsed && typeof parsed.text === 'string') stepText = parsed.text;
        } catch { /* not JSON — use as-is */ }
        results.push({
          stepId: step.id,
          order:  step.order,
          text:   stepText,
        });
      } catch (err) {
        logger.error('Routine step execution failed', { routineId, stepId: step.id, error: err.message });
        results.push({
          stepId: step.id,
          order:  step.order,
          text:   'This step could not be completed right now.',
          error:  true,
        });
      }
    }

    return results;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  async _resolve(uid, routineId) {
    // Check built-ins first
    const builtin = BUILTIN_ROUTINES.find(r => r.id === routineId);
    if (builtin) return builtin;

    // Try Firestore
    const ref = _routinesRef(uid);
    if (!ref) throw new AppError('NOT_FOUND', 'Routine not found.', 404);

    const snap = await ref.doc(routineId).get();
    if (!snap.exists) throw new AppError('NOT_FOUND', 'Routine not found.', 404);

    const data = snap.data();

    // Normalise: client saves `tasks` (label/durationSeconds), execution needs `steps` (prompt/order)
    if (!data.steps && Array.isArray(data.tasks)) {
      data.steps = data.tasks.map((t, i) => ({
        order:  i + 1,
        id:     t.id || `step_${i + 1}`,
        prompt: t.label ?? '',
      }));
    }

    return { id: snap.id, ...data };
  }

  _serverTimestamp() {
    try {
      const admin = require('firebase-admin');
      return admin.firestore.FieldValue.serverTimestamp();
    } catch {
      return new Date().toISOString();
    }
  }
}

export default RoutineService;
