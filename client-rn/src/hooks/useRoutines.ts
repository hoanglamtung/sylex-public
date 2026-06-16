/**
 * useRoutines — #130
 *
 * React hook that exposes the full routine data layer to screens.
 * Merges the static ROUTINE_TEMPLATES with the user's real-time Firestore
 * custom routines.
 *
 * Usage:
 *   const { templates, customRoutines, loading, create, update, remove, duplicate } = useRoutines(uid);
 */

import { useCallback, useEffect, useState } from 'react';
import { VoiceRoutine, RoutineDraft, ROUTINE_TEMPLATES } from '../types/routine';
import {
  createRoutine,
  deleteRoutine,
  duplicateRoutine,
  subscribeRoutines,
  updateRoutine,
} from '../services/routineService';
import {
  scheduleRoutineTrigger,
  cancelRoutineTrigger,
} from '../services/routineScheduleService';

export interface UseRoutinesResult {
  /** Built-in templates — always available, never stored in Firestore. */
  templates: VoiceRoutine[];
  /** User's custom routines from Firestore (real-time). */
  customRoutines: VoiceRoutine[];
  /** True while the initial Firestore snapshot is in flight. */
  loading: boolean;
  /** Create a new custom routine. Rejects if uid is null. */
  create: (draft: RoutineDraft) => Promise<VoiceRoutine>;
  /** Update an existing custom routine by id. Rejects if uid is null. */
  update: (routineId: string, draft: Partial<RoutineDraft>) => Promise<void>;
  /** Delete a custom routine by id. Rejects if uid is null. */
  remove: (routineId: string) => Promise<void>;
  /** Duplicate any routine (template or custom) into the user's collection. */
  duplicate: (source: VoiceRoutine) => Promise<VoiceRoutine>;
}

export function useRoutines(uid: string | null | undefined): UseRoutinesResult {
  const [customRoutines, setCustomRoutines] = useState<VoiceRoutine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    const unsubscribe = subscribeRoutines(uid, data => {
      setCustomRoutines(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [uid]);

  const create = useCallback(
    async (draft: RoutineDraft): Promise<VoiceRoutine> => {
      if (!uid) return Promise.reject(new Error('Not authenticated'));
      const routine = await createRoutine(uid, draft);
      if (draft.triggerTime && draft.repeatDays && draft.repeatDays.length > 0) {
        await scheduleRoutineTrigger(
          routine.id, routine.name, draft.triggerTime, draft.repeatDays, 'custom',
        );
      }
      return routine;
    },
    [uid],
  );

  const update = useCallback(
    async (routineId: string, draft: Partial<RoutineDraft>): Promise<void> => {
      if (!uid) return Promise.reject(new Error('Not authenticated'));
      await updateRoutine(uid, routineId, draft);
      // Re-schedule or cancel depending on whether schedule fields are present.
      if ('triggerTime' in draft || 'repeatDays' in draft) {
        const routine = customRoutines.find(r => r.id === routineId);
        const time = draft.triggerTime ?? routine?.triggerTime;
        const days = draft.repeatDays ?? routine?.repeatDays ?? [];
        if (time && days.length > 0) {
          const name = draft.name ?? routine?.name ?? '';
          await scheduleRoutineTrigger(routineId, name, time, days, 'custom');
        } else {
          await cancelRoutineTrigger(routineId);
        }
      }
    },
    [uid, customRoutines],
  );

  const remove = useCallback(
    async (routineId: string): Promise<void> => {
      if (!uid) return Promise.reject(new Error('Not authenticated'));
      await cancelRoutineTrigger(routineId);
      return deleteRoutine(uid, routineId);
    },
    [uid],
  );

  const duplicate = useCallback(
    (source: VoiceRoutine) => {
      if (!uid) return Promise.reject(new Error('Not authenticated'));
      return duplicateRoutine(uid, source);
    },
    [uid],
  );

  return {
    templates: ROUTINE_TEMPLATES,
    customRoutines,
    loading,
    create,
    update,
    remove,
    duplicate,
  };
}
