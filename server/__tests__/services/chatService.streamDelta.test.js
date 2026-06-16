process.env.NODE_ENV = 'test';

import ChatService from '../../src/services/chatService.js';

describe('ChatService stream delta normalization', () => {
  it('passes through plain text deltas unchanged', () => {
    const chatService = new ChatService();
    const delta = '2 plus 5 is 7.';
    expect(chatService._normalizeStreamDelta(delta)).toBe(delta);
  });

  it('extracts text from JSON delta', () => {
    const chatService = new ChatService();
    const delta = '{"intent":"calculation","action":"answer","parameters":{},"text":"2 plus 5 is 7."}';
    expect(chatService._normalizeStreamDelta(delta)).toBe('2 plus 5 is 7.');
  });

  it('extracts text from fenced JSON delta', () => {
    const chatService = new ChatService();
    const delta = '```json\n{"intent":"weather","action":"answer","parameters":{},"text":"Today in Munich it is mild."}\n```';
    expect(chatService._normalizeStreamDelta(delta)).toBe('Today in Munich it is mild.');
  });

  // ── preamble+JSON guard (#295) ────────────────────────────────────────────────
  it('extracts text when delta is preamble prose followed by JSON', () => {
    const chatService = new ChatService();
    const delta = 'Based on the search results: {"intent":"info","action":null,"parameters":{},"text":"Speed limit is 50 km/h."}';
    expect(chatService._normalizeStreamDelta(delta)).toBe('Speed limit is 50 km/h.');
  });

  it('drops delta when preamble+JSON has no text field', () => {
    const chatService = new ChatService();
    const delta = 'Here: {"intent":"navigate","action":"route","parameters":{}}';
    expect(chatService._normalizeStreamDelta(delta)).toBe('');
  });

  it('drops bare structural JSON fields even without leading brace', () => {
    const chatService = new ChatService();
    // Partial/corrupted chunk that starts mid-JSON
    const delta = '"intent": "navigate", "action": "route"';
    expect(chatService._normalizeStreamDelta(delta)).toBe('');
  });
});
