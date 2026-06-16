/**
 * useWakeWord — #154
 *
 * Continuous on-device wake-word listener for "Hey Sylex".
 *
 * Uses @react-native-voice/voice in a restart loop (silence → restart → listen…).
 * Fires onWakeWord() when the transcript contains "hey sylex".
 *
 * Requirements:
 *  • Premium only (isPremium=false → hook is a no-op)
 *  • User opt-in (enabled=false → no-op)
 *  • Pauses automatically while PTT is recording / processing / speaking
 *  • App must be in foreground (background mic access is a separate entitlement)
 *
 * Migration path to Porcupine (.ppn):
 *  Replace the Voice loop below with PorcupineManager.create().start().
 *  Keep the isPremium / enabled / paused guards and onWakeWordRef unchanged.
 *
 * AsyncStorage key: WAKE_WORD_ENABLED_KEY — shared with SettingsScreen.
 */

import { useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import Voice, { SpeechResultsEvent } from '@react-native-voice/voice';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setWakeWordListening, isWakeWordListening } from '../services/voicePipelineService';
import { CUSTOM_WAKE_WORD_KEY, CUSTOM_WAKE_WORD_ENABLED_KEY } from './useWakeWordEnrollment';
import i18n from '../i18n';

/**
 * Phrases to listen for (lower-cased).
 * "Sylex" is not in any ASR vocabulary, so we also match the most common
 * misrecognitions from Apple/Google STT engines across multiple languages.
 * Users should say "sigh-lex" (rhymes with "high-lex").
 */
const WAKE_PATTERNS = [
  // Exact
  'hey sylex', 'hi sylex',
  // Common English misrecognitions
  'hey silex', 'hi silex',
  'hey cylex', 'hi cylex',
  'hey sigh lex', 'hi sigh lex',
  'hey psych lex', 'hi psych lex',
  // Commonly reported misrecognitions
  'hey zila', 'hi zila',
  'hey shaila', 'hi shaila',
  'hey sheila', 'hi sheila',
  'hey sila', 'hi sila',
  'hey zilex', 'hi zilex',
  'hey sailex', 'hi sailex',
  'hey selex', 'hi selex',
  'hey slex', 'hi slex',
  'hey psylex', 'hi psylex',
  // German STT misrecognitions
  'hey seilex', 'hi seilex',
  'hey shailex', 'hi shailex',
  'hey sai lex', 'hi sai lex',
  'hey sei lex', 'hi sei lex',
];
/** Built-in pattern check (Sylex + all documented variants). */
const isBuiltInWakePhrase = (text: string) => WAKE_PATTERNS.some(p => text.includes(p));

/** AsyncStorage key for the always-listening preference. */
export const WAKE_WORD_ENABLED_KEY = '@wakeWordEnabled';

export interface UseWakeWordOptions {
  /** Must be true — non-premium callers are a no-op. */
  isPremium: boolean;
  /** User preference loaded from AsyncStorage. Off by default. */
  enabled: boolean;
  /**
   * Set to true while PTT is recording / processing / speaking so the
   * wake-word listener suspends and doesn't fight for the microphone.
   */
  paused: boolean;
  /** Invoked when "Hey Sylex" is detected in the on-device transcript. */
  onWakeWord: () => void;
}

