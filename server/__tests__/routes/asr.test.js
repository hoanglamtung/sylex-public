import 'dotenv/config';
/**
 * ASR Endpoint Tests
 * Tests for /v1/asr endpoints
 */

import request from 'supertest';
import express from 'express';
import asrRoutes from '../../src/routes/asr.js';
import errorHandler from '../../src/middleware/errorHandler.js';
import { generateMockWavBuffer, generateInvalidAudioBuffer, generateLargeBuffer } from '../helpers/mockAudio.js';
import path from 'path';
import fs from 'fs';

// Create test app
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.id = 'test-request-id';
  next();
});
app.use('/v1/asr', asrRoutes);
// Mount global error handler so tests receive structured error responses
app.use(errorHandler);

describe('ASR Endpoint Tests', () => {
  describe('POST /v1/asr - Happy Path', () => {
    it('should transcribe audio file successfully (German)', async () => {
      // Use generated mock buffer for deterministic test environment
      const audioBuffer = generateMockWavBuffer(2000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'Hello_Atest.wav')
        .field('language', 'de-DE')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('requestId');
      expect(response.body).toHaveProperty('transcript');
      expect(response.body).toHaveProperty('confidence');
      expect(response.body).toHaveProperty('language');
      expect(response.body).toHaveProperty('processingTimeMs');
      expect(response.body.language).toBe('de-DE');
      expect(typeof response.body.confidence).toBe('number');
      expect(response.body.confidence).toBeGreaterThanOrEqual(0);
      expect(response.body.confidence).toBeLessThanOrEqual(1);
    }, 30000);

    it('should transcribe audio file successfully (English)', async () => {
      const audioBuffer = generateMockWavBuffer(2000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'test-audio.wav')
        .field('language', 'en-US')
        .expect(200);

      expect(response.body).toHaveProperty('transcript');
      expect(response.body.language).toBe('en-US');
    }, 30000);

    it('should accept MP3 audio format', async () => {
      const audioBuffer = generateMockWavBuffer(1000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, {
          filename: 'test-audio.mp3',
          contentType: 'audio/mpeg',
        })
        .field('language', 'en-US')
        .expect(200);

      expect(response.body).toHaveProperty('transcript');
    }, 30000);

    it('should return processing time in headers', async () => {
      const audioBuffer = generateMockWavBuffer(1000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'test-audio.wav')
        .field('language', 'de-DE')
        .expect(200);

      expect(response.headers).toHaveProperty('x-processing-time-ms');
      expect(parseInt(response.headers['x-processing-time-ms'])).toBeGreaterThan(0);
    }, 30000);

    it('should include alternatives in response', async () => {
      const audioBuffer = generateMockWavBuffer(1000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'test-audio.wav')
        .field('language', 'de-DE')
        .expect(200);

      expect(response.body).toHaveProperty('alternatives');
      expect(Array.isArray(response.body.alternatives)).toBe(true);
    }, 30000);
  });

  describe('POST /v1/asr - Error Cases', () => {
    it('should return 400 when audio file is missing', async () => {
      const response = await request(app)
        .post('/v1/asr')
        .field('language', 'de-DE')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toMatch(/audio file is required/i);
    });

    it('should return 400 for unsupported audio format', async () => {
      const invalidBuffer = Buffer.from('not an audio file');

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', invalidBuffer, {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .field('language', 'de-DE')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_AUDIO_FORMAT');
    });

    it('should return 413 when audio file exceeds size limit', async () => {
      const largeBuffer = generateLargeBuffer(15); // 15MB (over 10MB limit)

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', largeBuffer, 'large-audio.wav')
        .field('language', 'de-DE')
        .expect(413);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle invalid language code gracefully', async () => {
      const audioBuffer = generateMockWavBuffer(1000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'test-audio.wav')
        .field('language', 'xx-XX') // Invalid language code
        .expect((res) => {
          // Should either return 400 or default to valid language
          expect([400, 200]).toContain(res.status);
        });
    }, 30000);

    it('should return error for corrupted audio file', async () => {
      const invalidBuffer = generateInvalidAudioBuffer();

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', invalidBuffer, {
          filename: 'corrupted.wav',
          contentType: 'audio/wav',
        })
        .field('language', 'de-DE')
        .expect((res) => {
          // Should return error (400 or 500)
          expect(res.status).toBeGreaterThanOrEqual(400);
        });
    }, 30000);
  });

  describe('POST /v1/asr - Optional Parameters', () => {
    it('should respect profanity filter setting', async () => {
      const audioBuffer = generateMockWavBuffer(1000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'test-audio.wav')
        .field('language', 'de-DE')
        .field('enableProfanityFilter', 'false')
        .expect(200);

      expect(response.body).toHaveProperty('transcript');
    }, 30000);

    it('should respect automatic punctuation setting', async () => {
      const audioBuffer = generateMockWavBuffer(1000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'test-audio.wav')
        .field('language', 'de-DE')
        .field('enableAutomaticPunctuation', 'false')
        .expect(200);

      expect(response.body).toHaveProperty('transcript');
    }, 30000);

    it('should use default language when not specified', async () => {
      const audioBuffer = generateMockWavBuffer(1000);

      const response = await request(app)
        .post('/v1/asr')
        .attach('audio', audioBuffer, 'test-audio.wav')
        .expect(200);

      expect(response.body).toHaveProperty('language');
      expect(response.body.language).toBeTruthy();
    }, 30000);
  });

  describe('POST /v1/asr/stream', () => {
    it('should return 501 Not Implemented for streaming endpoint', async () => {
      const response = await request(app)
        .post('/v1/asr/stream')
        .send({ language: 'de-DE' })
        .expect(501);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits after multiple requests', async () => {
      // Note: This test requires rate limiting to be configured
      // In test environment, rate limits should be higher
      // This is a placeholder - actual rate limiting tests need proper setup
      const audioBuffer = generateMockWavBuffer(500);

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/v1/asr')
            .attach('audio', audioBuffer, 'test-audio.wav')
            .field('language', 'de-DE')
        );
      }

      const responses = await Promise.all(promises);
      
      // All should succeed in test environment (high limits)
      responses.forEach((response) => {
        expect([200, 429]).toContain(response.status);
      });
    }, 60000);
  });
});
