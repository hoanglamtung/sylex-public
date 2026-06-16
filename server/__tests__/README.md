# Backend API Tests

Comprehensive test suite for Car Assistant Pro backend endpoints.

## Test Coverage

### ASR Endpoint (`/v1/asr`)
- ✅ Happy path: German and English transcription
- ✅ Multiple audio formats (WAV, MP3, FLAC, OGG)
- ✅ Error cases: missing file, unsupported format, file too large
- ✅ Optional parameters: profanity filter, automatic punctuation
- ✅ Processing time metrics
- ✅ Rate limiting

### Chat Endpoint (`/v1/chat`)
- ✅ Happy path: German and English conversation
- ✅ Intent recognition (navigation, climate, media)
- ✅ Session management and context
- ✅ Error cases: missing text/sessionId, text too long
- ✅ Edge cases: special characters, emoji, multilingual
- ✅ Admin endpoint: session count
- ✅ Rate limiting

### TTS Endpoint (`/v1/tts`)
- ✅ Happy path: German and English synthesis
- ✅ Multiple audio formats (MP3, WAV, OGG)
- ✅ Voice parameters: speaking rate, pitch, voice selection
- ✅ Error cases: missing text, text too long, unsupported format
- ✅ Edge cases: special characters, numbers, punctuation, emoji
- ✅ Audio duration metrics
- ✅ Rate limiting

## Running Tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- __tests__/routes/asr.test.js
```

## Test Configuration

Tests are configured to:
- Use mock Azure credentials if real ones aren't available
- Disable rate limiting for faster test execution
- Suppress console logs (except errors)
- Set appropriate timeouts for API calls (30s)

## Test Environment

Tests use a separate test environment with:
- `NODE_ENV=test`
- High rate limits (10000 req/min)
- Shorter timeouts (5s)
- Mock Azure services when keys unavailable

## Adding New Tests

1. Create test file in `__tests__/routes/`
2. Import route and setup Express app
3. Write test cases using `describe` and `it` blocks
4. Use `supertest` for API requests
5. Assert response status, body, and headers

Example:
```javascript
import request from 'supertest';
import express from 'express';
import myRoute from '../../src/routes/myRoute.js';

const app = express();
app.use(express.json());
app.use('/v1/myroute', myRoute);

describe('My Route Tests', () => {
  it('should handle request', async () => {
    const response = await request(app)
      .post('/v1/myroute')
      .send({ data: 'test' })
      .expect(200);

    expect(response.body).toHaveProperty('result');
  });
});
```

## Test Helpers

### Mock Audio Generator (`__tests__/helpers/mockAudio.js`)
- `generateMockWavBuffer(durationMs)` - Create WAV audio
- `generateMockMp3Buffer()` - Create MP3 audio
- `generateInvalidAudioBuffer()` - Create invalid data
- `generateLargeBuffer(sizeMB)` - Create large buffer for size tests

## CI/CD Integration

Tests are automatically run on:
- Every pull request (via `.github/workflows/pr-checks.yml`)
- Every push to master (via `.github/workflows/release.yml`)

## Coverage Goals

Target coverage:
- Statements: > 80%
- Branches: > 75%
- Functions: > 80%
- Lines: > 80%

Current coverage can be viewed by running `npm run test:coverage`.

## Troubleshooting

### Tests timeout
- Increase timeout in jest.config.js or individual test
- Check if Azure services are slow/unavailable
- Use mock services for faster tests

### Rate limit errors
- Verify `RATE_LIMIT_MAX_REQUESTS_*` env vars are high in tests
- Check if actual rate limiting is enforced in test env

### Module not found errors
- Ensure all imports use `.js` extensions
- Check jest.config.js moduleNameMapper settings
- Verify file paths are correct

## Notes

- Tests require Node.js 18+
- Some tests require actual Azure credentials for full integration testing
- Mock services are used when credentials unavailable
- All tests should be independent and idempotent
