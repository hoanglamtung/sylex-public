/**
 * carResponseSanitizer.js — #161
 * Hard server-side enforcement of the car-mode response contract.
 *
 * Contract (independent of LLM output):
 *   - Strip all markdown (bold, italic, headers, bullets, code)
 *   - Keep first 2 sentences only
 *   - Truncate each sentence to 120 chars at word boundary
 *   - Total response never exceeds 240 chars
 *
 * This guarantees no truncation on any AAOS display size (#160).
 * Applied in chatService.processChat() when mode === 'car'.
 */

const MAX_SENTENCES = 2;
const MAX_CHARS_PER_SENTENCE = 120;

/**
 * Strip markdown syntax from text.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '')           // headers
    .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
    .replace(/\*(.+?)\*/g, '$1')         // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // inline code / code blocks
    .replace(/^\s*[-*+]\s+/gm, '')       // unordered list items
    .replace(/^\s*\d+\.\s+/gm, '')       // ordered list items
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label only
    .replace(/\n{2,}/g, ' ')             // collapse multiple newlines
    .replace(/\n/g, ' ')                 // single newlines → space
    .trim();
}

/**
 * Truncate a sentence to maxChars at the nearest word boundary.
 * @param {string} sentence
 * @param {number} maxChars
 * @returns {string}
 */
function truncateAtWordBoundary(sentence, maxChars) {
  if (sentence.length <= maxChars) return sentence;
  const truncated = sentence.substring(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.substring(0, lastSpace) + '.' : truncated + '.';
}

/**
 * Split text into sentences using common terminators.
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  // Split on '. ', '! ', '? ' or end-of-string — keep terminator on left side
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Sanitize an LLM response for car-mode display and TTS.
 *
 * @param {string} text  - Raw LLM response text
 * @returns {string}     - Sanitized response safe for AAOS displays
 */
export function sanitizeCarResponse(text) {
  if (!text || typeof text !== 'string') return '';

  // 1. Strip markdown
  const clean = stripMarkdown(text);

  // 2. Split into sentences, keep first MAX_SENTENCES
  const sentences = splitIntoSentences(clean);
  const kept = sentences.slice(0, MAX_SENTENCES);

  // 3. Truncate each sentence at word boundary
  const capped = kept.map(s => truncateAtWordBoundary(s, MAX_CHARS_PER_SENTENCE));

  return capped.join(' ').trim();
}

export default sanitizeCarResponse;
