import { useState, useCallback, useRef, useEffect } from 'react';
import i18n from '../i18n';

export type ErrorType =
  | 'error_network'
  | 'error_timeout'
  | 'error_mic_permission'
  | 'error_upload_failed'
  | 'error_asr_failed'
  | 'error_llm_failed'
  | 'error_tts_failed'
  | 'orchestration_error'
  | 'error_daily_limit'
  | 'error_session_warning'
  | 'error_session_ended'
  | 'error_input_too_long'
  | 'error_premium_required';

export interface ErrorState {
  type: ErrorType | null;
  message: string;
  visible: boolean;
}

export interface ErrorRecovery {
  error: ErrorState;
  showError: (type: ErrorType, onRetry?: () => void) => void;
  dismiss: () => void;
  retry: () => void;
}

const AUTO_DISMISS_DELAY_MS = 5000;

// Error types that should not auto-dismiss
const PERSISTENT_ERRORS: ErrorType[] = [
  'error_daily_limit',
  'error_session_ended',
  'error_mic_permission',
];

export function useErrorRecovery(): ErrorRecovery {
  const [error, setError] = useState<ErrorState>({ type: null, message: '', visible: false });
  const retryCallbackRef = useRef<(() => void) | null>(null);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDismissTimer = useCallback(() => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
  }, []);

  const showError = useCallback((type: ErrorType, onRetry?: () => void) => {
    clearDismissTimer();
    retryCallbackRef.current = onRetry ?? null;
    const message = i18n.t(type);
    setError({ type, message, visible: true });

    if (!PERSISTENT_ERRORS.includes(type)) {
      autoDismissRef.current = setTimeout(() => {
        setError(prev => ({ ...prev, visible: false }));
      }, AUTO_DISMISS_DELAY_MS);
    }
  }, [clearDismissTimer]);

  const dismiss = useCallback(() => {
    clearDismissTimer();
    setError({ type: null, message: '', visible: false });
  }, [clearDismissTimer]);

  const retry = useCallback(() => {
    dismiss();
    retryCallbackRef.current?.();
  }, [dismiss]);

  useEffect(() => () => clearDismissTimer(), [clearDismissTimer]);

  return { error, showError, dismiss, retry };
}
