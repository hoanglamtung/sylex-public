/**
 * Routine types — #130
 *
 * A VoiceRoutine is an ordered sequence of tasks that the assistant executes
 * when triggered by a phrase. Templates are bundled in-app; custom routines
 * live in Firestore at /users/{uid}/routines/{routineId}.
 */
import { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

// ─── Core types ───────────────────────────────────────────────────────────────

export interface RoutineTask {
  /** Unique within this routine (nanoid / random string). */
  id: string;
  /** Short human-readable description of what the assistant should do. */
  label: string;
  /** Estimated seconds for this step (used to compute total duration). */
  durationSeconds?: number;
}

export type RoutineCategory = 'template' | 'custom';

export interface VoiceRoutine {
  id: string;
  name: string;
  /** The phrase the user says to activate this routine. */
  triggerPhrase: string;
  category: RoutineCategory;
  tasks: RoutineTask[];
  /** Sum of all task durationSeconds (computed on write). */
  estimatedDurationSeconds: number;
  /**
   * Optional time-based schedule (#238).
   * triggerTime: "HH:MM" in local time (24-hour), e.g. "07:30".
   * repeatDays: array of weekday indices 0 (Sun) … 6 (Sat).
   *   Empty array = one-shot (not repeating — reserved for future use).
   *   Absent = no scheduled trigger.
   */
  triggerTime?: string;
  repeatDays?: number[];
  /** null for templates (not stored in Firestore). */
  createdAt: FirebaseFirestoreTypes.Timestamp | null;
  updatedAt: FirebaseFirestoreTypes.Timestamp | null;
}

/** Subset used to create or update a custom routine. */
export type RoutineDraft = Pick<VoiceRoutine, 'name' | 'triggerPhrase' | 'tasks'> & {
  triggerTime?: string;
  repeatDays?: number[];
};

// ─── Built-in templates ───────────────────────────────────────────────────────

/**
 * Three built-in template routines. IDs and step IDs mirror the server-side
 * BUILTIN_ROUTINES in routineService.js so that POST /v1/routines/:id/execute
 * resolves them correctly. Templates can be duplicated into a user's custom
 * collection via routineService.duplicateRoutine().
 */
export const ROUTINE_TEMPLATES: VoiceRoutine[] = [
  {
    id: 'morning',
    category: 'template',
    name: 'Morning Briefing',
    triggerPhrase: 'good morning',
    estimatedDurationSeconds: 55,
    tasks: [
      { id: 'weather',  label: 'Weather briefing',      durationSeconds: 15 },
      { id: 'calendar', label: 'Calendar summary',       durationSeconds: 20 },
      { id: 'traffic',  label: 'Traffic / commute tip',  durationSeconds: 20 },
    ],
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'evening',
    category: 'template',
    name: 'Evening Wind-Down',
    triggerPhrase: 'good evening',
    estimatedDurationSeconds: 90,
    tasks: [
      { id: 'day_summary', label: 'Day summary',      durationSeconds: 30 },
      { id: 'tomorrow',    label: 'Tomorrow preview', durationSeconds: 30 },
      { id: 'reminders',   label: 'Reminders check',  durationSeconds: 30 },
    ],
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'workday',
    category: 'template',
    name: 'Workday Focus',
    triggerPhrase: 'start workday',
    estimatedDurationSeconds: 75,
    tasks: [
      { id: 'meetings',     label: 'Meetings overview',   durationSeconds: 25 },
      { id: 'tasks',        label: 'Top tasks for today', durationSeconds: 25 },
      { id: 'focus_prompt', label: 'Focus motivation',    durationSeconds: 25 },
    ],
    createdAt: null,
    updatedAt: null,
  },
];
