/**
 * #294 — Adaptive timeout for grounded queries
 *
 * Verifies that the POST /v1/chat/stream SSE route emits an
 * `event: grounding_start` frame as the first data before any text
 * when grounding=true is sent in the request body.
 */
import request from 'supertest';
import app from '../src/index.js';

// The chat/stream route calls chatService which calls Vertex AI.
// We mock the entire chatService so we can control what stream events arrive.
jest.mock('../src/services/chatService.js', () => ({
  ChatService: jest.fn().mockImplementation(() => ({
    processChatStream: jest.fn().mockImplementation(async function* () {
      yield { type: 'text', delta: 'Hello' };
      yield { type: 'meta', intent: null, action: null, parameters: {}, confidence: 1 };
    }),
    processChat: jest.fn(),
  })),
}));

function parseSSEFrames(raw) {
  const frames = [];
  const blocks = raw.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let eventName = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim();
      else if (line.startsWith('data: ')) data = line.slice(6).trim();
    }
    frames.push({ event: eventName, data });
  }
  return frames;
}

describe('POST /v1/chat/stream — grounding_start event (#294)', () => {
  it('emits grounding_start as the first named event when grounding=true', async () => {
    const response = await request(app)
      .post('/v1/chat/stream')
      .set('Content-Type', 'application/json')
      .send({
        text: 'What is the current fuel price?',
        sessionId: 'test-session-294',
        language: 'en-US',
        mode: 'personal',
        grounding: true,
      })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => callback(null, body));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/event-stream/);

    const frames = parseSSEFrames(response.text);
    // First named event must be grounding_start
    const firstNamed = frames.find((f) => f.event !== 'message');
    expect(firstNamed).toBeDefined();
    expect(firstNamed.event).toBe('grounding_start');

    const payload = JSON.parse(firstNamed.data);
    expect(typeof payload.timeoutHintMs).toBe('number');
    expect(payload.timeoutHintMs).toBeGreaterThanOrEqual(20000);
  });

  it('does NOT emit grounding_start when grounding=false', async () => {
    const response = await request(app)
      .post('/v1/chat/stream')
      .set('Content-Type', 'application/json')
      .send({
        text: 'Tell me a joke.',
        sessionId: 'test-session-294b',
        language: 'en-US',
        mode: 'personal',
        grounding: false,
      })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => callback(null, body));
      });

    expect(response.status).toBe(200);
    const frames = parseSSEFrames(response.text);
    const groundingFrame = frames.find((f) => f.event === 'grounding_start');
    expect(groundingFrame).toBeUndefined();
  });

  it('respects GROUNDING_STREAM_TIMEOUT_HINT_MS env override', async () => {
    const original = process.env.GROUNDING_STREAM_TIMEOUT_HINT_MS;
    process.env.GROUNDING_STREAM_TIMEOUT_HINT_MS = '22000';
    try {
      const response = await request(app)
        .post('/v1/chat/stream')
        .set('Content-Type', 'application/json')
        .send({
          text: 'What are the latest EV incentives?',
          sessionId: 'test-session-294c',
          language: 'en-US',
          mode: 'personal',
          grounding: true,
        })
        .buffer(true)
        .parse((res, callback) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk.toString(); });
          res.on('end', () => callback(null, body));
        });

      const frames = parseSSEFrames(response.text);
      const gs = frames.find((f) => f.event === 'grounding_start');
      expect(gs).toBeDefined();
      const payload = JSON.parse(gs.data);
      expect(payload.timeoutHintMs).toBe(22000);
    } finally {
      if (original === undefined) delete process.env.GROUNDING_STREAM_TIMEOUT_HINT_MS;
      else process.env.GROUNDING_STREAM_TIMEOUT_HINT_MS = original;
    }
  });
});
