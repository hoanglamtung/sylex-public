/**
 * routineScheduleService — #238
 *
 * Schedules and cancels local @notifee notifications for time-based routine triggers.
 *
 * Notification behaviour:
 *  - Android: high-priority heads-up notification with a dedicated channel.
 *  - iOS:     alert + sound.
 *  - Tap deep-links into RoutineExecution for the matching routine.
 *
 * Each routine gets a deterministic notification ID derived from its routineId
 * so we can cancel/reschedule without storing extra state.
 */

import notifee, {
  type Notification,
  AndroidImportance,
  TriggerType,
  TimestampTrigger,
} from '@notifee/react-native';

const CHANNEL_ID = 'routine_triggers';
const CHANNEL_NAME = 'Routine Triggers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deterministic notification ID: stable across reschedule/cancel calls.
 * Must be ≤ 64 chars.
 */
function notifId(routineId: string): string {
  return `routine_${routineId}`;
}

const ROUTINE_TRIGGER_KIND = 'routine_trigger';

export type RoutineNotificationTarget = {
  routineId: string;
  category: 'template' | 'custom';
};

/**
 * Compute the next timestamp (ms since epoch) for a given HH:MM and weekday set.
 * Returns null when repeatDays is empty (one-shot not yet supported).
 */
function nextTimestamp(triggerTime: string, repeatDays: number[]): number | null {
  if (repeatDays.length === 0) return null;

  const [hStr, mStr] = triggerTime.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  const now = new Date();
  const today = now.getDay(); // 0=Sun … 6=Sat

  // Find the nearest matching weekday (today counts if time hasn't passed yet).
  for (let offset = 0; offset < 7; offset++) {
    const candidateDay = (today + offset) % 7;
    if (!repeatDays.includes(candidateDay)) continue;

    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(h, m, 0, 0);

    if (candidate.getTime() > now.getTime()) {
      return candidate.getTime();
    }
  }
  // All days passed for today (shouldn't happen with 7 day window), fall back to +7 days.
  const fallback = new Date(now);
  fallback.setDate(now.getDate() + 7);
  fallback.setHours(h, m, 0, 0);
  return fallback.getTime();
}

function parseRepeatDays(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map(v => Number(v))
    .filter(v => Number.isInteger(v) && v >= 0 && v <= 6);
}

function parseCategory(value: string | undefined): 'template' | 'custom' {
  return value === 'template' ? 'template' : 'custom';
}

function parseRoutinePayload(notification?: Notification | null): {
  routineId: string;
  category: 'template' | 'custom';
  routineName: string;
  triggerTime: string;
  repeatDays: number[];
} | null {
  const data = notification?.data;
  if (!data || data.kind !== ROUTINE_TRIGGER_KIND) return null;

  const routineId = data.routineId;
  const routineName = data.routineName;
  const triggerTime = data.triggerTime;
  if (!routineId || !routineName || !triggerTime) return null;

  const repeatDays = parseRepeatDays(data.repeatDays);
  if (repeatDays.length === 0) return null;

  return {
    routineId,
    category: parseCategory(data.category),
    routineName,
    triggerTime,
    repeatDays,
  };
}

/** Ensure the Android notification channel exists. */
async function ensureChannel(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedule (or reschedule) a local notification for a routine's trigger time.
 * Safe to call on every save — cancels any existing notification first.
 *
 * @param routineId  Firestore routine ID
 * @param routineName  Display name for the notification body
 * @param triggerTime  "HH:MM" 24-hour local time
 * @param repeatDays  0=Sun … 6=Sat; must have ≥1 entry
 * @param category  'template' | 'custom'
 */
export async function scheduleRoutineTrigger(
  routineId: string,
  routineName: string,
  triggerTime: string,
  repeatDays: number[],
  category: 'template' | 'custom',
): Promise<void> {
  if (repeatDays.length === 0) return; // nothing to schedule

  const timestamp = nextTimestamp(triggerTime, repeatDays);
  if (!timestamp) return;

  await cancelRoutineTrigger(routineId); // clear previous
  await ensureChannel();

  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp,
  };

  await notifee.createTriggerNotification(
    {
      id: notifId(routineId),
      title: routineName,
      body: 'Time to run your routine. Tap to start.',
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_notification',
        pressAction: {
          id: 'open_routine',
          launchActivity: 'default',
        },
      },
      // Data payload picked up by the background handler to navigate.
      data: {
        kind: ROUTINE_TRIGGER_KIND,
        routineId,
        category,
        routineName,
        triggerTime,
        repeatDays: repeatDays.join(','),
      },
    },
    trigger,
  );
}

/**
 * Returns RoutineExecution navigation target when a routine notification is pressed.
 */
export function getRoutineNotificationTarget(
  notification?: Notification | null,
): RoutineNotificationTarget | null {
  const payload = parseRoutinePayload(notification);
  if (!payload) return null;
  return {
    routineId: payload.routineId,
    category: payload.category,
  };
}

/**
 * Re-schedules the next routine trigger after the current one is delivered.
 * Uses one-shot scheduling to support arbitrary repeat-day sets correctly.
 */
export async function handleRoutineNotificationDelivery(
  notification?: Notification | null,
): Promise<void> {
  const payload = parseRoutinePayload(notification);
  if (!payload) return;

  await scheduleRoutineTrigger(
    payload.routineId,
    payload.routineName,
    payload.triggerTime,
    payload.repeatDays,
    payload.category,
  );
}

/**
 * Cancel a scheduled notification for a routine.
 * Safe to call even if no notification exists.
 */
export async function cancelRoutineTrigger(routineId: string): Promise<void> {
  try {
    await notifee.cancelTriggerNotification(notifId(routineId));
  } catch {
    // ignore — notification may not exist
  }
}

/** Cancel ALL routine trigger notifications (called from Clear All Data). */
export async function cancelAllRoutineTriggers(): Promise<void> {
  try {
    const notifications = await notifee.getTriggerNotifications();
    const routineIds = notifications
      .map(n => n.notification.id ?? '')
      .filter(id => id.startsWith('routine_'));
    await Promise.all(routineIds.map(id => notifee.cancelTriggerNotification(id)));
  } catch {
    // ignore
  }
}
