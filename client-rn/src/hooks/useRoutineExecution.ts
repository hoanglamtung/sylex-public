/**
 * useRoutineExecution — #130 (routine activation feedback)
 *
 * Orchestrates step-by-step execution of a voice routine with TTS readback.
 *
 * Two execution paths:
 *  - Templates  → client-only: speaks each task label via TTS (no server call)
 *  - Custom     → POST /v1/routines/:id/execute → Gemini-generated responses → TTS
 *
 * Exposes step-level state so RoutineExecutionScreen can render real-time progress.
 */

import { useCallback, useRef, useState } from 'react';
import Tts from 'react-native-tts';
import { getAuth, getIdToken } from '@react-native-firebase/auth';
import type { RoutineTask, RoutineCategory } from '../types/routine';

const SERVER_ENDPOINT = 'https://api.car-assistant-pro.silverleaf.studio';
const API_VERSION = 'v1';

// ─── Public types ─────────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'active' | 'done' | 'failed';
export type ExecutionStatus = 'idle' | 'loading' | 'playing' | 'done' | 'error';

export interface ExecutionStep {
  stepId: string;
  order: number;
  /** Original task label (used for pending/active display). */
  label: string;
  /** Gemini-generated text, or label for templates/errors. Available after API returns. */
  text: string | null;
  status: StepStatus;
}

export interface UseRoutineExecutionResult {
  status: ExecutionStatus;
  steps: ExecutionStep[];
  /** Index of the currently speaking step, -1 when none. */
  activeIndex: number;
  errorMessage: string | null;
  run: () => Promise<void>;
  stop: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInitialSteps(tasks: RoutineTask[]): ExecutionStep[] {
  return tasks.map((t, i) => ({
    stepId: t.id,
    order: i + 1,
    label: t.label,
    text: null,
    status: 'pending',
  }));
}

function speakAndWait(text: string): Promise<void> {
  return new Promise(resolve => {
    // Use subscription objects returned by addEventListener — Tts.removeEventListener
    // relies on NativeEventEmitter.removeListener which no longer exists in RN 0.73+.
    let finishSub: ReturnType<typeof Tts.addEventListener> | null = null;
    let errorSub:  ReturnType<typeof Tts.addEventListener> | null = null;
    let cancelSub: ReturnType<typeof Tts.addEventListener> | null = null;

    const cleanup = () => {
      finishSub?.remove();
      errorSub?.remove();
      cancelSub?.remove();
    };

    const done = () => { cleanup(); resolve(); };

    finishSub = Tts.addEventListener('tts-finish', done);
    errorSub  = Tts.addEventListener('tts-error',  done);
    // tts-cancel fires when Tts.stop() is called — must resolve or the loop hangs
    cancelSub = Tts.addEventListener('tts-cancel', done);
    Tts.speak(text);
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRoutineExecution(
  routineId: string,
  category: RoutineCategory,
  tasks: RoutineTask[],
): UseRoutineExecutionResult {
  const [status, setStatus] = useState<ExecutionStatus>('idle');
  const [steps, setSteps] = useState<ExecutionStep[]>(() => buildInitialSteps(tasks));
  const [activeIndex, setActiveIndex] = useState(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    Tts.stop();
    setStatus('done');
  }, []);

  const run = useCallback(async () => {
    stoppedRef.current = false;
    setErrorMessage(null);
    setActiveIndex(-1);
    setSteps(buildInitialSteps(tasks));
    setStatus('loading');

    try {
      type ResolvedStep = { label: string; text: string; hasError: boolean };

      // All routines — templates and custom — execute via the server.
      // Built-in templates (morning/evening/workday) are resolved server-side
      // without requiring premium. Custom routines require premium (enforced
      // by the server).
      const user = getAuth().currentUser;
      if (!user) throw new Error('Please sign in to run routines.');
      const idToken = await getIdToken(user);

      const res = await fetch(
        `${SERVER_ENDPOINT}/${API_VERSION}/routines/${routineId}/execute`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ context: {} }),
        },
      );

      if (!res.ok) {
        const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Server error ${res.status}`);
      }

      const data: {
        steps: Array<{ stepId: string; order: number; text: string; error?: boolean }>;
      } = await res.json();

      // Build resolved from the server response so execution works even when
      // the client-side `tasks` array hasn't loaded yet from Firestore.
      const serverSteps = [...(data.steps ?? [])].sort((a, b) => a.order - b.order);
      const resolved: ResolvedStep[] = serverSteps.map(srv => {
        const clientTask = tasks.find(t => t.id === srv.stepId);
        return {
          label: clientTask?.label ?? `Step ${srv.order}`,
          text: srv.text,
          hasError: srv.error ?? false,
        };
      });

      setStatus('playing');

      // Sequential TTS readback + visual step tracking
      for (let i = 0; i < resolved.length; i++) {
        if (stoppedRef.current) break;

        const step = resolved[i];

        setActiveIndex(i);
        // Use updater form so we can preserve 'failed' status for already-processed
        // error steps instead of blindly reverting them to 'done'.
        setSteps(prev =>
          resolved.map((r, idx) => ({
            stepId: serverSteps[idx]?.stepId ?? `step_${idx}`,
            order: idx + 1,
            label: r.label,
            text: r.text,
            status: idx < i
              ? (prev[idx]?.status === 'failed' ? 'failed' : 'done')
              : idx === i ? 'active' : 'pending',
          })),
        );

        if (!step.hasError) {
          await speakAndWait(step.text);
        }

        if (!stoppedRef.current) {
          setSteps(prev =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: step.hasError ? 'failed' : 'done' } : s,
            ),
          );
        }
      }

      if (!stoppedRef.current) {
        setActiveIndex(-1);
        setStatus('done');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Routine could not be executed.';
      setErrorMessage(msg);
      setStatus('error');
    }
  }, [routineId, tasks]);

  return { status, steps, activeIndex, errorMessage, run, stop };
}
