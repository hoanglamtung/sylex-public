import 'dotenv/config';
/**
 * TTS Endpoint Tests
 * Tests for /v1/tts endpoints
 */

import request from 'supertest';
import express from 'express';
import ttsRoutes from '../../src/routes/tts.js';
import errorHandler from '../../src/middleware/errorHandler.js';

// Create test app
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'test-request-id';
  next();
});
app.use('/v1/tts', ttsRoutes);
// Mount global error handler so tests receive structured error responses
app.use(errorHandler);

describe('TTS Endpoint Tests', () => {
  describe('POST /v1/tts - Happy Path', () => {
    it('should synthesize speech successfully (German)', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Guten Tag, wie kann ich Ihnen helfen?',
          language: 'de-DE',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/audio/);
      expect(response.headers).toHaveProperty('x-processing-time-ms');
      expect(response.headers).toHaveProperty('x-audio-duration');
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should synthesize speech successfully (English)', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Hello, how can I help you?',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/audio/);
      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should support MP3 audio format', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'This is a test',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/audio\/mpeg/i);
    }, 30000);

    it('should support WAV audio format', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'This is a test',
          language: 'en-US',
          audioFormat: 'wav',
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/audio\/wav/i);
    }, 30000);

    it('should support OGG audio format', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'This is a test',
          language: 'en-US',
          audioFormat: 'ogg',
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/audio/);
    }, 30000);

    it('should use default voice when not specified', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Default voice test',
          language: 'de-DE',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should return audio duration in headers', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'This is a longer test to check audio duration',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.headers).toHaveProperty('x-audio-duration');
      expect(response.headers['x-audio-duration']).toBeTruthy();
    }, 30000);
  });

  describe('POST /v1/tts - Error Cases', () => {
    it('should return 400 when text is missing', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          language: 'de-DE',
          audioFormat: 'mp3',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toMatch(/text is required/i);
    });

    it('should return 400 when text is empty string', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: '',
          language: 'de-DE',
          audioFormat: 'mp3',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when text exceeds maximum length', async () => {
      const longText = 'a'.repeat(1001); // Exceeds 1000 character limit

      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: longText,
          language: 'de-DE',
          audioFormat: 'mp3',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('TEXT_TOO_LONG');
    });

    it('should return 400 for unsupported audio format', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Test',
          language: 'de-DE',
          audioFormat: 'flac', // Not in supported list
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_AUDIO_FORMAT');
      expect(response.body.error.message).toMatch(/unsupported audio format/i);
    });

    it('should handle invalid JSON payload', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .set('Content-Type', 'application/json')
        .send('{"invalid json}')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /v1/tts - Voice Parameters', () => {
    it('should respect speaking rate parameter', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Test speaking rate',
          language: 'en-US',
          audioFormat: 'mp3',
          speakingRate: 1.5,
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should respect pitch parameter', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Test pitch',
          language: 'en-US',
          audioFormat: 'mp3',
          pitch: 5,
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should support custom voice selection', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Custom voice test',
          language: 'de-DE',
          voice: 'de-DE-KatjaNeural',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should use default audio format when not specified', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Default format test',
          language: 'de-DE',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('POST /v1/tts - Edge Cases', () => {
    it('should handle text with special characters', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Price is €100 & tax is 19%!',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle text with numbers', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Call me at 123-456-7890',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle text with punctuation', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Hello! How are you? I am fine, thank you.',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle very short text', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Hi',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle text at maximum length boundary', async () => {
      const maxText = 'a'.repeat(1000); // Exactly at limit

      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: maxText,
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle multilingual text', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Hello and Guten Tag',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle emoji in text', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Have a nice day 😊🌞',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Rate Limiting', () => {
    it('should handle multiple concurrent requests', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/v1/tts')
            .send({
              text: `Test message ${i}`,
              language: 'en-US',
              audioFormat: 'mp3',
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

  describe('POST /v1/tts - Content Validation', () => {
    it('should handle text with line breaks', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Line one.\nLine two.\nLine three.',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle text with tabs', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'Column one\tColumn two\tColumn three',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle HTML-like content (should be escaped/handled)', async () => {
      const response = await request(app)
        .post('/v1/tts')
        .send({
          text: 'This is <b>bold</b> and <i>italic</i> text',
          language: 'en-US',
          audioFormat: 'mp3',
        })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    }, 30000);
  });
});
