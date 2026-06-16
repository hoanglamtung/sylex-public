/**
 * SyncService — #132
 *
 * Firestore CRUD wrapper for cross-device sync of preferences and
 * conversation history. Requires anonymous (or linked) Firebase Auth so
 * every user has a stable UID — see useAuth hook.
 *
 * Collections:
 *   /users/{uid}/preferences   — language, voice, theme settings
 *   /users/{uid}/conversations — conversation history (premium only)
 *
 * Offline support: Firestore's built-in offline persistence is enabled at
 * app startup (see initFirestore below). Reads/writes queue locally and
 * sync automatically on reconnect.
 */

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserPreferences {
  language: string;
  voice?: string;
  theme?: 'light' | 'dark' | 'system';
  updatedAt?: FirebaseFirestoreTypes.Timestamp;
}

/**
 * Written to /users/{uid} (the top-level user document) whenever the account
 * transitions from anonymous to a linked provider.  Also written on every
 * app launch so the record stays current without a separate migration step.
 */
export interface UserProfileDoc {
  displayName: string | null;
  /** Primary email — Google real address preferred over Apple private relay */
  email: string | null;
  /** Google provider email (real Gmail) — null when Google is not linked */
  googleEmail: string | null;
  /** Apple provider email (real or private relay) — null when Apple is not linked */
  appleEmail: string | null;
  /** Provider IDs observed on this account (e.g. ['google.com', 'apple.com']). */
  linkedProviderIds?: string[];
  /** 'apple' | 'google' | 'anonymous' */
  provider: string;
  updatedAt?: FirebaseFirestoreTypes.Timestamp;
}

