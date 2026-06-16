/**
 * RoutineService — #130
 *
 * Firestore CRUD for custom voice routines.
 * Collection: /users/{uid}/routines/{routineId}
 *
 * Templates (ROUTINE_TEMPLATES) are never stored here — they live in
 * src/types/routine.ts and are bundled with the app.
 */

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
} from '@react-native-firebase/firestore';
import { VoiceRoutine, RoutineDraft } from '../types/routine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function routinesCol(uid: string) {
  return collection(getFirestore(), 'users', uid, 'routines');
}

function computeDuration(tasks: RoutineDraft['tasks']): number {
  return tasks.reduce((sum, t) => sum + (t.durationSeconds ?? 30), 0);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Creates a new custom routine in Firestore and returns the persisted object.
 */
export async function createRoutine(uid: string, draft: RoutineDraft): Promise<VoiceRoutine> {
  const now = Timestamp.now();
  const docRef = doc(routinesCol(uid));
  const routine: VoiceRoutine = {
    id: docRef.id,
    category: 'custom',
    name: draft.name,
    triggerPhrase: draft.triggerPhrase,
    tasks: draft.tasks,
    estimatedDurationSeconds: computeDuration(draft.tasks),
    triggerTime: draft.triggerTime,
    repeatDays: draft.repeatDays,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(docRef, routine);
  return routine;
}

/**
 * Partially updates an existing custom routine.
 * Re-computes estimatedDurationSeconds when tasks change.
 */
export async function updateRoutine(
  uid: string,
  routineId: string,
  draft: Partial<RoutineDraft>,
): Promise<void> {
  const now = Timestamp.now();
  const patch: Record<string, unknown> = { updatedAt: now };

  // Firestore rejects undefined values. When a key is present with undefined,
  // treat it as an explicit field removal request (used when disabling schedule).
  Object.keys(draft).forEach((key) => {
    const value = (draft as Record<string, unknown>)[key];
    patch[key] = value === undefined ? deleteField() : value;
  });

  if (draft.tasks) {
    patch.estimatedDurationSeconds = computeDuration(draft.tasks);
  }
  await updateDoc(doc(routinesCol(uid), routineId), patch);
}

/**
 * Permanently deletes a custom routine.
 */
export async function deleteRoutine(uid: string, routineId: string): Promise<void> {
  await deleteDoc(doc(routinesCol(uid), routineId));
}

/**
 * One-shot fetch of all custom routines, newest first.
 */
export async function getRoutines(uid: string): Promise<VoiceRoutine[]> {
  const snap = await getDocs(query(routinesCol(uid), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => d.data() as VoiceRoutine);
}

/**
 * Real-time subscription to the user's custom routines.
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function subscribeRoutines(
  uid: string,
  callback: (routines: VoiceRoutine[]) => void,
): () => void {
  return onSnapshot(
    query(routinesCol(uid), orderBy('createdAt', 'desc')),
    snap => {
      if (!snap) return; // null guard: can occur on offline/cache miss
      callback(snap.docs.map(d => d.data() as VoiceRoutine));
    },
    _error => {
      // Firestore error (offline, permissions) — silently retain last state
    },
  );
}

/**
 * Duplicates any routine (template or custom) into the user's collection.
 * The copy is prefixed with the source name + " (copy)".
 * Task IDs are regenerated to keep them unique within the new routine.
 */
export async function duplicateRoutine(
  uid: string,
  source: VoiceRoutine,
): Promise<VoiceRoutine> {
  return createRoutine(uid, {
    name: `${source.name} (copy)`,
    triggerPhrase: source.triggerPhrase,
    tasks: source.tasks.map(t => ({
      ...t,
      id: Math.random().toString(36).slice(2),
    })),
  });
}
