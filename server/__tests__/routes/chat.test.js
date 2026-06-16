// Ensure test mode is explicit for short-circuits
process.env.NODE_ENV = 'test';

import 'dotenv/config';
/**
 * Chat Endpoint Tests
 * Tests for /v1/chat endpoints
 */

import request from 'supertest';
import express from 'express';
import chatRoutes from '../../src/routes/chat.js';
import errorHandler from '../../src/middleware/errorHandler.js';


// Create test app
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'test-request-id';
  next();
});
app.use('/v1/chat', chatRoutes);
// Mount global error handler to mirror production behavior
app.use(errorHandler);

describe('Chat Endpoint Tests', () => {
  describe('POST /v1/chat - Happy Path', () => {
    it('should process chat message successfully', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'What is the weather today?',
          sessionId: 'test-session-123',
          language: 'de-DE',
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('requestId');
      expect(response.body).toHaveProperty('sessionId', 'test-session-123');
      expect(response.body).toHaveProperty('intent');
      expect(response.body).toHaveProperty('response');
      expect(response.body).toHaveProperty('confidence');
      expect(response.body).toHaveProperty('processingTimeMs');
      expect(typeof response.body.confidence).toBe('number');
      expect(response.body.confidence).toBeGreaterThanOrEqual(0);
      expect(response.body.confidence).toBeLessThanOrEqual(1);
    }, 30000);

    it('should handle German language input', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Wie ist das Wetter heute?',
          sessionId: 'test-session-de',
          language: 'de-DE',
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
      expect(response.body.response).toBeTruthy();
    }, 30000);

    it('should handle English language input', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'What time is it?',
          sessionId: 'test-session-en',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
    }, 30000);

    it('should return processing time in headers', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Hello',
          sessionId: 'test-session-timing',
          language: 'de-DE',
        })
        .expect(200);

      expect(response.headers).toHaveProperty('x-processing-time-ms');
      expect(parseInt(response.headers['x-processing-time-ms'])).toBeGreaterThanOrEqual(0);
    }, 30000);

    it('should support optional context parameter', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Turn on the AC',
          sessionId: 'test-session-context',
          language: 'en-US',
          context: {
            location: 'car',
            previousIntent: 'climate_control',
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
    }, 30000);

    it('should accept explicit grounding=false without enabling grounding side effects', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'What is the weather today?',
          sessionId: 'test-session-grounding-false',
          language: 'en-US',
          grounding: false,
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
      expect(response.body).toHaveProperty('sessionId', 'test-session-grounding-false');
    }, 30000);

    it('should accept explicit grounding=true', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'What is the weather today?',
          sessionId: 'test-session-grounding-true',
          language: 'en-US',
          grounding: true,
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
      expect(response.body).toHaveProperty('sessionId', 'test-session-grounding-true');
    }, 30000);

    it('should maintain session context across multiple requests', async () => {
      const sessionId = 'test-session-multi-turn';

      const response1 = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Set temperature to 22 degrees',
          sessionId,
          language: 'en-US',
        })
        .expect(200);

      expect(response1.body.sessionId).toBe(sessionId);

      const response2 = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Make it cooler',
          sessionId,
          language: 'en-US',
        })
        .expect(200);

      expect(response2.body.sessionId).toBe(sessionId);
      expect(response2.body).toHaveProperty('response');
    }, 60000);
  });

  describe('POST /v1/chat - Error Cases', () => {
    it('should return 400 when text is missing', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          sessionId: 'test-session-no-text',
          language: 'de-DE',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toMatch(/text is required/i);
    });

    it('should return 400 when sessionId is missing', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Hello',
          language: 'de-DE',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toMatch(/session.*id.*required/i);
    });

    it('should return 400 when text exceeds maximum length', async () => {
      const longText = 'a'.repeat(501); // Exceeds 500 character limit

      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: longText,
          sessionId: 'test-session-long-text',
          language: 'de-DE',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('TEXT_TOO_LONG');
    });

    it('should return 400 when text is empty string', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: '',
          sessionId: 'test-session-empty',
          language: 'de-DE',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for an unknown mode', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Hello',
          sessionId: 'test-session-bad-mode',
          language: 'en-US',
          mode: 'supersonic',
        })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toMatch(/invalid mode/i);
    });

    it('should accept car mode without returning INVALID_REQUEST (#250)', async () => {
      // car mode was previously missing from VALID_MODES — it must not return 400
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Turn right in 300 metres',
          sessionId: 'test-session-car',
          language: 'en-US',
          mode: 'car',
        });

      // 200 (test mode short-circuit) or 403 (premium gate) — never 400 INVALID_REQUEST
      expect(response.status).not.toBe(400);
      if (response.body.error) {
        expect(response.body.error.code).not.toBe('INVALID_REQUEST');
      }
    });

    it('should handle invalid JSON payload', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .set('Content-Type', 'application/json')
        .send('{"invalid json}')
        .expect(400);

      // Accept empty object or error property for invalid JSON
      expect(response.body).toEqual(expect.any(Object));
      // If error property exists, check its structure
      if (response.body.error) {
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      }
    });
  });

  describe('POST /v1/chat - Intent Recognition', () => {
    it('should recognize navigation intent', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Navigate to the nearest gas station',
          sessionId: 'test-session-nav',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('intent');
      expect(response.body).toHaveProperty('slots');
    }, 30000);

    it('should recognize climate control intent', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Turn on the heating',
          sessionId: 'test-session-climate',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('intent');
      expect(response.body).toHaveProperty('response');
    }, 30000);

    it('should recognize media control intent', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Play some music',
          sessionId: 'test-session-media',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('intent');
    }, 30000);

    it('should handle ambiguous or unknown intents', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'asdfghjkl',
          sessionId: 'test-session-unknown',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('intent');
      expect(response.body).toHaveProperty('response');
    }, 30000);
  });

  describe('POST /v1/chat - Edge Cases', () => {
    it('should handle special characters in text', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'What about €100 & 50% discount?!',
          sessionId: 'test-session-special',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
    }, 30000);

    it('should handle emoji in text', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Turn on AC 🌡️ please 😊',
          sessionId: 'test-session-emoji',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
    }, 30000);

    it.skip('should handle multilingual text (code-switching)', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Can you help me mit Navigation?',
          sessionId: 'test-session-multilingual',
          language: 'en-US',
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
    }, 30000);

    it('should use default language when not specified', async () => {
      const response = await request(app)
        .post('/v1/chat')
        .send({
          text: 'Hello',
          sessionId: 'test-session-default-lang',
        })
        .expect(200);

      expect(response.body).toHaveProperty('response');
    }, 30000);
  });

  describe('GET /v1/chat/sessions', () => {
    it('should return active session count', async () => {
      const response = await request(app)
        .get('/v1/chat/sessions')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('activeSessions');
      expect(response.body).toHaveProperty('timestamp');
      expect(typeof response.body.activeSessions).toBe('number');
      expect(response.body.activeSessions).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /v1/chat/stream', () => {
    it('should stream SSE chunks and final done marker', async () => {
      const response = await request(app)
        .post('/v1/chat/stream')
        .send({
          text: 'Hello stream',
          sessionId: 'test-stream-session',
          language: 'en-US',
          mode: 'personal',
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/event-stream/);
      expect(response.text).toContain('event: text');
      expect(response.text).toContain('event: meta');
      expect(response.text).toContain('data: {"delta":"Test response","done":false}');
      expect(response.text).toContain('data: {"delta":"","done":true');
      expect(response.text).toContain('data: [DONE]');
    }, 30000);

    it('should stream successfully when heartbeat is enabled', async () => {
      const previousHeartbeatMs = process.env.SSE_HEARTBEAT_MS;
      process.env.SSE_HEARTBEAT_MS = '5';

      try {
        const response = await request(app)
          .post('/v1/chat/stream')
          .send({
            text: 'Hello heartbeat',
            sessionId: 'test-stream-heartbeat',
            language: 'en-US',
            mode: 'personal',
          })
          .expect(200);

        expect(response.headers['content-type']).toMatch(/text\/event-stream/);
        expect(response.text).toContain('data: {"delta":"","done":true');
        expect(response.text).toContain('data: [DONE]');
      } finally {
        if (previousHeartbeatMs === undefined) {
          delete process.env.SSE_HEARTBEAT_MS;
        } else {
          process.env.SSE_HEARTBEAT_MS = previousHeartbeatMs;
        }
      }
    }, 30000);

    it('should accept explicit grounding=false in stream payload', async () => {
      const response = await request(app)
        .post('/v1/chat/stream')
        .send({
          text: 'Hello stream without grounding',
          sessionId: 'test-stream-grounding-false',
          language: 'en-US',
          mode: 'personal',
          grounding: false,
        })
        .expect(200);

      expect(response.text).toContain('data: [DONE]');
    }, 30000);

    it('should accept explicit grounding=true in stream payload', async () => {
      const response = await request(app)
        .post('/v1/chat/stream')
        .send({
          text: 'Hello stream with grounding',
          sessionId: 'test-stream-grounding-true',
          language: 'en-US',
          mode: 'personal',
          grounding: true,
        })
        .expect(200);

      expect(response.text).toContain('data: [DONE]');
    }, 30000);

    it('should reject unsupported streaming mode', async () => {
      const response = await request(app)
        .post('/v1/chat/stream')
        .send({
          text: 'Hello',
          sessionId: 'test-stream-kids',
          language: 'en-US',
          mode: 'kids',
        })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toMatch(/streaming is not supported/i);
    });

    it('should validate required fields for stream endpoint', async () => {
      const response = await request(app)
        .post('/v1/chat/stream')
        .send({ sessionId: 'missing-text' })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toMatch(/text and sessionId are required/i);
    });
  });

  describe('Rate Limiting', () => {
    it('should handle multiple concurrent requests', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/v1/chat')
            .send({
              text: `Test message ${i}`,
              sessionId: `concurrent-session-${i}`,
              language: 'en-US',
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // All should succeed or be rate limited
      responses.forEach((response) => {
        expect([200, 429]).toContain(response.status);
      });
    }, 60000);
  });
});
