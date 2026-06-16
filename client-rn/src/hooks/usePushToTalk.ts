import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform, PermissionsAndroid, Linking } from 'react-native';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import Tts from 'react-native-tts';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { useVoiceStateMachine, VoiceState } from './useVoiceStateMachine';
import { checkAndIncrementDaily, canMakeRequest } from '../services/usageService';
import { orchestrate } from '../services/orchestrationService';
import { appendConversationEntry } from '../services/syncService';
import {
  startRecording as pipelineStartRecording,
  stopRecording as pipelineStopRecording,
  cancelRecording as pipelineCancelRecording,
  sendTextToPipeline,
  playResponseAudio,
  stopPlayback,
  setWakeWordListening,
  isWakeWordListening,
  onSilenceDetected,
} from '../services/voicePipelineService';
import { createGroundingPreambleController } from '../services/groundingPreamble';
import i18n from '../i18n';
import { shouldUseGrounding } from '../utils/grounding';

// #226 — Session-based voice mode: stop phrases end the active session.
// Checked against the STT transcript before sending to the server.
const SESSION_STOP_PHRASES = /\b(stop|cancel|stop listening|that'?s all|thanks|thank you|bye|goodbye|end session|stop session)\b/i;

// Silence timeout after TTS finishes: if the user speaks nothing in this
// window the session auto-closes and wake-word detection resumes.
const SESSION_SILENCE_TIMEOUT_MS = 8_000;

// iOS: Calling Tts.stop() on an idle TTS triggers an async native cleanup that
// eventually calls AVAudioSession setActive:false. If Voice.start() is called
// while this cleanup is in flight, AVAudioEngine.start() receives the deferred
// setActive:false and fails with '!pri' (kAudioSessionNotActiveError). Fix:
// only call Tts.stop() when TTS is *actively speaking* (caller passes wasSpeaking).
// When TTS is already idle we skip Tts.stop() entirely to avoid triggering the
// race, and just wait a short interval for any residual audio-server activity.
function waitForTtsRelease(wasSpeaking: boolean): Promise<void> {
  if (wasSpeaking) {
    try { Tts.stop(); } catch { /* ignore */ }
    if (Platform.OS !== 'ios') return Promise.resolve();
    // Wait for the native TTS engine to confirm it has stopped (tts-cancel fires
    // after Tts.stop() completes), then add an 80 ms buffer for CoreAudio to
    // deactivate AVAudioSession before we open the mic. This replaces the old
    // fixed 350 ms guess and eliminates the IPCAUClient/-66748 race (#225).
    // A 600 ms fallback guards against the event not firing (e.g. TTS already
    // ended naturally before stop() was called).
    return new Promise<void>(resolve => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        sub.remove();
        clearTimeout(fallback);
        setTimeout(resolve, 80);
      };
      const sub = Tts.addEventListener('tts-cancel', settle);
      const fallback = setTimeout(settle, 600);
    });
  }
  // TTS was already idle — no settle needed, avoid artificial delay.
  return Promise.resolve();
}

const SERVER_ENDPOINT = 'https://api.car-assistant-pro.silverleaf.studio';
const API_VERSION = 'v1';
const REQUEST_TIMEOUT_MS = 15_000;
// #294 — Grounded queries (web search + structured answer) take up to ~20 s.
// This extended timeout is used when isRealtime=true so the server completes
// before the client gives up. The server also emits `event: grounding_start`
// early in the stream so the client can dynamically confirm the extension.
const GROUNDED_REQUEST_TIMEOUT_MS = 25_000;
const PIPELINE_TIMEOUT_MS = 30_000;
const RECORDING_TIMEOUT_S = 30; // safety net — silence metering / native VAD are primary stops (#223 #224)

export interface PushToTalkOptions {
  mode?: string;
  isPremium?: boolean;
  uid?: string | null;
  imageBase64?: string | null;
  imageMimeType?: string;
  /** Called when the LLM returns intent=start_routine. Navigate to RoutineExecution. */
  onRoutineIntent?: (routineId: string, category: string) => void;
}

export interface PushToTalkState {
  voiceState: VoiceState;
  statusMessage: string;
  transcript: string;
  replyText: string;
  isRecording: boolean;
  errorMessage: string | null;
  /** true while a wake-word-triggered continuous voice session is active (#226). */
  isInSession: boolean;
  onTap: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  cancel: () => void;
  stopVoiceInteraction: () => void;
  /** Enter session mode on wake-word detection — call before onTap(). */
  startVoiceSession: () => void;
  /** Explicitly end the active session and return to idle/wake-word. */
  endVoiceSession: () => Promise<void>;
}

