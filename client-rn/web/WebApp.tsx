import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DAILY_LIMIT,
  SESSION_DURATION_MS,
  canMakeRequest,
  checkAndIncrementDaily,
  grantAdRewardCommands,
  getDailyUsageStats,
  recordRequest,
  sanitizeInput,
  startSession,
  stopSession,
} from './usage';
import { detectLanguage, persistLanguage, SUPPORTED_LANGUAGES, t } from './localization';
import { runPipeline } from './orchestration';
import { BottomNavSection } from './components/BottomNavSection';
import { HeaderSection } from './components/HeaderSection';
import { LoginOverlay } from './components/LoginOverlay';
import { PremiumGateSection } from './components/PremiumGateSection';
import { SettingsOverlay } from './components/SettingsOverlay';
import { UpgradePanel } from './components/UpgradePanel';
import { UsageSection } from './components/UsageSection';
import { VoiceStageSection } from './components/VoiceStageSection';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

type ErrorKey =
  | 'error_network'
  | 'error_timeout'
  | 'error_mic_permission'
  | 'error_asr_failed'
  | 'error_upload_failed'
  | 'error_llm_failed'
  | 'error_tts_failed'
  | 'orchestration_error'
  | 'error_daily_limit'
  | 'error_session_warning'
  | 'error_session_ended'
  | 'error_input_too_long';

