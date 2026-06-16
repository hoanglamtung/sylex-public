import request from 'supertest';
import app from '../src/index.js';
import path from 'path';

describe('ASR Endpoints', () => {
  it('POST /v1/asr should return transcript for valid audio', async () => {
    const audioPath = path.resolve(__dirname, '../audio/Hello_Atest.wav');
    const response = await request(app)
      .post('/v1/asr')
      .field('language', 'de-DE')
      .field('enableProfanityFilter', 'true')
      .field('enableAutomaticPunctuation', 'true')
      .field('model', 'default')
      .attach('audio', audioPath);
    expect(response.status).toBe(200);
    expect(response.body.transcript).toBeDefined();
    expect(response.body.requestId).toBeDefined();
    expect(response.body.confidence).toBeDefined();
  });

  it('POST /v1/asr should return error for missing audio', async () => {
    const response = await request(app)
      .post('/v1/asr')
      .field('language', 'de-DE');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('POST /v1/asr/stream should return not implemented error', async () => {
    const response = await request(app)
      .post('/v1/asr/stream');
    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
