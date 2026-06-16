export interface OrchestrateParams {
  userText: string;
  sessionId: string;
  language: string;
  serverEndpoint: string;
  apiVersion: string;
  requestTimeoutMs: number;
  imageBase64?: string | null;
  imageMimeType?: string;
  grounding?: boolean; // #230 — hint to enable Google Search grounding for real-time queries
  mode?: string;       // #269 — stream=true only for personal/business
  onDelta?: (delta: string, accumulated: string) => void; // #269 — called as each SSE chunk arrives
}

export interface OrchestrateResult {
  transcript: string;
  replyText: string;
  intent?: string;
  action?: string | null;
  parameters?: Record<string, unknown>;
  confidence?: number;
  streamMetrics?: {
    transport: 'sse' | 'buffered';
    firstChunkLatencyMs: number | null;
    totalLatencyMs: number;
    chunkCount: number;
    completed: boolean;
    timedOut: boolean;
  };
}

import { getAuth, getIdToken } from '@react-native-firebase/auth';
import EventSource from 'react-native-sse';
import { shouldUseGrounding } from '../utils/grounding';

// Mirrors RequestResponseOrchestration.js — ASR → LLM → TTS pipeline.
// ASR step is skipped here because Voice recognition is handled natively
// by @react-native-community/voice in usePushToTalk. We only call LLM + TTS.
export async function orchestrate(params: OrchestrateParams): Promise<OrchestrateResult> {
  const { userText, sessionId, language, serverEndpoint, apiVersion, requestTimeoutMs, imageBase64, imageMimeType, grounding, mode = 'personal', onDelta } = params;
  const base = `${serverEndpoint}/${apiVersion}`;
  const requestStart = Date.now();
  const resolvedGrounding = grounding ?? shouldUseGrounding(userText);

  // #271 — For stream-eligible modes, always use native SSE transport
  // (react-native-sse) rather than buffered fetch.
  const STREAMING_MODES = ['personal', 'voice', 'business'];
  if (STREAMING_MODES.includes(mode)) {
    return orchestrateStream({
      userText,
      sessionId,
      language,
      serverEndpoint,
      apiVersion,
      requestTimeoutMs,
      imageBase64,
      imageMimeType,
      grounding: resolvedGrounding,
      mode,
      onDelta: onDelta ?? (() => {}),
    });
  }

  const body: Record<string, unknown> = { text: userText, sessionId, language, grounding: resolvedGrounding };
  if (imageBase64) {
    body.imageBase64 = imageBase64;
    body.imageMimeType = imageMimeType ?? 'image/jpeg';
  }

  // Attach Firebase auth token so the server can identify the user and read
  // the isPremium custom claim. Without this, optionalAuthMiddleware sets
  // req.user = null and isPremium always defaults to false.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const user = getAuth().currentUser;
    if (user) {
      const idToken = await getIdToken(user);
      headers['Authorization'] = `Bearer ${idToken}`;
    }
  } catch { /* proceed without auth — optionalAuthMiddleware handles it */ }

  const llmResult = await fetchWithTimeout(
    `${base}/chat`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    requestTimeoutMs,
  );

  if (!llmResult.ok) throw new Error(`LLM failed: ${llmResult.status}`);
  const llmJson = await llmResult.json() as { response: { text: string; action: string; parameters: Record<string, unknown> }; intent: string; confidence: number };
  const replyText = sanitizeReplyText(llmJson.response?.text ?? '');

  return {
    transcript: userText,
    replyText,
    intent: llmJson.intent,
    action: llmJson.response?.action ?? null,
    parameters: llmJson.response?.parameters ?? {},
    confidence: llmJson.confidence,
    streamMetrics: {
      transport: 'buffered',
      firstChunkLatencyMs: null,
      totalLatencyMs: Date.now() - requestStart,
      chunkCount: 0,
      completed: true,
      timedOut: false,
    },
  };
}

/**
 * #269 — SSE streaming orchestration for personal/business modes.
 *
 * Opens a Server-Sent Events connection to POST /chat/stream, collects
 * delta chunks, and calls onDelta on each so the caller can start TTS
 * sentence-by-sentence without waiting for the full response.
 *
 * Returns the complete assembled replyText plus final meta once [DONE] is received.
 */
