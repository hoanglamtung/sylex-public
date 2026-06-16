/**
 * Unit tests for GeminiService (#134)
 *
 * All @google-cloud/vertexai calls are mocked so no GCP credentials
 * are required to run this suite.
 */

import { jest } from '@jest/globals';

// ── Mock @google-cloud/vertexai BEFORE importing the module under test ────────
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
}));

jest.unstable_mockModule('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  HarmCategory: {
    HARM_CATEGORY_UNSPECIFIED: 'HARM_CATEGORY_UNSPECIFIED',
  },
  HarmBlockThreshold: {
    BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
  },
}));

const { default: GeminiService } = await import(
  '../../src/services/geminiService.js'
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeResponse(text, finishReason = 'STOP') {
  return {
    response: {
      candidates: [
        {
          content: { parts: [{ text }] },
          finishReason,
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    },
  };
}

const MESSAGES = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
];

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GeminiService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.VERTEX_AI_LOCATION = 'us-central1';
    process.env.VERTEX_AI_MODEL_FREE = 'gemini-2.0-flash';
    process.env.VERTEX_AI_MODEL_PREMIUM = 'gemini-2.5-pro';
    delete process.env.STREAM_TEXT_ONLY;
    delete process.env.NODE_ENV;
    service = new GeminiService();
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  // ── constructor ─────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('reads free/premium model names from env', () => {
      expect(service.modelFree).toBe('gemini-2.0-flash');
      expect(service.modelPremium).toBe('gemini-2.5-pro');
    });

    it('throws when required model env vars are absent', () => {
      delete process.env.VERTEX_AI_MODEL_FREE;
      delete process.env.VERTEX_AI_MODEL_PREMIUM;
      expect(() => new GeminiService()).toThrow();
    });

    it('enables text-only stream mode via env flag', () => {
      process.env.STREAM_TEXT_ONLY = 'true';
      const textOnlyService = new GeminiService();
      expect(textOnlyService.streamTextOnly).toBe(true);
    });
  });

  // ── model selection ─────────────────────────────────────────────────────────
  describe('model selection', () => {
    it('uses free model when isPremium=false', async () => {
      mockGenerateContent.mockResolvedValue(makeResponse('Hi there!'));
      await service.chat(MESSAGES, 'en', false);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-flash' })
      );
    });

    it('uses premium model when isPremium=true', async () => {
      mockGenerateContent.mockResolvedValue(makeResponse('Hi premium user!'));
      await service.chat(MESSAGES, 'en', true);
      expect(mockGetGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.5-pro' })
      );
    });
  });

  // ── chat() ──────────────────────────────────────────────────────────────────
  describe('chat()', () => {
    it('returns content, usage, and model on success', async () => {
      mockGenerateContent.mockResolvedValue(makeResponse('Hello World'));
      const result = await service.chat(MESSAGES, 'en', false);
      expect(result.content).toBe('Hello World');
      expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
      expect(result.model).toBe('gemini-2.0-flash');
    });

    it('returns policy response on SAFETY finish reason', async () => {
      mockGenerateContent.mockResolvedValue(makeResponse('', 'SAFETY'));
      const result = await service.chat(MESSAGES, 'en', false);
      expect(result.content).toContain('"intent"');
    });

    it('returns policy response on BLOCKLIST finish reason', async () => {
      mockGenerateContent.mockResolvedValue(makeResponse('', 'BLOCKLIST'));
      const result = await service.chat(MESSAGES, 'en', false);
      expect(result.content).toContain('"intent"');
    });

    it('returns German policy response for de-DE language', async () => {
      mockGenerateContent.mockResolvedValue(makeResponse('', 'PROHIBITED_CONTENT'));
      const result = await service.chat(MESSAGES, 'de-DE', false);
      expect(result.content).toContain('nicht eingehen');
    });

    it('throws AppError when Vertex AI call rejects', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));
      await expect(service.chat(MESSAGES, 'en', false)).rejects.toThrow();
    });

    it('uses structured path when grounding tools are absent', async () => {
      const structuredSpy = jest
        .spyOn(service, '_chatStructured')
        .mockResolvedValue({ content: 'structured', usage: null, model: 'gemini-2.0-flash' });
      const groundingSpy = jest
        .spyOn(service, '_chatWithGrounding')
        .mockResolvedValue({ content: 'grounded', usage: null, model: 'gemini-2.0-flash' });

      const result = await service.chat(MESSAGES, 'en', false, null, []);

      expect(structuredSpy).toHaveBeenCalledTimes(1);
      expect(groundingSpy).not.toHaveBeenCalled();
      expect(result.content).toBe('structured');
    });

    it('uses grounding path only when grounding tools are explicitly provided', async () => {
      const structuredSpy = jest
        .spyOn(service, '_chatStructured')
        .mockResolvedValue({ content: 'structured', usage: null, model: 'gemini-2.0-flash' });
      const groundingSpy = jest
        .spyOn(service, '_chatWithGrounding')
        .mockResolvedValue({ content: 'grounded', usage: null, model: 'gemini-2.0-flash' });

      const result = await service.chat(MESSAGES, 'en', false, null, [{ googleSearch: {} }]);

      expect(groundingSpy).toHaveBeenCalledTimes(1);
      expect(structuredSpy).not.toHaveBeenCalled();
      expect(result.content).toBe('grounded');
    });
  });

  describe('chatStream()', () => {
    it('uses grounding text fast path when STREAM_TEXT_ONLY is enabled', async () => {
      process.env.STREAM_TEXT_ONLY = 'true';
      const textOnlyService = new GeminiService();

      const fastPathSpy = jest
        .spyOn(textOnlyService, '_chatWithGroundingText')
        .mockResolvedValue({ content: 'Munich: 15C and sunny.', usage: null, model: 'gemini-2.0-flash' });
      const structuredGroundingSpy = jest
        .spyOn(textOnlyService, '_chatWithGrounding')
        .mockResolvedValue({ content: '{"text":"slow path"}', usage: null, model: 'gemini-2.0-flash' });

      const events = [];
      for await (const event of textOnlyService.chatStream(MESSAGES, 'en', false, null, [{ googleSearch: {} }], { mode: 'personal' })) {
        events.push(event);
      }

      expect(fastPathSpy).toHaveBeenCalledTimes(1);
      expect(structuredGroundingSpy).not.toHaveBeenCalled();
      expect(events.some(e => e.done === false && typeof e.delta === 'string' && e.delta.length > 0)).toBe(true);
      expect(events[events.length - 1]?.done).toBe(true);
    });
  });

  // ── _withRetry() — rate-limit backoff optimization (#293) ──────────────────
  describe('_withRetry()', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns immediately on success without retrying', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await service._withRetry(fn, 3, 100);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('propagates non-rate-limit errors immediately without retrying', async () => {
      const networkErr = new Error('Network error');
      const fn = jest.fn().mockRejectedValue(networkErr);
      await expect(service._withRetry(fn, 3, 100)).rejects.toThrow('Network error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on rate-limit 429 and succeeds on second attempt', async () => {
      const rateLimitErr = Object.assign(new Error('Rate limit'), { status: 429 });
      const fn = jest.fn()
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce('retry-ok');

      const retryPromise = service._withRetry(fn, 3, 0);
      // advance any pending timers
      await jest.runAllTimersAsync();
      const result = await retryPromise;

      expect(result).toBe('retry-ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all maxAttempts on persistent rate-limit', async () => {
      const rateLimitErr = Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 });
      const fn = jest.fn().mockRejectedValue(rateLimitErr);

      const p = service._withRetry(fn, 2, 0);
      // Suppress unhandled-rejection warning while we advance timers
      p.catch(() => {});
      await jest.runAllTimersAsync();
      await expect(p).rejects.toMatchObject({ code: 8 });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('stops retrying immediately when totalBudgetMs is 0 (budget exhausted)', async () => {
      const rateLimitErr = Object.assign(new Error('429'), { status: 429 });
      const fn = jest.fn().mockRejectedValue(rateLimitErr);

      // totalBudgetMs=0 means no budget for any delay → should not retry
      const p = service._withRetry(fn, 3, 100, 0);
      // Suppress unhandled-rejection warning; no timers fire with budget=0
      p.catch(() => {});
      await expect(p).rejects.toBeDefined();
      // fn called once; budget=0 means retry loop breaks before second attempt
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('stream path uses streamRetryMaxAttempts and streamRetryTotalBudgetMs', () => {
      // Verify the constructor wires up stream-specific retry params
      expect(service.streamRetryMaxAttempts).toBeGreaterThanOrEqual(1);
      expect(service.streamRetryBaseDelayMs).toBeLessThan(2000); // shorter than non-stream default
      expect(service.streamRetryTotalBudgetMs).toBeLessThanOrEqual(5000); // bounded budget
    });
  });

  // ── _toGeminiContents() ─────────────────────────────────────────────────────
  describe('_toGeminiContents()', () => {
    it('extracts system messages into systemInstruction', () => {
      const msgs = [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ];
      const { systemInstruction, contents } = service._toGeminiContents(msgs);
      expect(systemInstruction).toEqual({ parts: [{ text: 'Be helpful.' }] });
      expect(contents[0].role).toBe('user');
    });

    it('maps assistant role to model', () => {
      const msgs = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ];
      const { contents } = service._toGeminiContents(msgs);
      expect(contents[1].role).toBe('model');
    });

    it('merges consecutive same-role turns (Gemini strict alternation)', () => {
      const msgs = [
        { role: 'user', content: 'First user msg.' },
        { role: 'user', content: 'Second user msg.' },
        { role: 'assistant', content: 'Response.' },
      ];
      const { contents } = service._toGeminiContents(msgs);
      // Two consecutive user turns merged → only 2 total turns
      expect(contents).toHaveLength(2);
      // Merged parts are appended separately (not concatenated into one string)
      expect(contents[0].parts[0].text).toBe('First user msg.');
      expect(contents[0].parts[1].text).toBe('Second user msg.');
    });

    it('strips leading non-user turns', () => {
      const msgs = [
        { role: 'assistant', content: 'Stray opening.' },
        { role: 'user', content: 'Hello' },
      ];
      const { contents } = service._toGeminiContents(msgs);
      expect(contents[0].role).toBe('user');
    });
  });

  // ── token budget defaults (#292) ──────────────────────────────────────────────
  describe('constructor token budget defaults (#292)', () => {
    it('groundingPhase1MaxOutputTokens defaults to 768', () => {
      delete process.env.GROUNDING_PHASE1_MAX_OUTPUT_TOKENS;
      const s = new GeminiService();
      expect(s.groundingPhase1MaxOutputTokens).toBe(768);
    });

    it('groundingPhase2MaxOutputTokens defaults to 2048', () => {
      delete process.env.GROUNDING_PHASE2_MAX_OUTPUT_TOKENS;
      const s = new GeminiService();
      expect(s.groundingPhase2MaxOutputTokens).toBe(2048);
    });

    it('groundingPhase1MaxOutputTokens is configurable via env', () => {
      process.env.GROUNDING_PHASE1_MAX_OUTPUT_TOKENS = '1024';
      const s = new GeminiService();
      expect(s.groundingPhase1MaxOutputTokens).toBe(1024);
      delete process.env.GROUNDING_PHASE1_MAX_OUTPUT_TOKENS;
    });
  });

  // ── _trimGroundedFacts() sentence-aware truncation (#292) ────────────────────
  describe('_trimGroundedFacts() sentence-aware truncation (#292)', () => {
    it('returns facts unchanged when under the limit', () => {
      const s = new GeminiService();
      s.groundingFactsMaxChars = 200;
      const short = 'Fuel price is 1.85 EUR/L. Traffic is clear.';
      expect(s._trimGroundedFacts(short)).toBe(short);
    });

    it('truncates at sentence boundary, not mid-word', () => {
      const s = new GeminiService();
      s.groundingFactsMaxChars = 20;
      // "First sentence." is 15 chars; "Second sentence is much longer." pushes past 20
      const facts = 'First sentence. Second sentence is much longer.';
      const result = s._trimGroundedFacts(facts);
      expect(result).toContain('First sentence.');
      expect(result).not.toContain('Second sentence');
      expect(result).toContain('[facts trimmed]');
    });

    it('falls back to hard cut when no sentence boundary is beyond 40% threshold', () => {
      const s = new GeminiService();
      s.groundingFactsMaxChars = 20;
      // The only sentence end is at position 5, well under 40% of 20 (=8)
      const facts = 'OK. A very long sentence that exceeds the limit completely.';
      const result = s._trimGroundedFacts(facts);
      // Falls back to hard cut at 20 chars
      expect(result.length).toBeLessThanOrEqual(20 + 20); // trim marker can be longer
    });

    it('returns empty string for null/empty input', () => {
      const s = new GeminiService();
      expect(s._trimGroundedFacts('')).toBe('');
      expect(s._trimGroundedFacts(null)).toBe('');
    });
  });

  // ── _extractCandidate() truncation flag (#292) ────────────────────────────────
  describe('_extractCandidate() truncated flag (#292)', () => {
    it('returns truncated=false for normal STOP finish reason', () => {
      const result = makeResponse('{"text":"Hello"}', 'STOP');
      const { blocked, truncated, text } = service._extractCandidate(result, 'en-US', 'gemini-test');
      expect(blocked).toBe(false);
      expect(truncated).toBe(false);
      expect(text).toBe('{"text":"Hello"}');
    });

    it('returns truncated=true for MAX_TOKENS finish reason', () => {
      const result = makeResponse('{"text":"Hello trunc', 'MAX_TOKENS');
      const { blocked, truncated } = service._extractCandidate(result, 'en-US', 'gemini-test');
      expect(blocked).toBe(false);
      expect(truncated).toBe(true);
    });

    it('returns blocked=true for SAFETY finish reason', () => {
      const result = makeResponse('blocked', 'SAFETY');
      const { blocked } = service._extractCandidate(result, 'en-US', 'gemini-test');
      expect(blocked).toBe(true);
    });
  });

  // ── _runStructuredCall() MAX_TOKENS recovery (#292) ───────────────────────────
  describe('_runStructuredCall() MAX_TOKENS recovery (#292)', () => {
    it('recovers partial JSON with text field from MAX_TOKENS response', async () => {
      // Simulate Gemini truncating after a valid JSON object (common with thinking models)
      mockGenerateContent.mockResolvedValue(
        makeResponse('{"text":"Speed limit is 50.","intent":"info","action":"answer","parameters":{}}', 'MAX_TOKENS')
      );
      const contents = [{ role: 'user', parts: [{ text: 'Speed limit?' }] }];
      const result = await service._runStructuredCall(contents, undefined, 'gemini-test', 'en-US', { maxOutputTokens: 512 });
      // Should return the partial JSON with the usable text field
      const parsed = JSON.parse(result.content);
      expect(parsed.text).toBe('Speed limit is 50.');
    });

    it('returns empty content when MAX_TOKENS JSON is unrecoverable', async () => {
      // Simulate truncation in the middle of the JSON object (no closing brace)
      mockGenerateContent.mockResolvedValue(
        makeResponse('{"text":"Speed limit is 50.", "intent":"info", "action":', 'MAX_TOKENS')
      );
      const contents = [{ role: 'user', parts: [{ text: 'Speed?' }] }];
      const result = await service._runStructuredCall(contents, undefined, 'gemini-test', 'en-US', { maxOutputTokens: 512 });
      // Unrecoverable → empty triggers chatService retry path
      expect(result.content).toBe('');
    });
  });

  // ── _extractFirstJsonObject() ────────────────────────────────────────────────
  describe('_extractFirstJsonObject()', () => {
    it('returns the first balanced JSON object', () => {
      const json = '{"intent":"navigate","text":"OK"}';
      expect(service._extractFirstJsonObject(json)).toBe(json);
    });

    it('extracts JSON from preamble prose', () => {
      const input = 'Based on results: {"intent":"navigate","text":"Turn left."}';
      expect(service._extractFirstJsonObject(input)).toBe('{"intent":"navigate","text":"Turn left."}');
    });

    it('handles nested objects', () => {
      const input = 'Prefix {"a":{"b":1}} rest';
      expect(service._extractFirstJsonObject(input)).toBe('{"a":{"b":1}}');
    });

    it('returns null when no JSON object present', () => {
      expect(service._extractFirstJsonObject('plain text')).toBeNull();
    });

    it('returns null for empty/null input', () => {
      expect(service._extractFirstJsonObject('')).toBeNull();
      expect(service._extractFirstJsonObject(null)).toBeNull();
    });

    it('ignores orphan closing brace before valid JSON', () => {
      expect(service._extractFirstJsonObject('stray } {"text":"ok"}')).toBe('{"text":"ok"}');
    });
  });

  // ── _extractPlainTextFromGroundingResult() ───────────────────────────────────
  describe('_extractPlainTextFromGroundingResult() #295', () => {
    it('passes through plain text unchanged', () => {
      expect(service._extractPlainTextFromGroundingResult('Turn right in 200 metres.')).toBe('Turn right in 200 metres.');
    });

    it('extracts text field from bare JSON', () => {
      const json = '{"intent":"navigate","action":"route","parameters":{},"text":"Turn right.","confidence":0.9}';
      expect(service._extractPlainTextFromGroundingResult(json)).toBe('Turn right.');
    });

    it('extracts text field from preamble+JSON', () => {
      const input = 'Based on search results: {"intent":"info","action":null,"parameters":{},"text":"The answer is 42.","confidence":0.8}';
      expect(service._extractPlainTextFromGroundingResult(input)).toBe('The answer is 42.');
    });

    it('returns empty string when model returns JSON with no text field', () => {
      const input = '{"intent":"navigate","action":"route","parameters":{}}';
      expect(service._extractPlainTextFromGroundingResult(input)).toBe('');
    });

    it('returns empty string when structural JSON is present but unparseable', () => {
      const input = '{ "intent": "navigate", "action": "route" BROKEN';
      expect(service._extractPlainTextFromGroundingResult(input)).toBe('');
    });

    it('returns empty string for null/empty input', () => {
      expect(service._extractPlainTextFromGroundingResult('')).toBe('');
      expect(service._extractPlainTextFromGroundingResult(null)).toBe('');
    });
  });

  // ── chatStream() grounding catch fallback (#295) ──────────────────────────────
  describe('chatStream() grounding preamble+JSON catch fallback #295', () => {
    it('yields text field from preamble+JSON content, not raw JSON', async () => {
      service._chatWithGrounding = jest.fn().mockResolvedValue({
        content: 'Based on live data: {"intent":"info","action":null,"parameters":{},"text":"Speed limit is 50 km/h.","confidence":0.9}',
      });
      service.streamTextOnly = false;
      const deltas = [];
      for await (const event of service.chatStream([{ role: 'user', content: 'Speed?' }], 'en-US', false, null, [{ googleSearch: {} }])) {
        deltas.push(event);
      }
      const textDeltas = deltas.filter(e => !e.done).map(e => e.delta);
      expect(textDeltas).toEqual(['Speed limit is 50 km/h.']);
      const metaEvent = deltas.find(e => e.done);
      expect(metaEvent.meta.intent).toBe('info');
    });

    it('yields empty delta (silence) when preamble+JSON has no text field', async () => {
      service._chatWithGrounding = jest.fn().mockResolvedValue({
        content: 'Some preamble {"intent":"navigate","action":"route","parameters":{}}',
      });
      service.streamTextOnly = false;
      const deltas = [];
      for await (const event of service.chatStream([{ role: 'user', content: 'Go home' }], 'en-US', false, null, [{ googleSearch: {} }])) {
        deltas.push(event);
      }
      const textDeltas = deltas.filter(e => !e.done).map(e => e.delta);
      expect(textDeltas).toHaveLength(0);
    });
  });

  // ── _prefetchGroundingFacts() (#291) ──────────────────────────────────────────
  describe('_prefetchGroundingFacts() parallel grounding prefetch (#291)', () => {
    it('returns empty string in test mode without calling Vertex AI', async () => {
      process.env.NODE_ENV = 'test';
      const result = await service._prefetchGroundingFacts('What is the weather?', 'en-US', 'gemini-test');
      expect(result).toBe('');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('returns empty string for empty query without calling Vertex AI', async () => {
      // Temporarily force non-test mode to test the empty-query guard
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      // Re-create service so it tries to call Vertex, but query is empty
      const result = await service._prefetchGroundingFacts('', 'en-US', 'gemini-test');
      expect(result).toBe('');
      expect(mockGenerateContent).not.toHaveBeenCalled();
      process.env.NODE_ENV = origEnv;
    });

    it('deduplicates concurrent calls: same cacheKey shares one in-flight promise', async () => {
      // Bypass test-mode guard for this test
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Simulate a slow Phase 1 response
      let resolvePhase1;
      mockGenerateContent.mockReturnValueOnce(
        new Promise(res => { resolvePhase1 = () => res(makeResponse('Facts about weather.', 'STOP')); })
      );

      // Fire two concurrent prefetches for the same query
      const p1 = service._prefetchGroundingFacts('weather Berlin', 'de-DE', 'gemini-flash');
      const p2 = service._prefetchGroundingFacts('weather Berlin', 'de-DE', 'gemini-flash');

      // Both should return the SAME promise (dedup)
      expect(p1).toBe(p2);

      resolvePhase1();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('Facts about weather.');
      expect(r2).toBe('Facts about weather.');
      // Vertex AI called exactly once despite two prefetch calls
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      process.env.NODE_ENV = origEnv;
    });
  });

  // ── _chatWithGrounding() prefetch consumption (#291) ─────────────────────────
  describe('_chatWithGrounding() uses pre-fetched facts (#291)', () => {
    it('uses in-flight prefetch promise instead of calling Phase 1 inline', async () => {
      // Simulate a pre-fetched promise already in the map.
      // Use _buildPrefetchMapKey (always content-based, never null) so the test
      // matches the lookup key used by _chatWithGrounding after Fix 1 (#291).
      const prefetchedFacts = 'Temperature in Berlin is 18°C.';
      const prefetchKey = service._buildPrefetchMapKey('weather Berlin', 'de-DE', service.modelFree);
      service._groundingPrefetchMap.set(prefetchKey, Promise.resolve(prefetchedFacts));

      // Phase 2 mock
      mockGenerateContent.mockResolvedValueOnce(
        makeResponse('{"text":"18°C in Berlin.","intent":"weather","action":"answer","parameters":{},"confidence":0.9}', 'STOP')
      );

      const result = await service._chatWithGrounding(
        [{ role: 'user', content: 'weather Berlin' }],
        'de-DE',
        service.modelFree,
        null
      );

      // Phase 1 Vertex AI was NOT called (prefetch was used)
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // only Phase 2
      const parsed = JSON.parse(result.content);
      expect(parsed.text).toBe('18°C in Berlin.');
    });
  });
});