const REQUEST_TIMEOUT_MS = 15_000;
const PIPELINE_TIMEOUT_MS = 30_000;
const HOLD_TO_RECORD_MS = 180;

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionEventLike {
  results?: ArrayLike<ArrayLike<SpeechRecognitionResultItem>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type WebTestPlan = 'auto' | 'free' | 'pro';

export function WebApp() {
  const testPlan = getWebTestPlanOverride();
  // TODO: Replace auto fallback with real auth claim when web auth is wired.
  const isPremiumUser = testPlan === 'pro' ? true : testPlan === 'free' ? false : false;

  const [language, setLanguage] = useState(detectLanguage());
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [speakingProgress, setSpeakingProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [replyText, setReplyText] = useState('');
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [pickerPreviewUrl, setPickerPreviewUrl] = useState<string | null>(null);
  const [dailyRemaining, setDailyRemaining] = useState(DAILY_LIMIT);
  const [quotaRemainingPercent, setQuotaRemainingPercent] = useState(100);
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(Math.floor(SESSION_DURATION_MS / 1000));
  const [dailyResetSecondsLeft, setDailyResetSecondsLeft] = useState(getDailyResetSecondsLeft);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionActiveRef = useRef(false);
  const sessionIdRef = useRef(createSessionId());
  const releaseTimeoutRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const pressActiveRef = useRef(false);
  const pipelineTimeoutRef = useRef<number | null>(null);
  const lastInputRef = useRef<string>('');
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const speechRecognitionAvailable = useMemo(
    () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );

  const refreshUsageStats = () => {
    const stats = getDailyUsageStats();
    setDailyRemaining(stats.remaining);
    setQuotaRemainingPercent(stats.remainingPercent);
  };

  const tr = (key: string) => t(language, key);

  useEffect(() => {
    refreshUsageStats();
    const sessionEnd = Date.now() + SESSION_DURATION_MS;

    const cleanupSession = startSession(
      () => showError('error_session_warning', false),
      () => showError('error_session_ended', true),
    );

    const timer = window.setInterval(() => {
      const leftMs = Math.max(0, sessionEnd - Date.now());
      setSessionSecondsLeft(Math.ceil(leftMs / 1000));
      setDailyResetSecondsLeft(getDailyResetSecondsLeft());
      refreshUsageStats();
    }, 1000);

    const onHidden = () => {
      if (!document.hidden) {
        return;
      }
      stopRecording();
      setVoiceState('idle');
    };

    document.addEventListener('visibilitychange', onHidden);

    return () => {
      window.clearInterval(timer);
      cleanupSession();
      stopRecording();
      stopSpeaking();
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  useEffect(() => {
    if (!errorKey || errorKey === 'error_daily_limit' || errorKey === 'error_session_ended') {
      return;
    }

    const timer = window.setTimeout(() => {
      setErrorKey(null);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [errorKey]);

  useEffect(() => {
    if (voiceState !== 'speaking' || !replyText) {
      return;
    }

    if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      setSpeakingProgress(100);
      setStatusMessage(tr('state_speaking'));
      setVoiceState('idle');
      return;
    }

    stopSpeaking();
    setSpeakingProgress(0);
    const utterance = new SpeechSynthesisUtterance(replyText);
    utterance.lang = language;
    utterance.rate = 0.95;
    utterance.onstart = () => setStatusMessage(tr('state_speaking'));
    utterance.onend = () => {
      setSpeakingProgress(100);
      if (voiceState === 'speaking') {
        setVoiceState('idle');
      }
    };
    utterance.onerror = () => {
      // Browsers can reject/interrupt speech synthesis (autoplay policy, voice availability).
      // Treat this as non-fatal and return to idle instead of showing the red error panel.
      setSpeakingProgress(100);
      setStatusMessage(tr('state_speaking'));
      setVoiceState('idle');
    };
    window.speechSynthesis.speak(utterance);

    return () => {
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    };
  }, [voiceState, replyText, language]);

  useEffect(() => {
    if (voiceState !== 'speaking') {
      setSpeakingProgress(0);
      return;
    }

    const interval = window.setInterval(() => {
      setSpeakingProgress(current => (current >= 92 ? current : current + 2));
    }, 120);

    return () => window.clearInterval(interval);
  }, [voiceState]);

  useEffect(() => {
    return () => {
      if (pickerPreviewUrl) {
        URL.revokeObjectURL(pickerPreviewUrl);
      }
    };
  }, [pickerPreviewUrl]);

  function showError(key: ErrorKey, persistent: boolean) {
    setErrorKey(key);
    setStatusMessage(tr(key));
    setVoiceState('error');

    if (persistent) {
      stopRecording();
      stopSpeaking();
    }
  }

  function stopSpeaking() {
    window.speechSynthesis.cancel();
  }

  function stopRecording() {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }

    if (releaseTimeoutRef.current !== null) {
      window.clearTimeout(releaseTimeoutRef.current);
      releaseTimeoutRef.current = null;
    }

    if (recognitionRef.current && recognitionActiveRef.current) {
      recognitionRef.current.stop();
      recognitionActiveRef.current = false;
    }
  }

  function ensureRecognition(): SpeechRecognitionLike {
    const ctor = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!ctor) {
      throw new Error('SpeechRecognition unavailable');
    }

    if (!recognitionRef.current) {
      const recognition = new ctor();
      recognition.lang = language;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (releaseTimeoutRef.current !== null) {
          window.clearTimeout(releaseTimeoutRef.current);
          releaseTimeoutRef.current = null;
        }

        const text = event.results?.[0]?.[0]?.transcript?.trim() ?? '';
        if (!text) {
          showError('error_asr_failed', false);
          return;
        }
        setTranscript(text);
        void processRequest(text);
      };

      recognition.onerror = () => {
        showError('error_asr_failed', false);
      };

      recognition.onend = () => {
        if (releaseTimeoutRef.current !== null) {
          window.clearTimeout(releaseTimeoutRef.current);
          releaseTimeoutRef.current = null;
        }
        recognitionActiveRef.current = false;
      };

      recognitionRef.current = recognition;
    }

    recognitionRef.current.lang = language;
    return recognitionRef.current;
  }

  function startListening() {
    if (recognitionActiveRef.current || voiceState === 'processing' || voiceState === 'speaking') {
      return;
    }

    try {
      const recognition = ensureRecognition();
      setVoiceState('listening');
      setStatusMessage(tr('recording_start'));
      recognitionActiveRef.current = true;
      recognition.start();

      releaseTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
        showError('error_timeout', false);
      }, 10_000);
    } catch {
      showError('error_mic_permission', true);
    }
  }

  function onPressStart(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setErrorKey(null);
    pressActiveRef.current = true;

    if (!speechRecognitionAvailable) {
      setVoiceState('idle');
      setStatusMessage(tr('recording_not_supported'));
      return;
    }

    if (!canMakeRequest()) {
      showError('error_timeout', false);
      return;
    }

    holdTimeoutRef.current = window.setTimeout(() => {
      if (!pressActiveRef.current) {
        return;
      }
      recordRequest();
      startListening();
    }, HOLD_TO_RECORD_MS);
  }

  function onPressEnd(event: React.PointerEvent<HTMLButtonElement>) {
    pressActiveRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }

    if (!recognitionActiveRef.current) {
      return;
    }

    stopRecording();
    setStatusMessage(tr('recording_end'));
  }

  async function processRequest(rawText: string) {
    lastInputRef.current = rawText;

    if (!checkAndIncrementDaily()) {
      showError('error_daily_limit', true);
      return;
    }

    refreshUsageStats();

    const { text, truncated } = sanitizeInput(rawText);
    if (truncated) {
      showError('error_input_too_long', false);
    }

    setVoiceState('processing');
    setStatusMessage(tr('sending'));

    if (pipelineTimeoutRef.current !== null) {
      window.clearTimeout(pipelineTimeoutRef.current);
    }

    pipelineTimeoutRef.current = window.setTimeout(() => {
      showError('error_timeout', false);
    }, PIPELINE_TIMEOUT_MS);

    try {
      const result = await runPipeline(text, sessionIdRef.current, language, REQUEST_TIMEOUT_MS);

      if (pipelineTimeoutRef.current !== null) {
        window.clearTimeout(pipelineTimeoutRef.current);
        pipelineTimeoutRef.current = null;
      }

      setReplyText(result.replyText);
      setStatusMessage(tr('server_ok'));
      setVoiceState('speaking');
    } catch (error) {
      showError('orchestration_error', false);
    }
  }

  function onRetry() {
    setErrorKey(null);
    if (lastInputRef.current) {
      void processRequest(lastInputRef.current);
    }
  }

  function applyLanguage(nextLanguage: string) {
    setLanguage(nextLanguage);
    persistLanguage(nextLanguage);
    sessionIdRef.current = createSessionId();
    setSettingsOpen(false);
  }

  function onWatchAdReward() {
    grantAdRewardCommands(5);
    refreshUsageStats();
    setStatusMessage('Reward unlocked: +5 commands');
  }

  function onImagePickerClick() {
    imageInputRef.current?.click();
  }

  function onImagePickerFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      showError('error_upload_failed', false);
      event.target.value = '';
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setPickerPreviewUrl(previous => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return nextPreviewUrl;
    });
    setErrorKey(null);
    setStatusMessage(`Image ready: ${file.name}`);
    event.target.value = '';
  }

  function onOpenLoginScreen() {
    setSettingsOpen(false);
    setUpgradeOpen(false);
    setLoginOpen(true);
  }

  const voiceHeading =
    voiceState === 'listening'
      ? tr('state_listening')
      : voiceState === 'processing'
        ? tr('state_processing')
        : voiceState === 'speaking'
          ? tr('state_speaking')
          : voiceState === 'error'
            ? tr('error_banner_title')
            : 'Ready for Input';

  const isVoiceScreenVisible = !settingsOpen && !upgradeOpen && !loginOpen;
  const showUsageIndicators = isVoiceScreenVisible;

  return (
    <div className="app-shell">
      <div className="app-bg-grid" aria-hidden />
      <div className="app-bg-glow-cyan" aria-hidden />
      <div className="app-bg-glow-magenta" aria-hidden />

      <HeaderSection
        isPremiumUser={isPremiumUser}
        onOpenLoginScreen={onOpenLoginScreen}
        onToggleSettings={() => setSettingsOpen(!settingsOpen)}
      />

      <main className="voice-area">
        {!isPremiumUser ? (
          <PremiumGateSection onUpgrade={() => setUpgradeOpen(true)} />
        ) : null}

        <VoiceStageSection
          voiceState={voiceState}
          errorKey={errorKey}
          speechRecognitionAvailable={speechRecognitionAvailable}
          isPremiumUser={isPremiumUser}
          pickerPreviewUrl={pickerPreviewUrl}
          transcript={transcript}
          replyText={replyText}
          speakingProgress={speakingProgress}
          voiceHeading={voiceHeading}
          tr={tr}
          imageInputRef={imageInputRef}
          onPressStart={onPressStart}
          onPressEnd={onPressEnd}
          onImagePickerClick={onImagePickerClick}
          onImagePickerFileChange={onImagePickerFileChange}
          onRetry={onRetry}
          onDismissError={() => setErrorKey(null)}
        />

        <UsageSection
          isPremiumUser={isPremiumUser}
          showUsageIndicators={showUsageIndicators}
          dailyRemaining={dailyRemaining}
          dailyLimit={DAILY_LIMIT}
          quotaRemainingPercent={quotaRemainingPercent}
          dailyResetLabel={formatCountdown(dailyResetSecondsLeft)}
          onWatchAdReward={onWatchAdReward}
        />
      </main>

      <BottomNavSection
        isPremiumUser={isPremiumUser}
        onOpenUpgrade={() => setUpgradeOpen(true)}
      />

      {upgradeOpen ? (
        <UpgradePanel
          onClose={() => setUpgradeOpen(false)}
          dailyRemaining={dailyRemaining}
          dailyLimit={DAILY_LIMIT}
        />
      ) : null}

      <SettingsOverlay
        isOpen={settingsOpen}
        language={language}
        tr={tr}
        supportedLanguages={SUPPORTED_LANGUAGES}
        onClose={() => setSettingsOpen(false)}
        onApplyLanguage={applyLanguage}
      />

      <LoginOverlay
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
      />
    </div>
  );
}

function getWebTestPlanOverride(): WebTestPlan {
  const env = (import.meta as any).env as Record<string, string | undefined> | undefined;
  const raw = env?.VITE_WEB_TEST_PLAN?.trim().toLowerCase();
  if (raw === 'free' || raw === 'pro' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

function createSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getDailyResetSecondsLeft(): number {
  const nowMs = Date.now();
  const gmt2OffsetMs = 2 * 60 * 60 * 1000;
  const gmt2Now = new Date(nowMs + gmt2OffsetMs);
  const nextGmt2MidnightMs =
    Date.UTC(gmt2Now.getUTCFullYear(), gmt2Now.getUTCMonth(), gmt2Now.getUTCDate() + 1, 0, 0, 0) -
    gmt2OffsetMs;
  return Math.max(0, Math.ceil((nextGmt2MidnightMs - nowMs) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((safe % 3600) / 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${minutes}`;
}

declare global {
  interface Window {
    SpeechRecognition?: {
      new (): SpeechRecognitionLike;
    };
    webkitSpeechRecognition?: {
      new (): SpeechRecognitionLike;
    };
  }
}