async function orchestrateStream(params: Required<Pick<OrchestrateParams, 'userText' | 'sessionId' | 'language' | 'serverEndpoint' | 'apiVersion' | 'requestTimeoutMs' | 'mode' | 'onDelta'>> & Pick<OrchestrateParams, 'imageBase64' | 'imageMimeType' | 'grounding'>): Promise<OrchestrateResult> {
  const { userText, sessionId, language, serverEndpoint, apiVersion, requestTimeoutMs, imageBase64, imageMimeType, grounding, mode, onDelta } = params;
  const url = `${serverEndpoint}/${apiVersion}/chat/stream`;
  const requestStart = Date.now();
  const resolvedGrounding = grounding ?? shouldUseGrounding(userText);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const user = getAuth().currentUser;
    if (user) {
      const idToken = await getIdToken(user);
      headers['Authorization'] = `Bearer ${idToken}`;
    }
  } catch { /* proceed without auth */ }

  const body: Record<string, unknown> = { text: userText, sessionId, language, mode, grounding: resolvedGrounding };
  if (imageBase64) { body.imageBase64 = imageBase64; body.imageMimeType = imageMimeType ?? 'image/jpeg'; }

  return new Promise<OrchestrateResult>((resolve, reject) => {
    let accumulated = '';
    let meta: { intent?: string; action?: string | null; parameters?: Record<string, unknown>; confidence?: number } = {};
    let settled = false;
    let namedEventProtocolSeen = false;
    let firstChunkLatencyMs: number | null = null;
    let chunkCount = 0;

    const withMetrics = (
      result: Omit<OrchestrateResult, 'streamMetrics'>,
      completed: boolean,
      timedOut: boolean,
    ): OrchestrateResult => ({
      ...result,
      streamMetrics: {
        transport: 'sse',
        firstChunkLatencyMs,
        totalLatencyMs: Date.now() - requestStart,
        chunkCount,
        completed,
        timedOut,
      },
    });

    // #294 — Use a mutable timer reference so `grounding_start` can extend it
    // before the first text chunk arrives on slow grounded queries.
    let timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        es.close();
        // Return what we have accumulated so far rather than throwing
        resolve(withMetrics({ transcript: userText, replyText: sanitizeReplyText(accumulated), ...meta }, false, true));
      }
    }, requestTimeoutMs);

    const es = new EventSource(url, {
      headers,
      method: 'POST',
      body: JSON.stringify(body),
    });

    const resolveSuccess = (completed: boolean, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      es.close();
      resolve(withMetrics({ transcript: userText, replyText: sanitizeReplyText(accumulated), intent: meta.intent, action: meta.action ?? null, parameters: meta.parameters ?? {}, confidence: meta.confidence }, completed, timedOut));
    };

    const applyDelta = (delta: string) => {
      const normalizedDelta = normalizeStreamDelta(delta);
      if (!normalizedDelta) return;
      if (firstChunkLatencyMs === null) {
        firstChunkLatencyMs = Date.now() - requestStart;
      }
      chunkCount += 1;
      accumulated += normalizedDelta;
      onDelta(normalizedDelta, accumulated);
    };

    // New protocol (server): named SSE events.
    // Keep legacy `message` listener below for backward compatibility.

    // #294 — grounding_start: server signals that the grounding pipeline is
    // active and provides the extended timeout hint. Extend the local timer so
    // the client does not time out before the structured answer is generated.
    es.addEventListener('grounding_start', (event: { data: string }) => {
      if (settled) return;
      try {
        const parsed = JSON.parse(event.data) as { timeoutHintMs?: number };
        const hint = typeof parsed.timeoutHintMs === 'number' ? parsed.timeoutHintMs : 25000;
        const elapsed = Date.now() - requestStart;
        const remaining = Math.max(hint - elapsed, 5000); // at least 5 s left
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            es.close();
            resolve(withMetrics({ transcript: userText, replyText: sanitizeReplyText(accumulated), ...meta }, false, true));
          }
        }, remaining);
      } catch { /* ignore malformed grounding_start */ }
    });

    es.addEventListener('text', (event: { data: string }) => {
      namedEventProtocolSeen = true;
      try {
        const parsed = JSON.parse(event.data) as { delta?: string };
        if (typeof parsed.delta === 'string') {
          applyDelta(parsed.delta);
        }
      } catch { /* malformed chunk — skip */ }
    });

    es.addEventListener('meta', (event: { data: string }) => {
      namedEventProtocolSeen = true;
      try {
        const parsed = JSON.parse(event.data) as { intent?: string; action?: string | null; parameters?: Record<string, unknown>; confidence?: number };
        meta = {
          intent: parsed.intent,
          action: parsed.action ?? null,
          parameters: parsed.parameters ?? {},
          confidence: parsed.confidence,
        };
      } catch { /* malformed meta — keep current meta */ }
      resolveSuccess(true, false);
    });

    es.addEventListener('message', (event: { data: string }) => {
      // If named events are present, ignore duplicate legacy data frames.
      if (namedEventProtocolSeen) {
        if (event.data === '[DONE]') {
          resolveSuccess(true, false);
        }
        return;
      }

      if (!event.data || event.data === '[DONE]') {
        resolveSuccess(true, false);
        return;
      }
      try {
        const parsed = JSON.parse(event.data) as { delta: string; done: boolean; meta?: { intent?: string; action?: string | null; parameters?: Record<string, unknown>; confidence?: number }; error?: { code: string; message: string } };

        if (parsed.error) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            es.close();
            reject(new Error(parsed.error.message));
          }
          return;
        }

        if (!parsed.done && parsed.delta) {
          applyDelta(parsed.delta);
        }

        if (parsed.done) {
          if (parsed.meta) meta = parsed.meta;
          resolveSuccess(true, false);
        }
      } catch { /* malformed chunk — skip */ }
    });

    es.addEventListener('error', (err: unknown) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        es.close();
        // If we already have text, resolve gracefully instead of rejecting
        if (accumulated) {
          resolve(withMetrics({ transcript: userText, replyText: sanitizeReplyText(accumulated), ...meta }, false, false));
        } else {
          reject(new Error('SSE stream error'));
        }
      }
    });
  });
}