export function usePushToTalk(options: PushToTalkOptions = {}): PushToTalkState {
  const { mode = 'standard', isPremium = false, uid = null, imageBase64 = null, imageMimeType, onRoutineIntent } = options;
  // Premium users get the single-call /v1/voice/text pipeline (on-device STT → server chat → on-device TTS).
  // Free users stay on the legacy 3-call chain (on-device STT → /v1/chat → on-device TTS).
  // Android is excluded from hands-free: simultaneous Voice.start() + AudioRecorderPlayer
  // causes mic conflicts (#219). Android premium users use the legacy pipeline, which works correctly.
  // premiumRejectedRef: if /v1/voice/text returns 403 (e.g. DEV override but no server claim),
  // silently fall back to the free pipeline for the rest of the session.
  const premiumRejectedRef = useRef(false);
  const useHandsFree = isPremium && !premiumRejectedRef.current && Platform.OS === 'ios';
  const { state: voiceState, setState } = useVoiceStateMachine();
  const [statusMessage, setStatusMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionIdRef = useRef(generateSessionId());
  const requestIdRef = useRef<string | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  // ttsActiveRef: true while on-device TTS is actively speaking.
  // Used by waitForTtsRelease() to decide whether to call Tts.stop() and how
  // long to wait — avoids a spurious setActive:false race on an idle TTS.
  const ttsActiveRef = useRef(false);
  // Safety timeout: if iOS Core Audio crashes (IPCAUClient -66748) neither
  // tts-finish nor tts-error fires, leaving the session permanently frozen.
  // This timer recovers after 12 s (#268-tts-crash).
  const ttsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // iOS audio-session settle: a 600ms timer started concurrently with the API
  // call immediately after Voice.destroy(). Awaited before Tts.speak() so the
  // AVAudioEngine IPC teardown in mediaserverd is complete before TTS opens the
  // audio session. Running it alongside the API call means zero extra latency
  // when the server is slow; it only blocks Tts.speak() when the API responds
  // faster than 600ms (e.g. trivial math queries) (#267-tts-crash).
  const iosDestroySettleRef = useRef<Promise<void> | null>(null);
  // isPressedRef: true while user holds the PTT button.
  // lastTranscriptRef: accumulates the latest STT result during recording.
  // Pipeline only fires on button release so we always send the complete utterance.
  const isPressedRef = useRef(false);

  // ── Session-based voice mode (#226) ─────────────────────────────────────
  // sessionActiveRef: synchronous gate checked in async TTS callbacks.
  // isInSession: React state that drives HomeScreen UI.
  // sessionSilenceTimerRef: auto-ends session if user goes silent after TTS.
  const [isInSession, setIsInSession] = useState(false);
  const sessionActiveRef = useRef(false);
  const sessionSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // onPressInRef: stable ref to onPressIn so TTS callbacks (async closures
  // that outlive their render) always invoke the latest version.
  const onPressInRef = useRef<(() => Promise<void>) | null>(null);
  const lastTranscriptRef = useRef('');
  // voiceReadyRef: true only after PTT's own Voice.start() succeeds.
  // Guards onSpeechPartialResults and onSpeechError against stray events from
  // the wake-word Voice.destroy() that arrive before the PTT session starts.
  const voiceReadyRef = useRef(false);
  // pipelineFiredRef: prevents double dispatch when iOS auto-stops recognition
  // while the button is still held — onSpeechEnd and onPressOut would otherwise
  // both call runPipeline, causing the first response to be discarded and the
  // user to wait through a second full round-trip.
  const pipelineFiredRef = useRef(false);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = (key: string) => i18n.t(key);

  // Reset session immediately when the user changes the language in Settings.
  // This ensures the server starts a fresh context in the new language rather
  // than inheriting conversation history from the previous language session.
  useEffect(() => {
    const onLanguageChanged = (lng: string) => {
      console.log('[PTT] languageChanged ->', lng, '— resetting session');
      sessionIdRef.current = generateSessionId();
    };
    i18n.on('languageChanged', onLanguageChanged);
    return () => { i18n.off('languageChanged', onLanguageChanged); };
  }, []);

  const clearTimers = useCallback(() => {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    if (pipelineTimerRef.current) clearTimeout(pipelineTimerRef.current);
    recordingTimerRef.current = null;
    pipelineTimerRef.current = null;
  }, []);

  const showError = useCallback((key: string) => {
    clearTimers(); // prevent the 10 s recording timer from firing a second error
    setState('error');
    setErrorMessage(t(key));
    setStatusMessage(t(key));
    setIsRecording(false);
  }, [clearTimers, setState, t]);

  const onPressIn = useCallback(async () => {
    cancelledRef.current = false;
    isPressedRef.current = true;
    lastTranscriptRef.current = '';
    pipelineFiredRef.current = false;
    voiceReadyRef.current = false;
    setErrorMessage(null);
    setTranscript('');
    setReplyText('');

    // Clear any pending session-silence timer from the previous turn (#268).
    // Without this, the timer set after the prior TTS-finish fires 8 s later
    // — right in the middle of the next API call — killing the session and
    // discarding the response before it can be spoken.
    if (sessionSilenceTimerRef.current) {
      clearTimeout(sessionSilenceTimerRef.current);
      sessionSilenceTimerRef.current = null;
    }

    // ── Stop wake-word FIRST, synchronously, before ANY async work ──
    // This prevents useWakeWord's restart() from re-opening the mic while
    // we're trying to hand off to the recorder (#154, #208, #209).
    const wasWakeWordActive = isWakeWordListening();
    setWakeWordListening(false);

    if (!canMakeRequest()) {
      showError('error_daily_limit');
      return;
    }

    // Stop any ongoing hands-free playback immediately.
    try { await stopPlayback(); } catch { /* ignore */ }

    // Give immediate visual feedback so the user knows the button registered.
    setState('listening');
    setStatusMessage(t('state_listening'));

    // iOS: if TTS is actively speaking stop it and wait 500 ms for the full
    // AVAudioSession deactivation + audio-server settle. If TTS was already
    // idle, skip Tts.stop() (its async cleanup would race Voice) and just wait
    // 100 ms. ttsActiveRef is updated by the TTS event listeners in runPipeline.
    await waitForTtsRelease(ttsActiveRef.current);

    // Android requires explicit runtime permission for RECORD_AUDIO.
    if (Platform.OS === 'android') {
      const alreadyGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (!alreadyGranted) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'Assistant Pro needs microphone access for voice commands.',
            buttonPositive: 'Allow',
          },
        );
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          void Linking.openSettings();
          showError('mic_permission_denied');
          return;
        }
      }
    }

    if (cancelledRef.current) return;

    // ── Tear down wake-word Voice session before opening recorder ──
    // Voice's AVAudioEngine holds an exclusive input tap on the mic.
    // AVAudioRecorder.record() returns false while that tap exists.
    // We must: destroy Voice → wait for engine release → then record.
    if (wasWakeWordActive && Platform.OS === 'ios') {
      try { await Voice.destroy(); } catch { /* ignore */ }
      // Voice.m's teardown() stops the engine synchronously in ObjC, but
      // the JS promise resolves before the audio-server fully releases the
      // hardware. 300 ms settle is sufficient (#216).
      await new Promise<void>(r => setTimeout(r, 300));
    } else if (wasWakeWordActive) {
      try { await Voice.destroy(); } catch { /* ignore */ }
    }

    if (cancelledRef.current) return;

    if (useHandsFree) {
      // ── Hands-free pipeline: record raw audio for on-device STT → /v1/voice/text ──
      // Start on-device STT in parallel for live transcript display.
      // Voice.start() MUST come before the recorder because its internal
      // teardown briefly deactivates the audio session (setActive:NO).
      // The recorder then starts on the already-active session.
      try {
        // Always await Voice.destroy() before registering new listeners (#268).
        // The silence-metering path calls Voice.destroy() fire-and-forget after
        // Voice.stop(); if runHandsFreePipeline immediately restarts (e.g. empty
        // transcript → retry turn), that stale destroy() completes AFTER we set
        // the new handlers, nulling them out → "no listeners registered" and an
        // empty transcript on every subsequent turn.
        await Voice.destroy();
        Voice.onSpeechResults = (e: SpeechResultsEvent) => {
          if (cancelledRef.current) return;
          const text = e.value?.[0] ?? '';
          if (text) {
            lastTranscriptRef.current = text;
            setTranscript(text);
          }
        };
        Voice.onSpeechEnd = () => {
          // Native VAD — fires after a brief pause in speech.
          // DO NOT stop recording here! Native VAD is too aggressive and
          // fires during mid-sentence pauses (e.g. "Wetter in… München"),
          // truncating the audio sent to server ASR.
          // Let the metering-based silence detection (1.5 s @ -45 dB)
          // handle recording stop — it's more reliable for natural speech.
          console.log('[PTT] Voice.onSpeechEnd — native VAD (ignored, metering handles stop)');
        };
        Voice.onSpeechError = () => { /* ignore — live STT is best-effort */ };
        await Voice.start(i18n.language);
      } catch (err) {
        console.warn('[PTT] Live STT for display failed:', err);
        // Non-fatal: metering-based silence detection still works as fallback
      }

      if (cancelledRef.current) return;

      try {
        await pipelineStartRecording();
      } catch (err) {
        // iOS retry: audio-server may need extra time after Voice teardown.
        if (Platform.OS === 'ios' && wasWakeWordActive) {
          console.warn('[PTT] First recording attempt failed, retrying after 500 ms…', err);
          await new Promise<void>(r => setTimeout(r, 500));
          try {
            await pipelineStartRecording();
          } catch (err2) {
            console.error('[PTT] startRecording retry failed:', err2);
            Voice.stop().catch(() => {});
            showError('speech_recognition_error');
            return;
          }
        } else {
          console.error('[PTT] startRecording failed:', err);
          Voice.stop().catch(() => {});
          showError('speech_recognition_error');
          return;
        }
      }
    } else {
      // ── Legacy flow: on-device STT via @react-native-voice/voice ──
      // waitForTtsRelease() already settled the AVAudioSession. One unified
      // path for iOS and Android — matching the March-31 working pattern.
      try {
        try { await Voice.destroy(); } catch { /* ignore if no prior session */ }
        // Re-register handlers immediately after destroy() — Voice.destroy()
        // nulls out all JS-side event handler properties. The render-body
        // assignments in `if (!useHandsFree)` ran before this async onPressIn
        // resumed, so they are now cleared. Without re-registering here, native
        // VAD (onSpeechEnd) and results (onSpeechResults) never fire → the
        // "Listening" status stays until the 30 s safety timeout (#free-vad-bug).
        Voice.onSpeechEnd = () => {
          if (cancelledRef.current || !isPressedRef.current) return;
          isPressedRef.current = false;
          clearTimers();
          setIsRecording(false);
          setStatusMessage(t('recording_end'));
          if (!pipelineFiredRef.current) {
            pipelineFiredRef.current = true;
            void (async () => {
              if (Platform.OS === 'android') {
                await new Promise<void>(r => setTimeout(r, 800));
              }
              const text = lastTranscriptRef.current;
              if (!text) return;
              const isRealtime = shouldUseGrounding(text);
              setStatusMessage(isRealtime ? t('state_checking_live_data') : t('sending'));
              setState('processing');
              void runPipeline(text, isRealtime);
            })();
          }
        };
        Voice.onSpeechResults = (e: SpeechResultsEvent) => {
          if (cancelledRef.current) return;
          const text = e.value?.[0] ?? '';
          if (!text) return;
          lastTranscriptRef.current = text;
          setTranscript(text);
          if (!isPressedRef.current && !pipelineFiredRef.current) {
            pipelineFiredRef.current = true;
            const isRealtime = shouldUseGrounding(text);
            setStatusMessage(isRealtime ? t('state_checking_live_data') : t('sending'));
            setState('processing');
            void runPipeline(text, isRealtime);
          }
        };
        Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
          if (Platform.OS !== 'android') return;
          if (cancelledRef.current || !voiceReadyRef.current) return;
          const text = e.value?.[0] ?? '';
          if (!text) return;
          lastTranscriptRef.current = text;
          setTranscript(text);
        };
        Voice.onSpeechError = (_e: SpeechErrorEvent) => {
          if (cancelledRef.current || !voiceReadyRef.current) return;
          if (lastTranscriptRef.current && !pipelineFiredRef.current) {
            pipelineFiredRef.current = true;
            isPressedRef.current = false;
            clearTimers();
            setIsRecording(false);
            const isRealtime = shouldUseGrounding(lastTranscriptRef.current);
            setStatusMessage(isRealtime ? t('state_checking_live_data') : t('sending'));
            setState('processing');
            void runPipeline(lastTranscriptRef.current, isRealtime);
            return;
          }
          showError('error_asr_failed');
        };
        await Voice.start(i18n.language);
        voiceReadyRef.current = true;
      } catch (err) {
        console.error('[PTT] Voice.start failed:', err);
        showError('speech_recognition_error');
        return;
      }
    }

    setIsRecording(true);
    setStatusMessage(t('recording_start'));

    // ── Silence-based auto-stop for hands-free recordings ────────────────
    // Detects when the user stops speaking and auto-sends the recording.
    // Works for both wake-word flow and tap-to-toggle ("Tap to Start").
    // Uses inline logic instead of calling onPressOut() to avoid stale
    // closure over isRecording state.
    if (useHandsFree) {
      onSilenceDetected(async () => {
        // Metering fallback — only fires if native VAD (Voice.onSpeechEnd) didn't trigger first.
        if (pipelineFiredRef.current) return;
        pipelineFiredRef.current = true;
        console.log('[PTT] silence metering — auto-stopping recording');
        onSilenceDetected(null); // prevent double-fire
        if (autoStopTimerRef.current) {
          clearTimeout(autoStopTimerRef.current);
          autoStopTimerRef.current = null;
        }
        if (recordingTimerRef.current) {
          clearTimeout(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        isPressedRef.current = false;
        setIsRecording(false);
        setStatusMessage(t('recording_end'));
        // destroy() (not stop()) so the Voice engine fully releases the mic
        // and audio session. A mere stop() leaves a stale session that
        // prevents useWakeWord's Voice.start('en-US') from working later.
        // Run Voice.destroy + stopRecording in parallel to reduce Processing
        // latency (#215) — they operate on independent subsystems.
        let audioPath: string;
        try {
          // Voice.stop() finalizes recognition and fires onSpeechResults.
          await Voice.stop().catch(() => {});
          // Android uses Google online STT — results arrive after a network
          // round-trip, so wait up to 800ms for onSpeechResults to fire.
          // iOS uses on-device STT — results are already in by the time
          // stop() resolves, so no wait needed.
          console.log('[PTT] silence: after Voice.stop(), transcript=', lastTranscriptRef.current);
          if (!lastTranscriptRef.current && Platform.OS === 'android') {
            await new Promise<void>(r => setTimeout(r, 800));
          }
          console.log('[PTT] silence: final transcript=', lastTranscriptRef.current);
          // Stop recorder and destroy Voice in parallel to reduce handoff latency.
          // We still await both before sending to the API.
          const [path] = await Promise.all([
            pipelineStopRecording(),
            Voice.destroy().catch(() => {}),
          ]);
          audioPath = path;
          // Start concurrent 600ms iOS settle so mediaserverd IPC teardown
          // finishes before Tts.speak() (#267).
          if (Platform.OS === 'ios') {
            const destroyedAt = Date.now();
            console.log('[PTT] [iOS-timing] Voice.destroy() resolved at', destroyedAt);
            iosDestroySettleRef.current = new Promise<void>(r => setTimeout(() => {
              console.log('[PTT] [iOS-timing] 600ms settle done at', Date.now(), '(', Date.now() - destroyedAt, 'ms since destroy)');
              r();
            }, 600));
          }
          if (cancelledRef.current) return;
        } catch {
          showError('speech_recognition_error');
          return;
        }
        setStatusMessage(t('sending'));
        setState('processing');
        void runHandsFreePipeline(audioPath);
      });
    } else {
      // Tap-to-speak: also register silence metering as a secondary auto-stop.
      // Primary stop is Voice.onSpeechEnd (native VAD); this fires if VAD misses
      // the end of speech — avoids relying solely on the 30 s safety timer (#224).
      onSilenceDetected(() => {
        if (pipelineFiredRef.current) return;
        onSilenceDetected(null); // prevent double-fire
        if (autoStopTimerRef.current) {
          clearTimeout(autoStopTimerRef.current);
          autoStopTimerRef.current = null;
        }
        void onPressOut();
      });
    }

    recordingTimerRef.current = setTimeout(() => {
      void stopRecordingAndSend();
      // Hands-free: safety timer is a backstop only — silence metering is the primary
      // stop mechanism. Fire silently so state returns to idle and wake-word resumes (#223).
      if (!useHandsFree) showError('timeout');
    }, RECORDING_TIMEOUT_S * 1000);
  }, [setState, showError, t, useHandsFree]);

  // Keep onPressInRef in sync with the latest onPressIn callback so async
  // TTS event handlers in runHandsFreePipeline (stale closures) can always
  // call the most up-to-date version for the session restart loop (#226).
  onPressInRef.current = onPressIn;

  // ── Tap-to-toggle: single tap starts, second tap (or auto-stop) ends ──
  const onTap = useCallback(() => {
    if (isRecording) {
      // Second tap → stop and send
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
      void onPressOut();
    } else if (voiceState === 'idle' || voiceState === 'error') {
      // First tap → start recording with auto-stop
      void onPressIn();
      autoStopTimerRef.current = setTimeout(() => {
        autoStopTimerRef.current = null;
        void onPressOut();
      }, RECORDING_TIMEOUT_S * 1000);
    }
  }, [isRecording, voiceState, onPressIn, onPressOut]);

  const stopRecordingAndSend = useCallback(async () => {
    clearTimers();
    if (useHandsFree) {
      try { await Voice.stop(); } catch { /* ignore */ }
      try { await pipelineStopRecording(); } catch { /* ignore */ }
    } else {
      try { await Voice.stop(); } catch { /* ignore */ }
    }
    setIsRecording(false);
  }, [clearTimers, useHandsFree]);

  const onPressOut = useCallback(async () => {
    if (!isRecording) return;
    isPressedRef.current = false;
    clearTimers();
    setIsRecording(false);
    setStatusMessage(t('recording_end'));

    if (useHandsFree) {
      // ── Hands-free: stop recording and send transcript to /v1/voice/text ──
      onSilenceDetected(null); // cancel auto-stop callbacks
      pipelineFiredRef.current = true;
      let audioPath: string;
      try {
        // Voice.stop() finalizes recognition and fires onSpeechResults.
        await Voice.stop().catch(() => {});
        // Android uses Google online STT — results arrive after a network
        // round-trip, so wait up to 800ms for onSpeechResults to fire.
        // iOS uses on-device STT — results are already in by the time
        // stop() resolves, so no wait needed.
        console.log('[PTT] pressOut: after Voice.stop(), transcript=', lastTranscriptRef.current);
        if (!lastTranscriptRef.current && Platform.OS === 'android') {
          await new Promise<void>(r => setTimeout(r, 800));
        }
        console.log('[PTT] pressOut: final transcript=', lastTranscriptRef.current);
        // Stop recorder and destroy Voice in parallel to reduce handoff latency.
        // We still await both before sending to the API.
        const [path] = await Promise.all([
          pipelineStopRecording(),
          Voice.destroy().catch(() => {}),
        ]);
        audioPath = path;
        // Start concurrent 600ms iOS settle (same as silence path).
        if (Platform.OS === 'ios') {
          const destroyedAt = Date.now();
          console.log('[PTT] [iOS-timing] Voice.destroy() resolved at', destroyedAt, '(pressOut path)');
          iosDestroySettleRef.current = new Promise<void>(r => setTimeout(() => {
            console.log('[PTT] [iOS-timing] 600ms settle done at', Date.now(), '(', Date.now() - destroyedAt, 'ms since destroy)');
            r();
          }, 600));
        }
        if (cancelledRef.current) return;
      } catch {
        showError('speech_recognition_error');
        return;
      }
      setStatusMessage(t('sending'));
      setState('processing');
      void runHandsFreePipeline(audioPath);
    } else {
      // ── Legacy: stop STT and wait for onSpeechResults ──
      try { await Voice.stop(); } catch { /* ignore */ }
      if (lastTranscriptRef.current && !pipelineFiredRef.current) {
        pipelineFiredRef.current = true;
        const text = lastTranscriptRef.current;
        const isRealtime = shouldUseGrounding(text);
        setStatusMessage(isRealtime ? t('state_checking_live_data') : t('sending'));
        setState('processing');
        void runPipeline(text, isRealtime);
      }
    }
  }, [isRecording, clearTimers, setState, t, useHandsFree]);

  // ── Session lifecycle (#226) ────────────────────────────────────────────

  /** Called by HomeScreen on wake-word detection before onTap(). */
  const startVoiceSession = useCallback(() => {
    sessionActiveRef.current = true;
    setIsInSession(true);
    // Fresh session ID so multi-turn conversation history is scoped to this
    // wake-word activation — not blended with a prior session.
    sessionIdRef.current = generateSessionId();
    console.log('[PTT] voice session started, sessionId=', sessionIdRef.current);
  }, []);

  /** End the active session and return to idle / wake-word mode. */
  const endVoiceSession = useCallback(async () => {
    console.log('[PTT] voice session ending');
    sessionActiveRef.current = false;
    setIsInSession(false);
    if (sessionSilenceTimerRef.current) {
      clearTimeout(sessionSilenceTimerRef.current);
      sessionSilenceTimerRef.current = null;
    }
    cancelledRef.current = true;
    ttsActiveRef.current = false;
    requestIdRef.current = null;
    // Cut speech immediately before other async cleanup.
    try { Tts.stop(); } catch { /* ignore */ }
    clearTimers();
    if (useHandsFree) {
      onSilenceDetected(null);
      pipelineFiredRef.current = true;
      try { await Voice.stop(); } catch { /* ignore */ }
      try { await pipelineCancelRecording(); } catch { /* ignore */ }
      try { await stopPlayback(); } catch { /* ignore */ }
    } else {
      try { await Voice.cancel(); } catch { /* ignore */ }
    }
    setIsRecording(false);
    setState('idle');
    setStatusMessage('');
    console.log('[PTT] voice session ended → idle');
  }, [clearTimers, setState, useHandsFree]);

  const cancel = useCallback(async () => {
    // End any active session when the user explicitly cancels.
    if (sessionActiveRef.current) {
      sessionActiveRef.current = false;
      setIsInSession(false);
      if (sessionSilenceTimerRef.current) {
        clearTimeout(sessionSilenceTimerRef.current);
        sessionSilenceTimerRef.current = null;
      }
    }
    cancelledRef.current = true;
    ttsActiveRef.current = false;
    requestIdRef.current = null;
    // Cut speech immediately before other async cleanup.
    try { Tts.stop(); } catch { /* ignore */ }
    clearTimers();
    if (useHandsFree) {
      onSilenceDetected(null);
      pipelineFiredRef.current = true;
      try { await Voice.stop(); } catch { /* ignore */ }
      try { await pipelineCancelRecording(); } catch { /* ignore */ }
      try { await stopPlayback(); } catch { /* ignore */ }
    } else {
      try { await Voice.cancel(); } catch { /* ignore */ }
    }
    setIsRecording(false);
    setState('idle');
    setStatusMessage(t('recording_cancel'));
  }, [clearTimers, setState, t, useHandsFree]);

  const stopVoiceInteractionFn = useCallback(async () => {
    ttsActiveRef.current = false;
    try { Tts.stop(); } catch { /* ignore */ }
    if (useHandsFree) {
      await stopPlayback();
    }
    setState('idle');
  }, [setState, useHandsFree]);

  // Wire up Voice events — only used in legacy (non-hands-free) flow.
  // In hands-free mode, all STT happens server-side.
  // IMPORTANT: only register these handlers when NOT in hands-free mode.
  // Voice is a singleton — assigning handlers here overwrites any handlers
  // set by useWakeWord, killing wake-word detection (#154 / #208).
  if (!useHandsFree) {

  Voice.onSpeechEnd = () => {
    if (cancelledRef.current || !isPressedRef.current) return;
    isPressedRef.current = false;
    clearTimers();
    setIsRecording(false);
    setStatusMessage(t('recording_end'));
    if (!pipelineFiredRef.current) {
      pipelineFiredRef.current = true;
      void (async () => {
        // Android: onSpeechEnd fires before onSpeechResults arrives (network round-trip).
        // Wait 800ms so onSpeechResults can update lastTranscriptRef with the
        // complete utterance before dispatching to the pipeline (#truncation).
        if (Platform.OS === 'android') {
          await new Promise<void>(r => setTimeout(r, 800));
        }
        const text = lastTranscriptRef.current;
        if (!text) return;
        const isRealtime = shouldUseGrounding(text);
        setStatusMessage(isRealtime ? t('state_checking_live_data') : t('sending'));
        setState('processing');
        void runPipeline(text, isRealtime);
      })();
    }
  };

  Voice.onSpeechResults = (e: SpeechResultsEvent) => {
    if (cancelledRef.current) return;
    const text = e.value?.[0] ?? '';
    if (!text) return;
    lastTranscriptRef.current = text;
    setTranscript(text);
    if (!isPressedRef.current && !pipelineFiredRef.current) {
      pipelineFiredRef.current = true;
      const isRealtime = shouldUseGrounding(text);
      setStatusMessage(isRealtime ? t('state_checking_live_data') : t('sending'));
      setState('processing');
      void runPipeline(text, isRealtime);
    }
  };

  // Android SODA delivers interim results via onSpeechPartialResults then
  // fires error 7 instead of onSpeechResults. Capture partials so the
  // pipeline still has a transcript when onSpeechError fires.
  Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
    if (Platform.OS !== 'android') return;
    if (cancelledRef.current || !voiceReadyRef.current) return;
    const text = e.value?.[0] ?? '';
    if (!text) return;
    lastTranscriptRef.current = text;
    setTranscript(text);
  };

  Voice.onSpeechError = (_e: SpeechErrorEvent) => {
    if (cancelledRef.current || !voiceReadyRef.current) return;
    // Android SODA returns error 7 ("no match") after delivering the
    // transcript via onSpeechPartialResults. If we already have a transcript,
    // use it — don't show an error.
    if (lastTranscriptRef.current && !pipelineFiredRef.current) {
      pipelineFiredRef.current = true;
      isPressedRef.current = false;
      clearTimers();
      setIsRecording(false);
      const isRealtime = shouldUseGrounding(lastTranscriptRef.current);
      setStatusMessage(isRealtime ? t('state_checking_live_data') : t('sending'));
      setState('processing');
      void runPipeline(lastTranscriptRef.current, isRealtime);
      return;
    }
    showError('error_asr_failed');
  };

  } // end if (!useHandsFree)

  // ── Hands-free pipeline: on-device STT → /v1/voice/text → on-device TTS ──

  async function runHandsFreePipeline(audioPath: string) {
    // Premium users have unlimited requests (#212)
    if (!isPremium && !(await checkAndIncrementDaily())) {
      showError('error_daily_limit');
      return;
    }

    const reqId = Date.now() + '_' + Math.random();
    requestIdRef.current = reqId;

    let groundingPreamble = createGroundingPreambleController({
      enabled: false,
      callbacks: {
        speak: () => {},
        stop: () => {},
      },
    });

    pipelineTimerRef.current = setTimeout(() => {
      if (requestIdRef.current === reqId) {
        groundingPreamble.finalize();
        showError('error_timeout');
      }
    }, PIPELINE_TIMEOUT_MS);

    try {
      // Text-first path: use on-device STT transcript only.
      // Audio upload fallback removed — server does not accept .amr format.
      const sttTranscript = lastTranscriptRef.current;
      console.log('[PTT] runHandsFreePipeline: sttTranscript=', sttTranscript);
      if (!sttTranscript) {
        console.log('[PTT] runHandsFreePipeline: no transcript → idle');
        clearTimers();
        if (sessionActiveRef.current) {
          // Empty transcript during a session usually means the mic restarted
          // before the user was ready to speak (e.g. TTS-finish fired while the
          // user was still listening). Give them another chance instead of
          // killing the session immediately (#268).
          // A silent SESSION_SILENCE_TIMEOUT_MS will still auto-close if they
          // truly aren't speaking.
          console.log('[PTT] no transcript during session → restarting mic for another turn');
          if (onPressInRef.current) {
            await onPressInRef.current();
            return;
          }
          // Fallback: no onPressIn ref yet — end session gracefully.
          sessionActiveRef.current = false;
          setIsInSession(false);
        }
        setState('idle');
        return;
      }

      // #226 — Stop phrase: user explicitly ends the session mid-conversation.
      // Check before sending to server so we don't waste a round-trip.
      if (sessionActiveRef.current && SESSION_STOP_PHRASES.test(sttTranscript)) {
        console.log('[PTT] session stop phrase detected →', JSON.stringify(sttTranscript));
        clearTimers();
        sessionActiveRef.current = false;
        setIsInSession(false);
        setState('idle');
        setStatusMessage('');
        return;
      }

      // #230 — Real-time query detection: provide instant UX feedback so the
      // user knows why there's a ~1.5–2.5 s delay before the answer arrives.
      const isRealtimeQuery = shouldUseGrounding(sttTranscript);

      groundingPreamble = createGroundingPreambleController({
        enabled: isRealtimeQuery,
        callbacks: {
          speak: () => {
            if (requestIdRef.current !== reqId || cancelledRef.current) return;
            ttsActiveRef.current = true;
            void Tts.setDefaultLanguage(i18n.language).catch(() => {});
            Tts.speak(t('state_check_audio'));
          },
          stop: () => {
            try { Tts.stop(); } catch { /* ignore */ }
            ttsActiveRef.current = false;
          },
        },
      });
      groundingPreamble.arm();

      // Fast path for regular tap-to-talk: reuse the existing streaming chat
      // pipeline so TTS can start on first chunks instead of waiting for
      // buffered /v1/voice/text completion.
      const llmMode = mode === 'standard' ? 'personal' : mode;
      const STREAMING_MODES = ['personal', 'voice', 'business'];
      const useStreamingFastPath = STREAMING_MODES.includes(llmMode);
      if (useStreamingFastPath) {
        clearTimers();
        groundingPreamble.finalize();
        console.log('[PTT] hands-free fast-path: delegating to runPipeline (/chat/stream), sessionActive=', sessionActiveRef.current);
        await runPipeline(sttTranscript, isRealtimeQuery);
        return;
      }

      if (isRealtimeQuery) {
        setStatusMessage(t('state_checking_live_data')); // visual: status bar
      }

      const result = await sendTextToPipeline({
          text: sttTranscript,
          sessionId: sessionIdRef.current,
          mode: mode === 'standard' ? 'personal' : mode,
          language: i18n.language,
          grounding: isRealtimeQuery, // #230
        });

      if (requestIdRef.current !== reqId || cancelledRef.current) return;
      clearTimers();
      groundingPreamble.markResponseStarted();

      setState('speaking');
      setStatusMessage(t('server_ok'));
      setTranscript(result.transcript);
      // Defensive: ensure response is always a string (server may return object)
      const spokenText = typeof result.response === 'string'
        ? result.response
        : result.response?.text ?? '';
      setReplyText(spokenText);

      if (uid) {
        void appendConversationEntry(uid, { role: 'user', text: result.transcript });
        void appendConversationEntry(uid, { role: 'assistant', text: spokenText });
      }

      // Voice-triggered routine (#249): navigate after TTS confirmation
      const routineParams = typeof result.response === 'object' ? result.response?.parameters : null;
      if (
        typeof result.response === 'object' &&
        result.response?.intent === 'start_routine' &&
        routineParams?.routineId &&
        onRoutineIntent
      ) {
        // Speak confirmation first, then navigate once TTS ends
        const navigateAfterTts = () => {
          onRoutineIntent(routineParams.routineId as string, (routineParams.category as string) ?? routineParams.routineId);
        };
        if (spokenText) {
          Tts.removeAllListeners('tts-finish');
          Tts.removeAllListeners('tts-cancel');
          Tts.removeAllListeners('tts-error');
          Tts.addEventListener('tts-finish', () => { ttsActiveRef.current = false; setState('idle'); navigateAfterTts(); });
          Tts.addEventListener('tts-cancel', () => { ttsActiveRef.current = false; setState('idle'); navigateAfterTts(); });
          Tts.addEventListener('tts-error', () => { ttsActiveRef.current = false; setState('idle'); navigateAfterTts(); });
          ttsActiveRef.current = true;
          void Tts.setDefaultLanguage(i18n.language).catch(() => {});
          Tts.speak(spokenText);
        } else {
          setState('idle');
          navigateAfterTts();
        }
        return;
      }

      // Play response audio: PRIMARY = on-device TTS (fast, reliable), FALLBACK = server TTS (premium)
      // Issue #220: Switch to on-device-first strategy to eliminate server TTS failure scenarios
      if (spokenText) {
        // PRIMARY: Use on-device TTS (fast ~50ms, ~99% reliability, no network dependency)
        let ttsStartTime = 0;
        ttsActiveRef.current = true;
        Tts.removeAllListeners('tts-finish');
        Tts.removeAllListeners('tts-cancel');
        Tts.removeAllListeners('tts-error');
        Tts.addEventListener('tts-finish', () => {
          if (ttsTimeoutRef.current) { clearTimeout(ttsTimeoutRef.current); ttsTimeoutRef.current = null; }
          ttsActiveRef.current = false;
          console.log('[PTT] [iOS-timing] tts-finish fired at', Date.now(), '— duration', Date.now() - ttsStartTime, 'ms');
          void logEvent(getAnalytics(), 'tts_success', { method: 'on_device', duration_ms: Date.now() - ttsStartTime, language: i18n.language });
          // #226 — Session restart: after TTS naturally completes, restart the mic
          // for the next turn instead of returning to idle.
          void (async () => {
            if (sessionActiveRef.current && !cancelledRef.current) {
              // Start session silence timer: if the user doesn't speak within
              // SESSION_SILENCE_TIMEOUT_MS, the session auto-closes.
              if (sessionSilenceTimerRef.current) clearTimeout(sessionSilenceTimerRef.current);
              sessionSilenceTimerRef.current = setTimeout(() => {
                if (sessionActiveRef.current) {
                  console.log('[PTT] session silence timeout → ending session');
                  sessionActiveRef.current = false;
                  setIsInSession(false);
                  setState('idle');
                  setStatusMessage('');
                }
              }, SESSION_SILENCE_TIMEOUT_MS);
              if (sessionActiveRef.current && !cancelledRef.current && onPressInRef.current) {
                console.log('[PTT] session tts-finish → restarting mic for next turn');
                await onPressInRef.current();
              } else {
                setState('idle');
              }
            } else {
              setState('idle');
            }
          })();
        });
        // #226 — tts-cancel fires when stopVoiceInteraction() is called mid-response.
        // In session mode, restart listening so the user can speak immediately.
        Tts.addEventListener('tts-cancel', () => {
          if (ttsTimeoutRef.current) { clearTimeout(ttsTimeoutRef.current); ttsTimeoutRef.current = null; }
          ttsActiveRef.current = false;
          void (async () => {
            if (sessionActiveRef.current && !cancelledRef.current) {
              // Clear any pending silence timer — user interactions reset it.
              if (sessionSilenceTimerRef.current) {
                clearTimeout(sessionSilenceTimerRef.current);
                sessionSilenceTimerRef.current = null;
              }
              if (sessionActiveRef.current && !cancelledRef.current && onPressInRef.current) {
                console.log('[PTT] session tts-cancel → restarting mic');
                await onPressInRef.current();
              } else {
                setState('idle');
              }
            } else {
              setState('idle');
            }
          })();
        });
        // Handle on-device TTS errors with reqId guard to prevent stale sessions from affecting current session
        Tts.addEventListener('tts-error', async () => {
          if (ttsTimeoutRef.current) { clearTimeout(ttsTimeoutRef.current); ttsTimeoutRef.current = null; }
          if (requestIdRef.current !== reqId || cancelledRef.current) return;
          ttsActiveRef.current = false;
          console.warn('[PTT] [iOS-timing] tts-error fired at', Date.now(), '— duration since speak()', Date.now() - ttsStartTime, 'ms');
          void logEvent(getAnalytics(), 'tts_failed', { method: 'on_device', fallback_to: result.audio ? 'server' : 'idle', timestamp: Date.now() });
          console.warn('[PTT] On-device TTS error, attempting server audio fallback');
          if (result.audio) {
            await playResponseAudio(result.audio, () => {
              if (requestIdRef.current === reqId) setState('idle');
            });
          } else if (sessionActiveRef.current && !cancelledRef.current && onPressInRef.current) {
            // In session mode, restart listening so user can try again.
            await onPressInRef.current();
          } else {
            setState('idle');
          }
        });
        try {
          // Voice is fully destroyed before runHandsFreePipeline is
          // called (both paths await Voice.destroy() now). No extra
          // destroy needed here — go straight to TTS.
          await Tts.setDefaultLanguage(i18n.language);
          // Ensure the iOS audio-session settle (started concurrently with the
          // API call) has completed before opening the TTS audio session.
          if (iosDestroySettleRef.current) {
            console.log('[PTT] [iOS-timing] awaiting settle before Tts.speak() at', Date.now());
            await iosDestroySettleRef.current;
            iosDestroySettleRef.current = null;
            console.log('[PTT] [iOS-timing] settle done — calling Tts.speak() at', Date.now());
          } else {
            console.log('[PTT] [iOS-timing] no settle ref — calling Tts.speak() immediately at', Date.now());
          }
          ttsStartTime = Date.now();
          void logEvent(getAnalytics(), 'tts_started', { method: 'on_device', language: i18n.language });
          Tts.speak(spokenText);
          console.log('[PTT] [iOS-timing] Tts.speak() called at', ttsStartTime);
          // Safety net: iOS Core Audio can crash silently (IPCAUClient -66748)
          // after Voice.destroy(), producing an empty AVAudioBuffer with no
          // tts-finish or tts-error event. After 12 s with no event, force
          // recovery so the session doesn't freeze (#268-tts-crash).
          if (ttsTimeoutRef.current) clearTimeout(ttsTimeoutRef.current);
          ttsTimeoutRef.current = setTimeout(() => {
            ttsTimeoutRef.current = null;
            if (requestIdRef.current !== reqId || cancelledRef.current) return;
            console.warn('[PTT] TTS safety timeout — no tts-finish/tts-error after 12 s; recovering session');
            ttsActiveRef.current = false;
            Tts.removeAllListeners('tts-finish');
            Tts.removeAllListeners('tts-cancel');
            Tts.removeAllListeners('tts-error');
            if (sessionActiveRef.current && !cancelledRef.current && onPressInRef.current) {
              void (async () => {
                if (sessionActiveRef.current && !cancelledRef.current && onPressInRef.current) {
                  await onPressInRef.current();
                } else {
                  setState('idle');
                }
              })();
            } else {
              setState('idle');
            }
          }, 12_000);
        } catch (err) {
          // On-device TTS initialization failed, attempt server audio fallback
          console.warn('[PTT] On-device TTS initialization failed, attempting server audio fallback', err);
          ttsActiveRef.current = false;
          if (requestIdRef.current !== reqId || cancelledRef.current) return;
          if (result.audio) {
            // FALLBACK: Use server-generated TTS audio if on-device failed
            await playResponseAudio(result.audio, () => {
              if (requestIdRef.current === reqId) setState('idle');
            });
          } else {
            setState('idle');
          }
        }
      } else if (result.audio) {
        // If no text but audio exists, play it (edge case: response without text)
        await playResponseAudio(result.audio, () => {
          if (requestIdRef.current === reqId) setState('idle');
        });
      } else {
        // No text and no audio — reset to idle immediately so wake word resumes
        setState('idle');
      }
    } catch (err: unknown) {
      groundingPreamble.finalize();
      if (requestIdRef.current !== reqId || cancelledRef.current) return;
      clearTimers();
      const errMsg = err instanceof Error ? err.message : '';
      console.error('[PTT] runHandsFreePipeline error:', errMsg, err);
      if (errMsg === 'PREMIUM_REQUIRED' || errMsg === 'HTTP_403') {
        // Server rejected premium claim — fall back to free pipeline silently.
        // Next PTT press will use legacy (on-device STT → /v1/chat) path.
        console.log('[PTT] Premium pipeline rejected — switching to free pipeline');
        premiumRejectedRef.current = true;
        setState('idle');
        setStatusMessage('');
      } else {
        const key = errMsg ? 'error_network' : 'orchestration_error';
        showError(key);
      }
    }
  }

  // ── Streaming pipeline: text → SSE /chat/stream → sentence-by-sentence TTS ──
  // #269 — For personal/voice/business modes, stream delta chunks from the server
  // and speak each sentence as it arrives, so TTS starts within ~500 ms of the
  // first token rather than waiting for the full response to buffer.
  // Kids and car modes fall through to the legacy buffered path (safety scan required).

  async function runPipeline(userText: string, isRealtime = false) {
    // Premium users have unlimited requests (#212)
    if (!isPremium && !(await checkAndIncrementDaily())) {
      showError('error_daily_limit');
      return;
    }

    const reqId = Date.now() + '_' + Math.random();
    requestIdRef.current = reqId;

    const groundingPreamble = createGroundingPreambleController({
      enabled: isRealtime,
      callbacks: {
        speak: () => {
          if (requestIdRef.current !== reqId || cancelledRef.current) return;
          ttsActiveRef.current = true;
          void Tts.setDefaultLanguage(i18n.language).catch(() => {});
          Tts.speak(t('state_check_audio'));
        },
        stop: () => {
          try { Tts.stop(); } catch { /* ignore */ }
          ttsActiveRef.current = false;
        },
      },
    });
    groundingPreamble.arm();

    pipelineTimerRef.current = setTimeout(() => {
      if (requestIdRef.current === reqId) {
        groundingPreamble.finalize();
        showError('error_timeout');
      }
    }, PIPELINE_TIMEOUT_MS);

    const llmMode = mode === 'standard' ? 'personal' : mode;
    const STREAMING_MODES = ['personal', 'voice', 'business'];
    const useStreaming = STREAMING_MODES.includes(llmMode);

    // ── Sentence-boundary TTS queue (streaming path only) ────────────────
    // Splits incoming delta text on sentence boundaries and plays each sentence
    // as soon as it is complete, without waiting for the full response.
    let sentenceBuffer = '';
    const ttsQueue: string[] = [];
    let ttsBusy = false;
    let streamDone = false;
    let streamTtsPrepared = false;
    let streamTtsPreparing: Promise<void> | null = null;

    async function prepareStreamTts() {
      if (streamTtsPrepared) return;
      if (streamTtsPreparing) {
        await streamTtsPreparing;
        return;
      }

      streamTtsPreparing = (async () => {
        if (iosDestroySettleRef.current) {
          console.log('[PTT] [iOS-timing] stream awaiting settle before first Tts.speak() at', Date.now());
          await iosDestroySettleRef.current;
          iosDestroySettleRef.current = null;
          console.log('[PTT] [iOS-timing] stream settle done before first Tts.speak() at', Date.now());
        }
        try {
          await Tts.setDefaultLanguage(i18n.language);
        } catch {
          // keep device default if requested locale is unavailable
        }
        streamTtsPrepared = true;
      })();

      try {
        await streamTtsPreparing;
      } finally {
        streamTtsPreparing = null;
      }
    }

    async function flushTtsQueue() {
      if (cancelledRef.current || requestIdRef.current !== reqId) {
        ttsQueue.length = 0;
        sentenceBuffer = '';
        ttsBusy = false;
        ttsActiveRef.current = false;
        return;
      }
      if (ttsBusy || ttsQueue.length === 0) return;
      await prepareStreamTts();
      if (cancelledRef.current || requestIdRef.current !== reqId) {
        ttsQueue.length = 0;
        sentenceBuffer = '';
        ttsBusy = false;
        ttsActiveRef.current = false;
        return;
      }
      if (ttsBusy || ttsQueue.length === 0) return;
      const sentence = ttsQueue.shift()!;
      ttsBusy = true;
      ttsActiveRef.current = true;

      Tts.removeAllListeners('tts-finish');
      Tts.removeAllListeners('tts-cancel');
      Tts.removeAllListeners('tts-error');

      const onFinish = () => {
        if (cancelledRef.current || requestIdRef.current !== reqId) {
          ttsQueue.length = 0;
          sentenceBuffer = '';
          ttsBusy = false;
          ttsActiveRef.current = false;
          setState('idle');
          return;
        }
        ttsBusy = false;
        if (ttsQueue.length > 0) {
          void flushTtsQueue();
        } else if (streamDone) {
          ttsActiveRef.current = false;
          if (sessionActiveRef.current && !cancelledRef.current && onPressInRef.current) {
            void (async () => {
              if (sessionActiveRef.current && !cancelledRef.current && onPressInRef.current) {
                console.log('[PTT] stream tts-finish in session → restarting mic');
                await onPressInRef.current();
              } else {
                setState('idle');
              }
            })();
          } else {
            setState('idle');
          }
        }
        // If stream not done yet and queue empty, we wait — onDelta will
        // call flushTtsQueue() again when the next sentence arrives.
      };

      Tts.addEventListener('tts-finish', () => { console.log('[PTT] tts-finish (stream)'); onFinish(); });
      Tts.addEventListener('tts-cancel', () => {
        ttsQueue.length = 0;
        sentenceBuffer = '';
        ttsBusy = false;
        ttsActiveRef.current = false;
        setState('idle');
      });
      Tts.addEventListener('tts-error', (e) => { console.log('[PTT] tts-error (stream)', e); ttsBusy = false; ttsActiveRef.current = false; setState('idle'); });

      Tts.speak(sentence);
    }

    function enqueueSentences(text: string, flush = false) {
      sentenceBuffer += text;
      // Split on sentence-ending punctuation followed by whitespace or end-of-string
      const parts = sentenceBuffer.split(/(?<=[.!?])\s+/);
      // Keep the last part in buffer (may be incomplete) unless flush=true
      const complete = flush ? parts : parts.slice(0, -1);
      sentenceBuffer = flush ? '' : (parts[parts.length - 1] ?? '');
      for (const s of complete) {
        const trimmed = s.trim();
        if (trimmed) ttsQueue.push(trimmed);
      }
      void flushTtsQueue();
    }

    // #294 Option B — Progressive feedback: after 8 s with no first delta,
    // update the status bar so the user knows the request is still in flight.
    // This is especially noticeable on grounded queries that run web search.
    // Declared outside try so the catch block can clear it if orchestrate() throws.
    let stillFetchingTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      if (isRealtime) {
        stillFetchingTimer = setTimeout(() => {
          if (requestIdRef.current === reqId && !cancelledRef.current) {
            setStatusMessage(t('state_still_fetching'));
          }
        }, 8_000);
      }

      const result = await orchestrate({
        userText,
        sessionId: sessionIdRef.current,
        language: i18n.language,
        serverEndpoint: SERVER_ENDPOINT,
        apiVersion: API_VERSION,
        // #294 — Grounded queries need a longer timeout because the server runs
        // a two-phase pipeline (web search then structured generation).
        requestTimeoutMs: isRealtime ? GROUNDED_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
        imageBase64,
        imageMimeType,
        grounding: isRealtime, // #230
        mode: llmMode,
        // #269 — onDelta activates SSE streaming; omit for kids/car (buffered)
        ...(useStreaming && {
          onDelta: (delta: string, accumulated: string) => {
            if (requestIdRef.current !== reqId || cancelledRef.current) return;
            groundingPreamble.markResponseStarted();
            // #294 — Cancel the "still fetching" hint as soon as the first chunk arrives.
            if (stillFetchingTimer !== null) {
              clearTimeout(stillFetchingTimer);
              stillFetchingTimer = null;
            }
            // Switch UI to speaking state on first chunk
            if (!ttsActiveRef.current && accumulated.length <= delta.length) {
              setState('speaking');
              setStatusMessage(t('server_ok'));
            }
            setReplyText(accumulated);
            enqueueSentences(delta);
          },
        }),
      });

      if (stillFetchingTimer !== null) {
        clearTimeout(stillFetchingTimer);
        stillFetchingTimer = null;
      }
      if (requestIdRef.current !== reqId || cancelledRef.current) return;
      clearTimers();
      groundingPreamble.markResponseStarted();

      setTranscript(result.transcript ?? userText);
      setReplyText(result.replyText);

      if (result.streamMetrics?.transport === 'sse') {
        console.log('[PTT][stream-metrics]', {
          mode: llmMode,
          sessionId: sessionIdRef.current,
          firstChunkLatencyMs: result.streamMetrics.firstChunkLatencyMs,
          totalLatencyMs: result.streamMetrics.totalLatencyMs,
          chunkCount: result.streamMetrics.chunkCount,
          completed: result.streamMetrics.completed,
          timedOut: result.streamMetrics.timedOut,
        });
      }

      if (uid) {
        void appendConversationEntry(uid, { role: 'user', text: result.transcript ?? userText });
        void appendConversationEntry(uid, { role: 'assistant', text: result.replyText });
      }

      // Voice-triggered routine (#249): legacy pipeline path
      if (
        result.intent === 'start_routine' &&
        result.parameters?.routineId &&
        onRoutineIntent
      ) {
        const navigateAfterTts = () => {
          onRoutineIntent(result.parameters.routineId as string, (result.parameters.category as string) ?? result.parameters.routineId);
        };
        if (result.replyText) {
          Tts.removeAllListeners('tts-finish');
          Tts.removeAllListeners('tts-cancel');
          Tts.removeAllListeners('tts-error');
          Tts.addEventListener('tts-finish', () => { ttsActiveRef.current = false; setState('idle'); navigateAfterTts(); });
          Tts.addEventListener('tts-cancel', () => { ttsActiveRef.current = false; setState('idle'); navigateAfterTts(); });
          Tts.addEventListener('tts-error', () => { ttsActiveRef.current = false; setState('idle'); navigateAfterTts(); });
          ttsActiveRef.current = true;
          void Tts.setDefaultLanguage(i18n.language).catch(() => {});
          Tts.speak(result.replyText);
        } else {
          setState('idle');
          navigateAfterTts();
        }
        return;
      }

      // Guard: if the server returned no speakable text, reset to idle
      // rather than calling Tts.speak('') which fires tts-finish silently.
      if (!result.replyText) {
        setState('idle');
        return;
      }

      if (useStreaming) {
        // Flush any remaining buffered text (last sentence may lack trailing punctuation)
        streamDone = true;
        enqueueSentences('', true);
        // If TTS queue was already empty and not busy, transition to idle
        if (!ttsBusy && ttsQueue.length === 0) {
          ttsActiveRef.current = false;
          setState('idle');
        }
      } else {
        // ── Buffered path (kids / car) — unchanged ──────────────────────
        setState('speaking');
        setStatusMessage(t('server_ok'));
        console.log('[PTT] replyText:', result.replyText);
        Tts.removeAllListeners('tts-finish');
        Tts.removeAllListeners('tts-cancel');
        Tts.removeAllListeners('tts-error');
        Tts.addEventListener('tts-finish', () => { console.log('[PTT] tts-finish'); ttsActiveRef.current = false; setState('idle'); });
        Tts.addEventListener('tts-cancel', () => { ttsActiveRef.current = false; setState('idle'); });
        Tts.addEventListener('tts-error', (e) => { console.log('[PTT] tts-error', e); ttsActiveRef.current = false; setState('idle'); });
        try { await Tts.setDefaultLanguage(i18n.language); } catch { /* language not available, device default is used */ }
        ttsActiveRef.current = true;
        Tts.speak(result.replyText);
      }
    } catch (err: unknown) {
      groundingPreamble.finalize();
      if (stillFetchingTimer !== null) { clearTimeout(stillFetchingTimer); stillFetchingTimer = null; }
      if (requestIdRef.current !== reqId || cancelledRef.current) return;
      clearTimers();
      const key = err instanceof Error && err.message ? 'error_network' : 'orchestration_error';
      showError(key);
    }
  }

  return {
    voiceState,
    statusMessage,
    transcript,
    replyText,
    isRecording,
    errorMessage,
    isInSession,
    onTap,
    onPressIn,
    onPressOut,
    cancel,
    stopVoiceInteraction: stopVoiceInteractionFn,
    startVoiceSession,
    endVoiceSession,
  };
}

function generateSessionId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
