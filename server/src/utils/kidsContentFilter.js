// kidsContentFilter.js — #149
// Server-side content safety filter for kids mode.
// Runs synchronously on every LLM response before it is returned to the client.
// Uses pattern/keyword matching as a fast first pass (< 5ms).
// If content is blocked, a safe fallback response is returned — the blocked
// content is NEVER sent to the client.

import logger from './logger.js';

// ─── Blocked pattern definitions ─────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  {
    category: 'violence',
    patterns: [
      /\b(kill|murder|stab|shoot|blood|gore|slaughter|massacre|torture|weapon|gun|knife|bomb|explode)\b/i,
    ],
  },
  {
    category: 'adult_content',
    patterns: [
      /\b(sex|sexual|nude|naked|porn|erotic|masturbat|genitals?|penis|vagina|breast|orgasm)\b/i,
    ],
  },
  {
    category: 'dangerous_instructions',
    patterns: [
      /\b(how to (make|build|create|synthesize) (drugs?|explosives?|weapons?|poison|bombs?))\b/i,
      /\b(hack|exploit|bypass|crack|illegal)\b/i,
    ],
  },
  {
    category: 'substances',
    patterns: [
      /\b(alcohol|beer|wine|drugs?|cocaine|heroin|marijuana|weed|cigarette|tobacco|vape)\b/i,
    ],
  },
  {
    category: 'hate_speech',
    patterns: [
      /\b(racist|racism|nazi|white supremac|hate speech|slur)\b/i,
    ],
  },
  {
    category: 'personal_data_request',
    patterns: [
      /\b(tell me your (address|phone|password|credit card|social security))\b/i,
      /\b(where do you live|what is your home address)\b/i,
    ],
  },
];

// Age-appropriate fallback responses (randomly selected)
const FALLBACK_RESPONSES = [
  { intent: 'safe_fallback', action: 'answer', parameters: {}, text: "That's not something I can help with. Let's talk about something fun instead! Would you like to hear a joke or learn something new?" },
  { intent: 'safe_fallback', action: 'answer', parameters: {}, text: "I'm not able to talk about that topic. How about we explore something exciting? I can tell you about space, animals, or cool science facts!" },
  { intent: 'safe_fallback', action: 'answer', parameters: {}, text: "Let's keep things friendly! I'd love to help you with a fun story, a riddle, or some homework instead." },
];

// ─── Filter function ──────────────────────────────────────────────────────────

/**
 * Scan LLM response text for blocked content categories.
 *
 * @param {string} text - LLM response text to check
 * @returns {{ safe: boolean, category?: string }}
 */
export function scanResponse(text) {
  if (!text || typeof text !== 'string') return { safe: true };

  for (const { category, patterns } of BLOCKED_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { safe: false, category };
      }
    }
  }

  return { safe: true };
}

/**
 * Also scan the user's input — reject before even calling the LLM.
 *
 * @param {string} text - User input text
 * @returns {{ safe: boolean, category?: string }}
 */
export function scanInput(text) {
  return scanResponse(text); // same ruleset applies
}

/**
 * Return a random safe fallback response object.
 * @returns {object}
 */
export function getFallbackResponse() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

/**
 * Log a blocked event (uid + category, no content).
 *
 * @param {string} uid
 * @param {'input'|'output'} stage
 * @param {string} category
 */
export function logBlocked(uid, stage, category) {
  logger.warn('Kids content filter: blocked', { uid, stage, category });
}
