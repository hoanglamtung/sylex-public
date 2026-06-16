/**
 * useWakeWordEnrollment — #210 Phase 2
 *
 * Manages the custom wake-word enrollment flow:
 *   idle → recording (Voice STT, 8 s timeout) → recognised → saving → idle
 *   Any step can transition to error → idle via retry().
 *
 * On confirm, saves the lower-cased phrase to AsyncStorage under
 * CUSTOM_WAKE_WORD_KEY so useWakeWord picks it up as the primary match.
 *
 * Design constraints:
 *  • No 3rd-party KWS SDK — uses existing @react-native-voice/voice.
 *  • Wake-word listener must be paused by the caller before opening the modal
 *    (useWakeWord.paused=true) to avoid mic contention.
 *  • Records in the app's active i18n locale so non-English wake words are transcribed
 *    by the correct STT acoustic model (#265).
 */

import { useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import Voice from '@react-native-voice/voice';
import i18n from '../i18n';
import type { SpeechResultsEvent } from '@react-native-voice/voice';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setWakeWordListening, isWakeWordListening } from '../services/voicePipelineService';

/** AsyncStorage key for the user's custom wake phrase. */
export const CUSTOM_WAKE_WORD_KEY = '@customWakeWord';
/** AsyncStorage key for whether custom wake-word mode is active. */
export const CUSTOM_WAKE_WORD_ENABLED_KEY = '@customWakeWordEnabled';

export type EnrollmentState = 'idle' | 'recording' | 'recognised' | 'saving' | 'error';

export interface UseWakeWordEnrollmentResult {
  state: EnrollmentState;
  recognisedPhrase: string;
  errorMessage: string;
  startRecording: () => Promise<void>;
  confirmPhrase: () => Promise<void>;
  savePhrase: (phrase: string) => Promise<void>;
  retry: () => void;
  /** Cancels any in-progress recording and resets to idle. Call on modal close. */
  reset: () => void;
}

const RECORDING_TIMEOUT_MS = 8_000;