export interface ConversationEntry {
  role: 'user' | 'assistant';
  text: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Call once at app startup (before any Firestore read/write).
 * Enables offline persistence so the app works without connectivity.
 */
export function initFirestore(): void {
  getFirestore().settings({
    persistence: true,
    cacheSizeBytes: -1, // CACHE_SIZE_UNLIMITED
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function db() {
  return getFirestore();
}

function prefsRef(uid: string) {
  return doc(db(), 'users', uid, 'preferences', 'main');
}

function historyRef(uid: string) {
  return collection(db(), 'users', uid, 'conversations');
}

function userDocRef(uid: string) {
  return doc(db(), 'users', uid);
}

// ─── Preferences ─────────────────────────────────────────────────────────────

/**
 * Write (merge) user preferences to Firestore.
 * Partial updates are safe — only supplied fields are overwritten.
 */
export async function savePreferences(
  uid: string,
  prefs: Partial<UserPreferences>,
): Promise<void> {
  await setDoc(
    prefsRef(uid),
    { ...prefs, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Read user preferences once (no listener).
 * Returns null when the document does not exist yet.
 */
export async function getPreferences(uid: string): Promise<UserPreferences | null> {
  const snap = await getDoc(prefsRef(uid));
  return snap.exists ? (snap.data() as UserPreferences) : null;
}

/**
 * Subscribe to real-time preference updates.
 * Returns an unsubscribe function — call it on component unmount.
 *
 * @example
 *   const unsub = subscribePreferences(uid, prefs => setPrefs(prefs));
 *   return () => unsub();
 */
export function subscribePreferences(
  uid: string,
  onChange: (prefs: UserPreferences | null) => void,
): () => void {
  return onSnapshot(prefsRef(uid), snap => {
    onChange(snap.exists ? (snap.data() as UserPreferences) : null);
  });
}

// ─── Conversation history (premium only) ─────────────────────────────────────

/**
 * Append a single message to the conversation history collection.
 * Each document is auto-ID'd and includes a server-side timestamp.
 */
export async function appendConversationEntry(
  uid: string,
  entry: Omit<ConversationEntry, 'createdAt'>,
): Promise<void> {
  await addDoc(historyRef(uid), {
    ...entry,
    createdAt: serverTimestamp(),
  });
}

/**
 * Fetch the N most recent conversation entries (newest first).
 */
export async function getRecentConversation(
  uid: string,
  limit = 20,
): Promise<ConversationEntry[]> {
  const snap = await getDocs(
    query(historyRef(uid), orderBy('createdAt', 'desc'), firestoreLimit(limit)),
  );
  return snap.docs.map(d => d.data() as ConversationEntry);
}

/**
 * Subscribe to real-time conversation history updates (newest first).
 * Returns an unsubscribe function.
 */
export function subscribeConversation(
  uid: string,
  limit: number,
  onChange: (entries: ConversationEntry[]) => void,
): () => void {
  return onSnapshot(
    query(historyRef(uid), orderBy('createdAt', 'desc'), firestoreLimit(limit)),
    snap => {
      onChange(snap.docs.map(d => d.data() as ConversationEntry));
    },
  );
}

/**
 * Delete all conversation history for the given user.
 * Runs in batches of 500 to stay within Firestore limits.
 */
export async function clearConversationHistory(uid: string): Promise<void> {
  const BATCH_SIZE = 500;
  let snap = await getDocs(query(historyRef(uid), firestoreLimit(BATCH_SIZE)));
  while (!snap.empty) {
    const batch = writeBatch(db());
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    snap = await getDocs(query(historyRef(uid), firestoreLimit(BATCH_SIZE)));
  }
}

// ─── User profile ─────────────────────────────────────────────────────────────

/**
 * Upsert the top-level /users/{uid} document with the user's identity.
 *
 * Called:
 *  - On every non-anonymous onAuthStateChanged so Firebase Console always
 *    shows a real user record (fixes #189 "nothing saved in Firebase").
 *  - After successfully linking or recovering a social-provider account.
 *
 * Uses merge:true so it never overwrites other fields (e.g. isPremium set
 * server-side via Cloud Functions).
 */
export async function writeUserProfile(
  uid: string,
  profile: Omit<UserProfileDoc, 'updatedAt'>,
): Promise<void> {
  await setDoc(
    userDocRef(uid),
    { ...profile, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Read saved profile data for a UID from /users/{uid}.
 *
 * Used as a Firestore fallback in onAuthStateChanged when Firebase providerData
 * is missing a provider email — e.g. a user re-signs in with Apple alone on an
 * account that was previously linked to Google. In that case providerData only
 * contains Apple, but the Google email was persisted here on the original link.
 *
 * Returns null on any error so the caller degrades gracefully (#192 comment 3).
 */
export async function readUserProfile(uid: string): Promise<Partial<UserProfileDoc> | null> {
  try {
    const snap = await getDoc(userDocRef(uid));
    if (!snap.exists) return null;
    return snap.data() as Partial<UserProfileDoc>;
  } catch {
    return null;
  }
}

/**
 * Merge a partial set of profile fields into /users/{uid}.
 * Safe to call even if the document does not exist yet (set + merge:true creates it).
 * Used when switching Firebase Auth accounts to carry over email/provider info
 * from the previous account (fixes #197 — split Firestore UIDs on Google→Apple login).
 */
export async function mergeProfileFields(
  uid: string,
  fields: Partial<Omit<UserProfileDoc, 'updatedAt'>>,
): Promise<void> {
  await setDoc(
    userDocRef(uid),
    { ...fields, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Copy preferences from an anonymous UID to a linked UID.
 *
 * Called in the `auth/credential-already-in-use` recovery path, where a
 * social sign-in switches the session from UID A (anonymous) to UID B
 * (linked).  Without this, the user's language/voice settings that were
 * accumulated under the anonymous account are lost (fixes #189 "3 UIDs").
 *
 * Only copies if `toUid` has no preferences yet — never overwrites.
 */
export async function migrateAnonymousPreferences(
  fromUid: string,
  toUid: string,
): Promise<void> {
  if (fromUid === toUid) return;
  try {
    // Read source from the LOCAL CACHE so this works even after auth has
    // already switched away from the anonymous session.  Security rules are
    // not evaluated for cache-only reads, which avoids the
    // `firestore/permission-denied` error that blocked sign-in (#189).
    const [sourceSnap, targetSnap] = await Promise.all([
      getDoc(prefsRef(fromUid)),
      getDoc(prefsRef(toUid)),
    ]);
    if (!sourceSnap.exists || targetSnap.exists) return;
    await setDoc(prefsRef(toUid), sourceSnap.data()!);
  } catch {
    // Migration is best-effort; silently skip so sign-in is never blocked.
  }
}