/**
 * The server occasionally returns response.text as a markdown code-fenced JSON
 * block (e.g. ```json\n{"intent":...}\n```) instead of a plain spoken sentence.
 * Strip the fence and, if the content parses as JSON, extract the first
 * readable text field from it.
 */
function sanitizeReplyText(raw: string): string {
  // Strip markdown code fences: ```[lang]\n...\n```
  const fenceMatch = raw.match(/^```[a-z]*\n?([\s\S]*?)```\s*$/m);
  const inner = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  // Extract the first balanced JSON object by brace counting.
  // This is more reliable than a greedy regex when the LLM appends extra
  // text or emits multiple top-level objects (greedy /\{[\s\S]*\}/ would
  // span them all, causing JSON.parse to fail).
  const jsonStr = extractFirstJson(inner);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      // Try common field names that hold spoken text
      const candidate =
        parsed?.response?.text ??
        parsed?.text ??
        parsed?.message ??
        parsed?.reply ??
        parsed?.content ??
        null;
      if (typeof candidate === 'string' && candidate.trim()) {
        return stripStructuredArtifacts(candidate);
      }
      // JSON parsed but no usable text field — return empty so caller can handle
      return '';
    } catch {
      // Not valid JSON despite balanced braces — continue with heuristic extraction
    }
  }

  const heuristicText = extractStructuredTextHeuristic(inner);
  if (heuristicText) {
    return stripStructuredArtifacts(heuristicText);
  }

  return stripStructuredArtifacts(inner || raw.trim());
}

/**
 * Defensive streaming sanitizer for JSON-shaped delta chunks.
 * If a full JSON object arrives in a single chunk, extract only the spoken text.
 */
function normalizeStreamDelta(delta: string): string {
  if (!delta) return '';
  const trimmed = delta.trim();
  if (!trimmed) return '';

  const startsWithFence = trimmed.startsWith('```');
  const startsWithObject = trimmed.startsWith('{');

  // Drop punctuation-only artifact chunks that often appear after structured output.
  if (/^[,}\]"'`]+$/.test(trimmed)) {
    return '';
  }

  const looksStructured =
    /(intent|action|parameters)\s*:/i.test(trimmed) ||
    /["'](intent|action|parameters|text)["']\s*:/i.test(trimmed) ||
    (/\btext\b\s*:/i.test(trimmed) && /[{}]/.test(trimmed));

  if (!startsWithObject && !startsWithFence && !looksStructured) {
    return stripStructuredArtifacts(delta);
  }

  const extracted = sanitizeReplyText(delta);
  if (!extracted) return looksStructured ? '' : delta;

  // If extraction didn't find a usable text field and this appears to be
  // structured payload, drop it to avoid speaking intent/action JSON aloud.
  if (extracted === trimmed) {
    return (looksStructured || startsWithFence || startsWithObject) ? '' : delta;
  }

  return stripStructuredArtifacts(extracted);
}

/**
 * Best-effort extraction of a `text` field from relaxed JSON-like content.
 * Handles cases like: {intent:"...", action:"...", text:"..."}
 * where keys or quotes may be malformed for strict JSON.parse.
 */
function extractStructuredTextHeuristic(input: string): string | null {
  if (!input) return null;

  const patterns = [
    /["']text["']\s*:\s*["']([^"']+)["']/i,
    /\btext\b\s*:\s*["']([^"']+)["']/i,
    /\btext\b\s*:\s*([^,}\n]+)(?:,|}|$)/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (!match) continue;
    const candidate = (match[1] || '').trim().replace(/^["']|["']$/g, '');
    if (candidate) return candidate;
  }

  return null;
}

/**
 * Removes trailing punctuation artifacts from structured streaming payloads,
 * for example dangling `}` or `,` after otherwise valid spoken text.
 */
function stripStructuredArtifacts(input: string): string {
  if (!input) return '';

  let out = input;
  out = out.replace(/^[\s,}\]`]+/, '');
  out = out.replace(/[\s,}\]`]+$/, '');
  out = out.trim();

  if (out === '```') return '';
  if (/^[,}\]"'`]+$/.test(out)) return '';
  return out;
}

/**
 * Extract the first syntactically balanced JSON object from `text` by
 * counting braces. More robust than a greedy regex when the LLM outputs
 * trailing text containing additional `}` characters.
 */
function extractFirstJson(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