export function useWakeWordEnrollment(
  onSaved?: (phrase: string) => void,
): UseWakeWordEnrollmentResult {
  const [state, setState] = useState<EnrollmentState>('idle');
  const [recognisedPhrase, setRecognisedPhrase] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const activeRef  = useRef(false);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves isWakeWordListening() before enrollment takes the mic so we can restore
  // it when enrollment finishes (same guard pattern as PTT — see #154).
  const prevWakeWordRef = useRef(false);
  // Android SODA delivers the final transcript via onSpeechPartialResults, not
  // onSpeechResults, then fires onSpeechError (code 7) instead of finishing cleanly.
  // Capture the last partial so onSpeechError can use it as the committed phrase.
  const lastPartialRef = useRef('');
  // iOS does not reliably fire onSpeechEnd after the user stops speaking.
  // This debounce timer commits lastPartialRef 1.2 s after the last
  // onSpeechResults event, so enrollment never hangs waiting for an end signal
  // that silently never arrives (#iOS-onSpeechEnd-silent).
  const resultCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearResultCommitTimer = () => {
    if (resultCommitTimerRef.current) {
      clearTimeout(resultCommitTimerRef.current);
      resultCommitTimerRef.current = null;
    }
  };

  const detachVoice = () => {
    Voice.onSpeechResults       = null;
    Voice.onSpeechPartialResults = null;
    Voice.onSpeechError          = null;
    Voice.onSpeechEnd            = null;
  };

  const stopVoice = async () => {
    detachVoice();
    try { await Voice.destroy(); } catch { /* ignore */ }
  };

  const handleResult = useCallback((text: string) => {
    console.log('[Enrollment] handleResult called | activeRef:', activeRef.current, '| text:', JSON.stringify(text));
    if (!activeRef.current) {
      console.log('[Enrollment] handleResult SKIPPED — already inactive');
      return;
    }
    clearTimer();
    clearResultCommitTimer();
    activeRef.current = false;
    void stopVoice();
    const trimmed = text.toLowerCase().trim();
    console.log('[Enrollment] handleResult trimmed:', JSON.stringify(trimmed));
    if (trimmed.length > 0) {
      setRecognisedPhrase(trimmed);
      setState('recognised');
    } else {
      setErrorMessage('enrollment_error_no_speech');
      setState('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = useCallback(async () => {
    console.log('[Enrollment] startRecording called');
    // Mirror the PTT mic-contention fix (#154): clear the wakeWordListening flag
    // BEFORE any Voice work so that any useWakeWord restart() call already past
    // its first guard will hit the second guard (isWakeWordListening()=false)
    // and abort, rather than calling Voice.start() on top of our session.
    prevWakeWordRef.current = isWakeWordListening();
    setWakeWordListening(false);

    await stopVoice();

    // Show recording UI immediately — user gets visual feedback right away.
    activeRef.current = true;
    setState('recording');
    setRecognisedPhrase('');
    setErrorMessage('');

    // Settle time: lets AVAudioSession (iOS) or SODA mic driver (Android)
    // fully release before we re-open; also gives any in-flight restart()
    // timer the chance to fire and abort on the isWakeWordListening() guard.
    await new Promise<void>(r => setTimeout(r, Platform.OS === 'ios' ? 600 : 350));

    // Guard: modal may have been closed (reset() called) during the settle.
    if (!activeRef.current) return;

    // Reset the partial accumulator and any stale debounce for this recording session.
    lastPartialRef.current = '';
    clearResultCommitTimer();

    // Wire up handlers only after the settle — avoids stale late-delivery
    // events from the destroyed session triggering the new handlers.

    // iOS: onSpeechResults fires incrementally as the user speaks (each event
    // may carry only the words recognised so far, not the final phrase). Calling
    // handleResult() on the first event would capture only the first word (#266).
    // Instead, accumulate into lastPartialRef.
    //
    // Crucially, iOS does NOT reliably fire onSpeechEnd after the user stops
    // speaking (#iOS-onSpeechEnd-silent). To avoid depending on it, we reset
    // a debounce timer on every result event. If no new result arrives within
    // 1.2 s the user has stopped talking — commit what we have.
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = e.value?.[0] ?? '';
      console.log('[Enrollment] onSpeechResults fired | text:', JSON.stringify(text));
      if (text.trim()) {
        lastPartialRef.current = text;
        // Reset the commit debounce on every new result.
        clearResultCommitTimer();
        resultCommitTimerRef.current = setTimeout(() => {
          console.log('[Enrollment] result-commit debounce fired | lastPartial:', JSON.stringify(lastPartialRef.current), '| activeRef:', activeRef.current);
          if (!activeRef.current) return; // already handled (onSpeechEnd, onSpeechError, or timeout)
          handleResult(lastPartialRef.current);
        }, 1_200);
      }
    };

    // Accumulate partials — needed so onSpeechEnd has text to fall back to
    // when onSpeechResults hasn't fired yet (common on iOS after brief speech).
    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      const text = e.value?.[0] ?? '';
      console.log('[Enrollment] onSpeechPartialResults fired | text:', JSON.stringify(text));
      if (text.trim()) lastPartialRef.current = text;
    };

    // VAD detected end-of-speech. On iOS, onSpeechResults may arrive just
    // after this (give it 300 ms). If it doesn't, commit lastPartialRef so
    // the user isn't left waiting for the 8 s timeout.
    Voice.onSpeechEnd = () => {
      console.log('[Enrollment] onSpeechEnd fired | lastPartial:', JSON.stringify(lastPartialRef.current), '| activeRef:', activeRef.current);
      setTimeout(() => {
        console.log('[Enrollment] onSpeechEnd timeout | activeRef after 300ms:', activeRef.current);
        if (!activeRef.current) return; // already handled by onSpeechResults
        if (lastPartialRef.current) {
          handleResult(lastPartialRef.current);
        }
        // else: no speech captured — let the 8 s timeout fire the error.
      }, 300);
    };

    Voice.onSpeechError = (e) => {
      console.log('[Enrollment] onSpeechError fired | code:', e?.error?.code, '| message:', e?.error?.message, '| activeRef:', activeRef.current);
      if (!activeRef.current) return;
      // Android SODA: delivers the final transcript via onSpeechPartialResults
      // then fires error code 7 ("no recognition results") instead of finishing
      // cleanly. If we have a partial, commit it as the recognised phrase (#266).
      if (lastPartialRef.current) {
        handleResult(lastPartialRef.current);
        return;
      }
      // fix #266 changed onSpeechResults to accumulate into lastPartialRef
      // instead of calling handleResult immediately. Give any in-flight
      // onSpeechResults event 100 ms to populate lastPartialRef before
      // we surface the error — avoids a false "Recording failed" when results
      // and the error arrive in quick succession.
      setTimeout(() => {
        if (!activeRef.current) return; // already handled (e.g. by onSpeechEnd)
        if (lastPartialRef.current) {
          handleResult(lastPartialRef.current);
          return;
        }
        clearTimer();
        activeRef.current = false;
        void stopVoice();
        setErrorMessage('enrollment_error_recognition');
        setState('error');
      }, 100);
    };

    timerRef.current = setTimeout(() => {
      if (!activeRef.current) return;
      activeRef.current = false;
      void stopVoice();
      setErrorMessage('enrollment_error_timeout');
      setState('error');
    }, RECORDING_TIMEOUT_MS);

    try {
      console.log('[Enrollment] calling Voice.start(', i18n.language, ')...');
      await Voice.start(i18n.language);
      console.log('[Enrollment] Voice.start succeeded');
    } catch (err) {
      console.warn('[Enrollment] Voice.start threw (attempt 1), retrying after 500 ms…', err);
      // Mirror PTT's retry pattern (#299): mic may still be held by the wake-word
      // cleanup's unawaited Voice.destroy() — give it time to release, then retry.
      await new Promise<void>(r => setTimeout(r, 500));
      if (!activeRef.current) return; // reset() was called during the retry wait
      try {
        await Voice.start(i18n.language);
        console.log('[Enrollment] Voice.start succeeded on retry');
      } catch (err2) {
        console.error('[Enrollment] Voice.start failed on retry:', err2);
        clearTimer();
        activeRef.current = false;
        setErrorMessage('enrollment_error_recognition');
        setState('error');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleResult]);

  const confirmPhrase = useCallback(async () => {
    if (!recognisedPhrase) return;
    setState('saving');
    try {
      await AsyncStorage.setItem(CUSTOM_WAKE_WORD_KEY, recognisedPhrase);
      setWakeWordListening(prevWakeWordRef.current);
      setState('idle');
      onSaved?.(recognisedPhrase);
    } catch {
      setErrorMessage('enrollment_error_save');
      setState('error');
    }
  }, [recognisedPhrase, onSaved]);

  const savePhrase = useCallback(async (phrase: string) => {
    const normalized = phrase.toLowerCase().trim();
    if (!normalized) {
      setErrorMessage('enrollment_error');
      setState('error');
      return;
    }
    setState('saving');
    try {
      await AsyncStorage.setItem(CUSTOM_WAKE_WORD_KEY, normalized);
      setWakeWordListening(prevWakeWordRef.current);
      setState('idle');
      onSaved?.(normalized);
    } catch {
      setErrorMessage('enrollment_error_save');
      setState('error');
    }
  }, [onSaved]);

  const retry = useCallback(() => {
    setState('idle');
    setRecognisedPhrase('');
    setErrorMessage('');
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    clearResultCommitTimer();
    activeRef.current = false;
    void stopVoice();
    // Restore the wake-word listener flag so useWakeWord can restart.
    setWakeWordListening(prevWakeWordRef.current);
    setState('idle');
    setRecognisedPhrase('');
    setErrorMessage('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, recognisedPhrase, errorMessage, startRecording, confirmPhrase, savePhrase, retry, reset };
}
