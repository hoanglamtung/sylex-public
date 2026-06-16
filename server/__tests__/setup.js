/**
 * Test setup file
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.API_VERSION = 'v1';

// Mock Azure services if keys not available
if (!process.env.AZURE_SPEECH_KEY) {
  process.env.AZURE_SPEECH_KEY = 'mock-speech-key';
  process.env.AZURE_SPEECH_REGION = 'eastus';
}

if (!process.env.AZURE_OPENAI_KEY) {
  process.env.AZURE_OPENAI_KEY = 'mock-openai-key';
  process.env.AZURE_OPENAI_ENDPOINT = 'https://mock.openai.azure.com';
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME = 'gpt-4o-turbo';
}

// Disable rate limiting for tests
process.env.RATE_LIMIT_MAX_REQUESTS_ASR = '10000';
process.env.RATE_LIMIT_MAX_REQUESTS_CHAT = '10000';
process.env.RATE_LIMIT_MAX_REQUESTS_TTS = '10000';

// Set test timeouts
process.env.REQUEST_TIMEOUT_MS = '5000';

// Suppress console logs during tests (except errors)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: console.error, // Keep errors visible
};
