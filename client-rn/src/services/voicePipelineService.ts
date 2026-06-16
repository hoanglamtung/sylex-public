/**
 * voicePipelineService — #154
 *
 * Handles the hands-free voice pipeline:
 *   on-device STT → POST /v1/voice/text → on-device TTS
 *
 * Premium users send the STT transcript to /v1/voice/text (server chat only);
 * TTS and STT are handled on-device. Free users use the legacy 3-call chain
 * (on-device STT → /v1/chat → on-device TTS).
 */

import { Platform } from 'react-native';
import AudioRecorderPlayer, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
  AVEncoderAudioQualityIOSType,
  AVEncodingOption,
} from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { shouldUseGrounding } from '../utils/grounding';

const SERVER_ENDPOINT = 'https://api.car-assistant-pro.silverleaf.studio';
const API_VERSION = 'v1';
const PIPELINE_TIMEOUT_MS = 30_000;

// Separate instances for recording and playback to avoid conflicts
const recorder = new AudioRecorderPlayer();
const player = new AudioRecorderPlayer();

// Tracks whether the player is currently active so usePushToTalk can detect the
// player→recorder AVAudioSession race on iOS (#118).
let playerPlaying = false;
export function isPlayerPlaying(): boolean { return playerPlaying; }

// Tracks whether the wake-word Voice session is currently active.
// When the user manually presses PTT while wake-word is listening, React's
// cleanup fires Voice.destroy() during waitForTtsRelease() — but only ~16ms into
// the wait. We need the full 400ms settle window from that destroy call, so PTT
// checks this flag and extends its wait when Voice is active (#154).
let wakeWordListening = false;
export function setWakeWordListening(active: boolean): void { wakeWordListening = active; }
export function isWakeWordListening(): boolean { return wakeWordListening; }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoicePipelineResult {
  transcript: string;
  response: string;
  audio: string | null; // base64 MP3; null when skipTts=true (#220)
  audioMimeType: string;
  sessionId: string;
  language: string;
  mode: string;
}

// ─── File paths ───────────────────────────────────────────────────────────────

function getCachePath(filename: string): string {
  return `${RNFS.CachesDirectoryPath}/${filename}`;
}

// iOS     → WAV (LINEAR16) — Google STT native, all versions.
// Android → AMR-WB        — Google STT native, available from API 1 (covers minSdk 24).
//           OGG/OPUS would be higher quality but requires API 29 — not safe for minSdk 24.
const RECORDING_EXT  = Platform.OS === 'ios' ? '.wav' : '.amr';
const RECORDING_MIME = Platform.OS === 'ios' ? 'audio/wav' : 'audio/amr-wb';
const RECORDING_PATH = () => getCachePath(`assistant_recording${RECORDING_EXT}`);
const TTS_AUDIO_PATH = () => getCachePath('assistant_tts_response.mp3');

// ─── Silence detection ────────────────────────────────────────────────────────
// Used by the wake-word flow to auto-stop recording after the user stops speaking.
// Metering level below SILENCE_THRESHOLD_DB for SILENCE_DURATION_MS → fire callback.
const SILENCE_THRESHOLD_DB = -45;  // dB; typical speech is -20…-5, silence < -50
const SILENCE_DURATION_MS  = 1_500; // 1.5 s of continuous silence → auto-stop
const SPEECH_GRACE_MS      = 800;   // ignore silence for first 800ms (mic warmup)

let silenceCallback: (() => void) | null = null;
let silenceStart = 0;
let recordingStart = 0;

/** Register a callback fired when silence is detected during recording. */
export function onSilenceDetected(cb: (() => void) | null): void {
  silenceCallback = cb;
}

// ─── Recording ────────────────────────────────────────────────────────────────