export function useWakeWord({
  isPremium,
  enabled,
  paused,
  onWakeWord,
}: UseWakeWordOptions): void {
  // Whether the listen loop is currently active in this effect run.
  const activeRef      = useRef(false);
  // Always-current ref so the callback never causes an effect re-run.
  const onWakeWordRef  = useRef(onWakeWord);
  onWakeWordRef.current = onWakeWord;
  // Timestamp of the most recent Voice.destroy() call (from restart() or fireWakeWord).
  // Used to prevent concurrent double-setActive:false when restart()'s destroy overlaps
  // with the wake-phrase fireWakeWord() destroy (#154).
  const lastDestroyAtRef = useRef<number>(0);
  // Custom wake phrase loaded from AsyncStorage — null until loaded.
  // Exclusive mode: when custom is enabled, ONLY the custom phrase fires.
  // Built-in WAKE_PATTERNS are used only when no custom mode is active.
  const customPhraseRef = useRef<string | null>(null);

  // Exclusive: when a custom phrase is active, only that phrase fires.
  // Built-in Sylex variants are the fallback when no custom mode is active.
  const isWakePhrase = (text: string) =>
    customPhraseRef.current !== null
      ? text.includes(customPhraseRef.current)
      : isBuiltInWakePhrase(text);

  useEffect(() => {
    // Load custom phrase AND whether custom mode is enabled each time the
    // listener (re-)starts. Without checking CUSTOM_WAKE_WORD_ENABLED_KEY,
    // a previously-enrolled phrase would still fire after the user switches
    // back to the built-in "Hey Sylex" mode.
    Promise.all([
      AsyncStorage.getItem(CUSTOM_WAKE_WORD_KEY),
      AsyncStorage.getItem(CUSTOM_WAKE_WORD_ENABLED_KEY),
    ])
      .then(([phrase, customEnabled]) => {
        customPhraseRef.current = (customEnabled === 'true' && phrase) ? phrase : null;
      })
      .catch(() => {});

    if (!isPremium || !enabled || paused) {
      console.log('[WakeWord] skip — isPremium:', isPremium, 'enabled:', enabled, 'paused:', paused);
      // Not conditions met — stop any running session, but only if this hook
      // still owns the mic. Two ways ownership can already be transferred:
      // 1. Wake-word fired → onSpeechResults set activeRef=false + cleared flag.
      // 2. PTT pressed manually → onPressIn() called setWakeWordListening(false)
      //    + Voice.destroy() directly before this cleanup fires.
      // In both cases Voice.destroy() was already called; calling it again would
      // race recorder.startRecorder()'s setActive:true → '!pri' (#154).
      // Guard: skip if activeRef is already cleared OR if PTT already cleared
      // the wakeWordListening flag (import isWakeWordListening to check).
      if (activeRef.current && isWakeWordListening()) {
        activeRef.current = false;
        setWakeWordListening(false);
        Voice.destroy().catch(() => {});
      } else {
        // PTT already owns the session — just clear our active flag.
        activeRef.current = false;
      }
      return;
    }

    activeRef.current   = true;
    setWakeWordListening(true);
    console.log('[WakeWord] starting Voice listener…');

    // ── restart ─────────────────────────────────────────────────────────────
    // Destroys the current Voice session, waits briefly, then starts a new one.
    // Called after: (a) false-detection, (b) silence end, (c) error.
    //
    // Guards check BOTH activeRef (React-level) AND isWakeWordListening()
    // (synchronous global flag). PTT clears wakeWordListening synchronously
    // in onPressIn BEFORE any async work, so this flag is immediately visible
    // to any in-flight restart() — even before React re-renders and clears
    // activeRef. Without this double-check, restart() can call Voice.start()
    // AFTER PTT has destroyed Voice, permanently holding the mic (#154).
    const restart = async () => {
      if (!activeRef.current || !isWakeWordListening()) return;
      // Stamp BEFORE the native call so fireWakeWord() can see it immediately.
      lastDestroyAtRef.current = Date.now();
      try { await Voice.destroy(); } catch { /* ignore */ }
      // Short settle — AVAudioEngine needs a moment before re-opening mic.
      await new Promise<void>(r => setTimeout(r, 350));
      if (!activeRef.current || !isWakeWordListening()) return;
      try { await Voice.start(i18n.language); } catch { /* ignore */ }
    };

    // ── Voice event handlers ─────────────────────────────────────────────────

    // Shared wake-word fire helper — used by both onSpeechResults (iOS) and
    // onSpeechPartialResults (Android SODA, which never fires onSpeechResults).
    const fireWakeWord = async () => {
      // Guard against concurrent double-destroy (#154):
      // If restart() called Voice.destroy() very recently (e.g. iOS delivered
      // final recognition results during teardown), skip a second destroy and
      // just wait out the remaining settle window instead. Two concurrent
      // setActive:false calls race recorder.startRecorder()'s setActive:true.
      const SETTLE_MS = 800;
      const elapsed = Date.now() - lastDestroyAtRef.current;
      if (elapsed < SETTLE_MS) {
        // Recent destroy in-flight — wait remaining settle time only.
        const wait = Platform.OS === 'ios' ? SETTLE_MS - elapsed : 350;
        await new Promise<void>(r => setTimeout(r, wait));
      } else {
        // No recent destroy — do our own and wait the full settle window.
        lastDestroyAtRef.current = Date.now();
        try { await Voice.destroy(); } catch { /* ignore */ }
        // iOS needs 800 ms for AVAudioSession teardown (#154).
        // Android also needs a settle so SODA releases the mic before
        // onPressIn's Voice.start() runs — otherwise Voice.start() fails
        // immediately (mic still held) → "Fehler aufgetreten" on wake word.
        await new Promise<void>(r => setTimeout(r, Platform.OS === 'ios' ? SETTLE_MS : 350));
      }
      onWakeWordRef.current();
    };

    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      if (!activeRef.current || !isWakeWordListening()) return;
      const text = (e.value?.[0] ?? '').toLowerCase().trim();
      console.log('[WakeWord] heard:', JSON.stringify(text));
      if (isWakePhrase(text)) {
        activeRef.current = false;
        setWakeWordListening(false);
        void fireWakeWord();
      }
      // Non-match: keep listening — iOS accumulates words in e.value[0]
      // ("hey" → "hey sylex"). Restart only happens from onSpeechEnd after silence.
    };

    // Android only: SODA offline recognizer delivers interim results via
    // onSpeechPartialResults and returns error 7 instead of firing onSpeechResults.
    // iOS already works via onSpeechResults — this handler is skipped on iOS.
    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      if (Platform.OS !== 'android') return;
      if (!activeRef.current || !isWakeWordListening()) return;
      const text = (e.value?.[0] ?? '').toLowerCase().trim();
      console.log('[WakeWord] partial:', JSON.stringify(text));
      if (isWakePhrase(text)) {
        activeRef.current = false;
        setWakeWordListening(false);
        void fireWakeWord();
      }
    };

    Voice.onSpeechEnd = () => {
      // VAD fired end-of-speech. Restart the loop to listen again.
      // (If wake phrase was detected, activeRef is already false.)
      if (!activeRef.current || !isWakeWordListening()) return;
      void restart();
    };

    Voice.onSpeechError = () => {
      if (!activeRef.current || !isWakeWordListening()) return;
      console.log('[WakeWord] Voice.onSpeechError — backing off 1s');
      // Back off 1 s on error to avoid hammering the mic driver.
      setTimeout(() => { if (activeRef.current && isWakeWordListening()) void restart(); }, 1_000);
    };

    // ── Start the first session ──────────────────────────────────────────────
    // Use the app's active i18n locale so custom (non-English) wake words are
    // recognised by the correct STT acoustic model (#265). The default wake phrase
    // "Hey Sylex" is phonetically simple enough to survive locale changes.
    // After TTS playback / recording, the iOS audio session may need time to
    // settle before Voice can acquire the mic. Wait 600 ms on iOS to avoid
    // a silent failure that leaves the wake-word listener dead.
    const startInitial = async () => {
      // Destroy any stale Voice session (e.g. from the pipeline's live STT)
      // before starting the wake-word listener. Without this, Voice.start()
      // silently fails on iOS — the old session blocks the new one.
      try { await Voice.destroy(); } catch { /* ignore */ }
      if (Platform.OS === 'ios') {
        await new Promise<void>(r => setTimeout(r, 600));
        if (!activeRef.current || !isWakeWordListening()) return;
      }
      try {
        await Voice.start(i18n.language);
      } catch (err: unknown) {
        console.warn('[WakeWord] initial Voice.start failed:', err);
        // If initial start fails, retry after 2 s.
        setTimeout(() => { if (activeRef.current && isWakeWordListening()) void restart(); }, 2_000);
      }
    };
    void startInitial();

    return () => {
      if (activeRef.current && isWakeWordListening()) {
        activeRef.current = false;
        setWakeWordListening(false);
        Voice.destroy().catch(() => {});
      } else {
        activeRef.current = false;
      }
    };
  }, [isPremium, enabled, paused]);
}
