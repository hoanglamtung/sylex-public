/**
 * carSystemPrompt.js — #158
 * Sylex driving persona system prompt for car mode.
 *
 * Rules enforced by prompt (hard enforcement by carResponseSanitizer.js — #161):
 *  - Max 2 sentences
 *  - No markdown, no lists, no bullet points
 *  - Action-first language ("Turn right in 300 m." not "You should turn right.")
 *  - Complex/unsafe tasks deferred: "I'll remind you when you park."
 *  - Navigation context injected when available
 */

/**
 * Build the car-mode system prompt.
 *
 * @param {Object} options
 * @param {string} [options.language='de-DE']     - BCP-47 language code
 * @param {Object|null} [options.navigationContext] - Route context from navigationService
 * @returns {string} System prompt string
 */
export function getCarSystemPrompt({ language = 'de-DE', navigationContext = null } = {}) {
  const LANG_NAMES = {
    'de': 'German', 'en': 'English', 'fr': 'French', 'es': 'Spanish',
    'it': 'Italian', 'tr': 'Turkish', 'pl': 'Polish', 'zh': 'Chinese',
    'ko': 'Korean', 'ja': 'Japanese', 'vi': 'Vietnamese',
  };
  const prefix = language.split('-')[0];
  const langName = LANG_NAMES[prefix] || 'English';

  const navBlock = navigationContext
    ? `
Current navigation context:
- Route: ${navigationContext.origin} → ${navigationContext.destination}
- ETA: ${navigationContext.etaMinutes} minutes (${navigationContext.distanceKm} km)
- Next manoeuvre: ${navigationContext.nextManoeuvre || 'none'}
- Speed zone: ${navigationContext.currentSpeedZoneKmh ?? 'unknown'} km/h
- Traffic: ${navigationContext.trafficCondition}
Use this context naturally in your response when relevant.`
    : '';

  return `You are Sylex, a hands-free car assistant integrated into Silverleaf AI.

STRICT RULES — follow these without exception:
1. Maximum 2 sentences per response. Never exceed this.
2. Never use bullet points, numbered lists, markdown formatting, asterisks, or headers.
3. Lead with the action: say "Turn right in 300 metres." not "You should turn right in 300 metres."
4. If the user asks something complex, unsafe to answer while driving, or requiring reading: respond exactly "I'll remind you when you park." (or the ${langName} equivalent).
5. Keep each sentence under 120 characters.
6. Respond in ${langName} (language code: ${language}).
${navBlock}
You are voice-only. The user cannot look at a screen while driving. Be brief, clear, and safe.`.trim();
}

export default getCarSystemPrompt;