export async function startRecording(): Promise<void> {
  const path = RECORDING_PATH();
  try { await RNFS.unlink(path); } catch { /* no previous file */ }

  // Stale recorder cleanup is now handled natively at the start of
  // startRecorder() — calling stopRecorder() from JS would invoke
  // setActive(false, .notifyOthersOnDeactivation) which races the
  // subsequent setActive(true) on iOS (#154).
  recorder.removeRecordBackListener();

  silenceStart = 0;
  recordingStart = Date.now();

  // Monitor metering for silence detection (wake-word auto-stop).
  recorder.addRecordBackListener((e) => {
    if (!silenceCallback) return;
    const elapsed = Date.now() - recordingStart;
    if (elapsed < SPEECH_GRACE_MS) return; // ignore mic warmup
    const level = (e as any).currentMetering ?? -160;
    if (level < SILENCE_THRESHOLD_DB) {
      if (silenceStart === 0) silenceStart = Date.now();
      else if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
        const cb = silenceCallback;
        silenceCallback = null; // fire only once
        silenceStart = 0;
        cb();
      }
    } else {
      silenceStart = 0; // speech detected, reset
    }
  });

  // RNAudioRecorderPlayer.swift's setAudioFileURL() treats a plain absolute path
  // as a relative component and appends it to the Caches directory, producing a
  // deeply-nested wrong path → CreateDataFile failed. Pass file:// so it takes
  // the URL(string:) branch instead.
  const recorderPath = Platform.OS === 'ios' ? `file://${path}` : path;
  await recorder.startRecorder(recorderPath, {
    // Android: AMR-WB — wideband speech codec, 16 kHz, supported on all API levels
    AudioEncoderAndroid: AudioEncoderAndroidType.AMR_WB,
    OutputFormatAndroid: OutputFormatAndroidType.AMR_WB,
    AudioSourceAndroid: AudioSourceAndroidType.MIC,
    AudioSamplingRateAndroid: 16000,
    AudioChannelsAndroid: 1,
    // iOS: WAV (LINEAR16) — Google STT native
    AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
    AVFormatIDKeyIOS: AVEncodingOption.wav,
    AVNumberOfChannelsKeyIOS: 1,
    AVSampleRateKeyIOS: 16000,
  }, true); // meteringEnabled = true for silence detection
}

export async function stopRecording(): Promise<string> {
  silenceCallback = null;
  silenceStart = 0;
  const path = await recorder.stopRecorder();
  recorder.removeRecordBackListener();
  return path;
}

export async function cancelRecording(): Promise<void> {
  silenceCallback = null;
  silenceStart = 0;
  try { await recorder.stopRecorder(); } catch { /* ignore */ }
  recorder.removeRecordBackListener();
  try { await RNFS.unlink(RECORDING_PATH()); } catch { /* ignore */ }
}

// ─── Text pipeline (#215) ─────────────────────────────────────────────────────
// When on-device STT produced a transcript, send it directly as JSON to
// POST /v1/voice/text — skipping audio upload + server ASR (~400–900ms saved).

export async function sendTextToPipeline(params: {
  text: string;
  sessionId: string;
  mode: string;
  language: string;
  parentUid?: string;
  grounding?: boolean; // #230 — hint to server to enable Google Search grounding for real-time queries
}): Promise<VoicePipelineResult> {
  const { text, sessionId, mode, language, parentUid, grounding } = params;
  const resolvedGrounding = grounding ?? shouldUseGrounding(text);

  const user = getAuth().currentUser;
  if (!user) throw new Error('NOT_AUTHENTICATED');
  const idToken = await getIdToken(user);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

  const url = `${SERVER_ENDPOINT}/${API_VERSION}/voice/text`;
  console.log('[VoicePipeline/text] POST', url, 'textLength:', text.length, 'mode:', mode, 'lang:', language);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        sessionId,
        mode,
        language,
        skipTts: true, // on-device TTS is primary (#220) — skip server synthesis
        grounding: resolvedGrounding,
        ...(parentUid ? { parentUid } : {}),
      }),
      signal: controller.signal,
    });

    console.log('[VoicePipeline/text] response status:', res.status);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = body?.error?.code ?? `HTTP_${res.status}`;
      console.error('[VoicePipeline/text] server error:', code, body);
      throw new Error(code);
    }

    const json = await res.json();
    console.log('[VoicePipeline/text] success — response:', json.response?.length, 'audio:', json.audio?.length);
    return json;
  } catch (err) {
    console.error('[VoicePipeline/text] fetch error:', err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Audio playback ───────────────────────────────────────────────────────────

export async function playResponseAudio(
  audioBase64: string,
  onFinished: () => void,
): Promise<void> {
  const path = TTS_AUDIO_PATH();
  await RNFS.writeFile(path, audioBase64, 'base64');

  const uri = `file://${path}`;

  playerPlaying = true;
  player.addPlayBackListener((e) => {
    if (e.currentPosition >= e.duration && e.duration > 0) {
      playerPlaying = false;
      void stopPlayback();
      onFinished();
    }
  });

  await player.startPlayer(uri);
}

export async function stopPlayback(): Promise<void> {
  playerPlaying = false;
  try { await player.stopPlayer(); } catch { /* ignore */ }
  player.removePlayBackListener();
}
