const SERVER_ENDPOINT =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  'https://api.car-assistant-pro.silverleaf.studio';
const API_VERSION = 'v1';

export interface PipelineResult {
  replyText: string;
}

export async function runPipeline(
  userText: string,
  sessionId: string,
  language: string,
  timeoutMs: number,
): Promise<PipelineResult> {
  const normalizedEndpoint = SERVER_ENDPOINT.endsWith('/')
    ? SERVER_ENDPOINT.slice(0, -1)
    : SERVER_ENDPOINT;
  const base = `${normalizedEndpoint}/${API_VERSION}`;

  const chat = await fetchWithTimeout(
    `${base}/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: userText,
        // Server expects sessionId; keep legacy key for compatibility.
        sessionId,
        session_id: sessionId,
        language,
      }),
    },
    timeoutMs,
  );

  if (!chat.ok) {
    throw new Error(`LLM failed: ${chat.status}`);
  }

  const chatData = await chat.json() as {
    reply?: string;
    response?: { text?: string };
  };

  const replyText = chatData.reply ?? chatData.response?.text ?? '';
  if (!replyText) {
    throw new Error('LLM failed: invalid response payload');
  }

  // Web uses browser SpeechSynthesis for TTS playback, not server audio.
  // Skip TTS API call to improve efficiency (web platform difference from native).

  return { replyText };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
