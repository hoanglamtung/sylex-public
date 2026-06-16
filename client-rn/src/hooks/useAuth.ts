/**
 * useAuth — #132 / #140
 *
 * Manages Firebase Auth state for cross-device sync.
 *
 * Flow:
 *   1. Every install signs in anonymously — stable UID from day one.
 *   2. On premium purchase, the anonymous account is *linked* to a social
 *      provider (Apple / Google) or email — the UID is preserved so all
 *      Firestore data survives the upgrade.
 *   3. On reinstall, re-signing in with the same Apple/Google account
 *      recovers the existing UID and all associated data.
 *
 * Sign in with Apple is required on iOS (App Store Guideline 4.8) whenever
 * any third-party or email login is offered.
 *
 * Setup required before use (see #140):
 *   iOS  — "Sign in with Apple" capability in Xcode + Apple provider in Firebase Console
 *   Android/iOS — Google OAuth client IDs in google-services.json / GoogleService-Info.plist
 *                 + Google provider in Firebase Console
 */

import { useState, useEffect } from 'react';
import {
  getAuth,
  onIdTokenChanged,
  signInAnonymously,
  signInWithCredential,
  signOut as firebaseSignOut,
  linkWithCredential,
  getIdTokenResult,
  updateProfile,
  AppleAuthProvider,
  GoogleAuthProvider,
} from '@react-native-firebase/auth';
import { writeUserProfile, readUserProfile, migrateAnonymousPreferences, mergeProfileFields } from '../services/syncService';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import {
  appleAuth,
} from '@invertase/react-native-apple-authentication';
import {
  GoogleSignin,
} from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureGet, secureSet, secureRemove, SecureKeys } from '../services/secureStorage';

// ─── DEV premium override ─────────────────────────────────────────────────────
// In __DEV__ mode, allow forcing isPremium via AsyncStorage so premium features
// (Hey Sylex, /v1/voice/text pipeline) can be tested on dev builds where StoreKit
// sandbox doesn't see production App Store subscriptions.
export const DEV_PREMIUM_OVERRIDE_KEY = '@devPremiumOverride';

// ─── Secure storage key for Apple User ID ────────────────────────────────────
// Stored via react-native-encrypted-storage (#246). Previously used react-native-keychain.

// ─── Nonce helpers ────────────────────────────────────────────────────────────

/**
 * Generates a random nonce string using Math.random.
 * Suitable for single-use Apple Sign-In nonces.
 */
function generateNonce(length = 32): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthProvider = 'anonymous' | 'apple' | 'google';

export interface AuthState {
  user: FirebaseAuthTypes.User | null;
  uid: string | null;
  isAnonymous: boolean;
  /** True once the account has been linked to Apple or Google */
  isLinked: boolean;
  provider: AuthProvider;
  /** True if the Firebase Auth custom claim `isPremium` is set (server-set on purchase).
   *  In __DEV__ mode, this may be overridden via the DEV_PREMIUM_OVERRIDE_KEY toggle. */
  isPremium: boolean;
  /** Raw Firebase claim value — NOT affected by DEV override.
   *  Pass this to server-facing pipelines (e.g. /v1/voice/text) that the server also gates. */
  isClaimPremium: boolean;
  loading: boolean;
  error: string | null;
  /** Display name from the linked provider (Apple full name or Google display name) */
  displayName: string | null;
  /**
   * Email of the currently linked sign-in provider.
   * Google: real Gmail address. Apple: private relay or real address.
   */
  signedEmail: string | null;
  /**
   * Email associated with the premium purchase.
   * On iOS, App Store purchases are tied to the Apple ID.
   * When the user is signed in with Google but paid via iOS IAP,
   * this is the Apple provider email (if Apple is also linked), otherwise null.
   */
  buyerEmail: string | null;
  /** Photo URL from Google profile (Apple does not provide a photo) */
  photoURL: string | null;
  /** All Firebase provider IDs linked to this account (e.g. ['google.com', 'apple.com']) */
  linkedProviders: string[];
}

export interface AuthActions {
  /** Link anonymous account to Apple ID (iOS only — required by App Store) */
  linkWithApple: () => Promise<void>;
  /** Link anonymous account to Google account (iOS + Android) */
  linkWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Force-refresh the Firebase ID token and re-read the isPremium claim (#205) */
  refreshPremium: () => Promise<void>;
}

// ─── Google Sign-In config ────────────────────────────────────────────────────
// webClientId comes from google-services.json (Android) / GoogleService-Info.plist (iOS)
// Must be configured before first use — typically called at app startup.
export function configureGoogleSignIn(webClientId: string): void {
  GoogleSignin.configure({ webClientId });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState & AuthActions {
  const [user, setUser]       = useState<FirebaseAuthTypes.User | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isClaimPremium, setIsClaimPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  // Firestore-enriched provider emails (#192 comment 3 — survive re-login with single provider)
  const [storedGoogleEmail, setStoredGoogleEmail] = useState<string | null>(null);
  const [storedAppleEmail,  setStoredAppleEmail]  = useState<string | null>(null);
  const [storedLinkedProviderIds, setStoredLinkedProviderIds] = useState<string[]>([]);

  useEffect(() => {
    // onIdTokenChanged is a superset of onAuthStateChanged — it fires on
    // sign-in/sign-out AND on every token refresh (including the force-refresh
    // inside refreshPremium()). This ensures ALL useAuth() instances across
    // the app (HomeScreen, UpgradeScreen, etc.) update isPremium immediately
    // when any instance calls refreshPremium() — fixes Android IAP restore (#219).
    const unsubscribe = onIdTokenChanged(getAuth(), async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          // forceRefresh=true so the server-set isPremium claim is always
          // up-to-date on app launch / sign-in, not a stale cached token (#205).
          const tokenResult = await getIdTokenResult(firebaseUser, true);
          const claimPremium = !!tokenResult.claims.isPremium;
          console.log('[Auth] uid:', firebaseUser.uid, 'isAnonymous:', firebaseUser.isAnonymous, 'claim.isPremium:', claimPremium);

          // __DEV__ override: in development builds, default to premium ON so dev
          // testing of hands-free, modes, etc. works without a real subscription.
          // Only disable if the user explicitly toggled the DEV switch OFF in Settings.
          // Sets BOTH isPremium and isClaimPremium so the entire app behaves
          // consistently — UI, pipeline routing, and feature gates all agree.
          if (__DEV__) {
            const devOverride = await AsyncStorage.getItem(DEV_PREMIUM_OVERRIDE_KEY);
            // devOverride: null (never set) or 'true' → premium ON; 'false' → premium OFF
            const devPremium = devOverride !== 'false';
            if (devPremium && !claimPremium) {
              console.log('[Auth] __DEV__ premium override ACTIVE — treating as premium (claim + UI)');
            }
            const effectivePremium = devPremium || claimPremium;
            setIsPremium(effectivePremium);
            setIsClaimPremium(effectivePremium);
          } else {
            setIsPremium(claimPremium);
            setIsClaimPremium(claimPremium);
          }
        } catch (e) {
          console.warn('[Auth] getIdTokenResult failed:', e);
          setIsClaimPremium(false);
          setIsPremium(false);
        }
        setLoading(false);

        // Write a Firestore user profile document for every non-anonymous user so
        // Firebase Console shows a real record (fixes #189 comment 2).
        // Runs on every app launch but uses merge:true so it never overwrites
        // other fields (e.g. isPremium set by Cloud Functions server-side).
        if (!firebaseUser.isAnonymous) {
          const providerIds = firebaseUser.providerData.map(p => p.providerId);
          const provider = providerIds.includes('apple.com')
            ? 'apple'
            : providerIds.includes('google.com')
              ? 'google'
              : 'anonymous';
          const googleData = firebaseUser.providerData.find(p => p.providerId === 'google.com');
          const appleData  = firebaseUser.providerData.find(p => p.providerId === 'apple.com');
          const stored = await readUserProfile(firebaseUser.uid);

          // Supplement missing provider emails from Firestore (#192 comment 3).
          // This covers the case where a user signs back in with a single provider
          // (e.g. Apple) on an account that was previously linked to both Apple and
          // Google — Firebase providerData only returns Apple in that session, but
          // the Google email was saved to Firestore on the original link.
          let enrichedGoogleEmail: string | null = googleData?.email ?? null;
          let enrichedAppleEmail:  string | null = appleData?.email  ?? null;
          if (!enrichedGoogleEmail || !enrichedAppleEmail) {
            if (!enrichedGoogleEmail && stored?.googleEmail) enrichedGoogleEmail = stored.googleEmail;
            if (!enrichedAppleEmail  && stored?.appleEmail)  enrichedAppleEmail  = stored.appleEmail;
          }

          const mergedProviderIds = Array.from(new Set([
            ...providerIds,
            ...((stored?.linkedProviderIds as string[] | undefined) ?? []),
            ...(enrichedGoogleEmail ? ['google.com'] : []),
            ...(enrichedAppleEmail ? ['apple.com'] : []),
          ]));

          // Persist enriched values in state so derived signedEmail/buyerEmail
          // are correct even when Firebase only populates one provider.
          setStoredGoogleEmail(enrichedGoogleEmail);
          setStoredAppleEmail(enrichedAppleEmail);
          setStoredLinkedProviderIds(mergedProviderIds);

          const email = enrichedGoogleEmail ?? enrichedAppleEmail ?? firebaseUser.email ?? null;

          writeUserProfile(firebaseUser.uid, {
            displayName: firebaseUser.displayName ?? null,
            email,
            googleEmail: enrichedGoogleEmail,
            appleEmail:  enrichedAppleEmail,
            linkedProviderIds: mergedProviderIds,
            provider,
          }).catch(() => {/* non-critical */});
        }
      } else {
        // No session — clear enriched emails and sign in anonymously
        setStoredGoogleEmail(null);
        setStoredAppleEmail(null);
        setStoredLinkedProviderIds([]);
        try {
          await signInAnonymously(getAuth());
          // onIdTokenChanged fires again with the new anonymous user
        } catch (e: any) {
          setError(e.message ?? 'Anonymous sign-in failed');
          setLoading(false);
        }
      }
    });
    return unsubscribe;
  }, []);

  // ─── Apple credential revocation check (iOS) ───────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    async function checkAppleCredential() {
      try {
        const storedAppleId = await secureGet(SecureKeys.APPLE_USER_ID);
        if (!storedAppleId) return;

        const state = await appleAuth.getCredentialStateForUser(storedAppleId);
        if (state === appleAuth.State.REVOKED) {
          await secureRemove(SecureKeys.APPLE_USER_ID);
          await firebaseSignOut(getAuth());
        }
      } catch {
        // Secure read failed or credential check unavailable — ignore
      }
    }

    checkAppleCredential();

    // Also listen for Apple revocation events while the app is running
    const sub = appleAuth.onCredentialRevoked(async () => {
      await secureRemove(SecureKeys.APPLE_USER_ID);
      await firebaseSignOut(getAuth());
    });
    return () => sub();
  }, []);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Handle the case where the social credential belongs to an existing
   * (non-anonymous) Firebase account. We sign in to that account instead,
   * which recovers the user's original UID and all their data.
   */
  async function _handleCredentialInUse(
    credential: FirebaseAuthTypes.AuthCredential,
  ): Promise<void> {
    await signInWithCredential(getAuth(), credential);
  }

  // ─── Link with Apple ───────────────────────────────────────────────────────

  async function linkWithApple(): Promise<void> {
    if (Platform.OS !== 'ios') {
      throw new Error('Sign in with Apple is only available on iOS');
    }
    if (!appleAuth.isSupported) {
      throw new Error('Sign in with Apple requires iOS 13 or later');
    }
    if (!user) throw new Error('No authenticated user to link');

    // The @invertase library SHA-256 hashes the nonce before sending it to Apple.
    // We pass rawNonce here; Firebase receives rawNonce and verifies sha256(rawNonce)
    // against the hash Apple embeds in the identity token.
    const rawNonce = generateNonce();

    const appleResponse = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      nonce: rawNonce,
    });

    if (!appleResponse.identityToken) {
      throw new Error('Apple Sign-In failed — no identity token returned');
    }

    const credential = AppleAuthProvider.credential(
      appleResponse.identityToken,
      rawNonce,
    );

    // Pre-check EncryptedStorage: if this Apple User ID was previously signed in on this
    // device, go directly to signInWithCredential.  This avoids the
    // "Duplicate credential received" trap where linkWithCredential consumes the
    // single-use Apple identity token (validating it server-side) and then
    // signInWithCredential with the same token is rejected by Apple as a replay.
    const storedAppleUserId = await secureGet(SecureKeys.APPLE_USER_ID);
    const isReturningAppleUser =
      storedAppleUserId !== null && storedAppleUserId === appleResponse.user;

    try {
      if (isReturningAppleUser) {
        // Returning user on this device — sign in to their existing Apple account.
        // Do NOT call linkWithCredential first; it would consume the token and
        // leave nothing usable for the subsequent signInWithCredential call.
        const prevUid = user.uid;
        await signInWithCredential(getAuth(), credential);
        const newUid = getAuth().currentUser!.uid;
        // If the Apple account is a different Firebase account (e.g. the user
        // was signed in with Google and is now switching to their pre-existing
        // Apple account), migrate preferences and carry over the Google email so
        // both provider emails are visible in Firestore (fixes #197).
        if (newUid !== prevUid) {
          await migrateAnonymousPreferences(prevUid, newUid);
          const mergedIds = Array.from(new Set([
            'apple.com',
            ...(storedGoogleEmail ? ['google.com'] : []),
            ...storedLinkedProviderIds,
          ]));
          mergeProfileFields(newUid, {
            ...(storedGoogleEmail ? { googleEmail: storedGoogleEmail } : {}),
            linkedProviderIds: mergedIds,
          }).catch(() => {});
        }
        setUser(getAuth().currentUser!);
      } else {
        // New user or unrecognised Apple ID — link the anonymous account to Apple
        // so the anonymous UID is preserved.
        const { user: linkedUser } = await linkWithCredential(user, credential);
        // Apple provides fullName only on the very first authorisation.
        if (appleResponse.fullName) {
          const displayName = [
            appleResponse.fullName.givenName,
            appleResponse.fullName.familyName,
          ]
            .filter(Boolean)
            .join(' ')
            .trim();
          if (displayName) await updateProfile(linkedUser, { displayName });
        }
        setUser(getAuth().currentUser!);
      }
    } catch (e: any) {
      if (e.code === 'auth/credential-already-in-use') {
        // The Apple ID belongs to a different Firebase account.
        // linkWithCredential already consumed the identity token (Apple tokens are
        // single-use), so we MUST obtain a fresh Apple credential before calling
        // signInWithCredential — reusing the original token would fail with
        // [auth/unknown] "Duplicate credential received".
        const rawNonce2 = generateNonce();
        const appleResponse2 = await appleAuth.performRequest({
          requestedOperation: appleAuth.Operation.LOGIN,
          requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
          nonce: rawNonce2,
        });
        if (!appleResponse2.identityToken) {
          throw new Error('Apple Sign-In failed — no identity token returned');
        }
        const freshCredential = AppleAuthProvider.credential(
          appleResponse2.identityToken,
          rawNonce2,
        );
        // Capture the anonymous UID BEFORE switching accounts so we can migrate
        // any accumulated preferences to the recovered Apple account (fixes #189
        // comment 4 — "3 UIDs, data stays under anonymous").
        const anonymousUidApple = user.uid;
        await signInWithCredential(getAuth(), freshCredential);
        const newUid = getAuth().currentUser!.uid;
        await migrateAnonymousPreferences(anonymousUidApple, newUid);
        // Carry the previous account's Google email into the Apple account's
        // Firestore document so both provider emails appear under one UID
        // (fixes #197 — split Firestore UIDs on Google→Apple link).
        const mergedIds = Array.from(new Set([
          'apple.com',
          ...(storedGoogleEmail ? ['google.com'] : []),
          ...storedLinkedProviderIds,
        ]));
        mergeProfileFields(newUid, {
          ...(storedGoogleEmail ? { googleEmail: storedGoogleEmail } : {}),
          linkedProviderIds: mergedIds,
        }).catch(() => {});
        setUser(getAuth().currentUser!);
        // Persist the fresh Apple User ID and return early to skip the save below.
        await secureSet(SecureKeys.APPLE_USER_ID, appleResponse2.user);
        return;
      } else if (e.code === 'auth/provider-already-linked') {
        // Already linked — just refresh state so UI hides the sign-in buttons.
        setUser(getAuth().currentUser!);
      } else {
        throw e;
      }
    }

    // Persist Apple User ID in EncryptedStorage for revocation checks and
    // returning-user detection on subsequent sign-in attempts (#246).
    await secureSet(SecureKeys.APPLE_USER_ID, appleResponse.user);
  }

  // ─── Link with Google ──────────────────────────────────────────────────────

  async function linkWithGoogle(): Promise<void> {
    if (!user) throw new Error('No authenticated user to link');

    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();

    if (result.type === 'cancelled') return;

    const { idToken, accessToken } = result.data;
    if (!idToken) throw new Error('Google Sign-In failed — no ID token returned');

    // Pass both idToken and accessToken so Firebase Auth has full context to
    // populate user.email (email lives in the JWT but the access token lets
    // Firebase verify and refresh profile fields including email).
    const credential = GoogleAuthProvider.credential(idToken, accessToken ?? undefined);

    try {
      await linkWithCredential(user, credential);
      // Use getAuth().currentUser — the UserCredential.user snapshot returned
      // by linkWithCredential is sometimes stale and may lack user.email even
      // though Firebase has stored it correctly server-side.
      setUser(getAuth().currentUser!);
    } catch (e: any) {
      if (e.code === 'auth/credential-already-in-use') {
        // Google credential belongs to an existing Firebase account — sign in to
        // recover it. Migrate any preferences accumulated under the anonymous
        // session so data is not left behind under the orphaned anonymous UID
        // (fixes #189 comment 4 — "3 UIDs, data stays under anonymous").
        const anonymousUidGoogle = user.uid;
        await _handleCredentialInUse(credential);
        const newUid = getAuth().currentUser!.uid;
        await migrateAnonymousPreferences(anonymousUidGoogle, newUid);
        // Symmetry with Apple flow: when switching accounts via Google sign-in,
        // carry over previously known Apple email so both linked providers remain
        // visible from either login entry point (#320).
        const mergedIds = Array.from(new Set([
          'google.com',
          ...(storedAppleEmail ? ['apple.com'] : []),
          ...storedLinkedProviderIds,
        ]));
        mergeProfileFields(newUid, {
          ...(storedAppleEmail ? { appleEmail: storedAppleEmail } : {}),
          linkedProviderIds: mergedIds,
        }).catch(() => {});
        setUser(getAuth().currentUser!);
      } else if (e.code === 'auth/provider-already-linked') {
        // Already linked — just refresh state so UI hides the sign-in buttons.
        setUser(getAuth().currentUser!);
      } else {
        throw e;
      }
    }
  }

  // ─── Sign out ──────────────────────────────────────────────────────────────

  async function signOut(): Promise<void> {
    await firebaseSignOut(getAuth());
    // After sign-out, onIdTokenChanged fires → re-signs in anonymously
  }

  /** Force-refresh the Firebase ID token and update isPremium from the new claim (#205). */
  async function refreshPremium(): Promise<void> {
    const cu = getAuth().currentUser;
    if (!cu) return;
    try {
      const tokenResult = await cu.getIdTokenResult(/* forceRefresh */ true);
      const claimPremium = !!tokenResult.claims.isPremium;
      if (__DEV__) {
        const devOverride = await AsyncStorage.getItem(DEV_PREMIUM_OVERRIDE_KEY);
        const devPremium = devOverride !== 'false';
        const effectivePremium = devPremium || claimPremium;
        console.log('[Auth] refreshPremium: claim=', claimPremium, 'devPremium=', devPremium, '→ effective=', effectivePremium);
        setIsPremium(effectivePremium);
        setIsClaimPremium(effectivePremium);
        return;
      }
      console.log('[Auth] refreshPremium: claim=', claimPremium);
      setIsPremium(claimPremium);
      setIsClaimPremium(claimPremium);
    } catch { /* keep existing value */ }
  }

  // ─── Derived state ─────────────────────────────────────────────────────────

  const provider: AuthProvider = (() => {
    if (!user || user.isAnonymous) return 'anonymous';
    const providerIds = user.providerData.map((p) => p.providerId);
    if (providerIds.includes('apple.com')) return 'apple';
    if (providerIds.includes('google.com')) return 'google';
    return 'anonymous';
  })();

  // Derive rich profile fields from providerData, supplemented by Firestore
  // enrichment state for the re-login-with-single-provider scenario (#192 comment 3)
  const googleProviderData = user?.providerData.find(p => p.providerId === 'google.com');
  const appleProviderData  = user?.providerData.find(p => p.providerId === 'apple.com');

  // Use the Firestore-enriched email if Firebase providerData lacks it
  const effectiveGoogleEmail = googleProviderData?.email ?? storedGoogleEmail;
  const effectiveAppleEmail  = appleProviderData?.email  ?? storedAppleEmail;

  const signedEmail: string | null = (() => {
    if (!user || user.isAnonymous) return null;
    // Prefer the real Gmail address over Apple private relay
    if (effectiveGoogleEmail) return effectiveGoogleEmail;
    if (effectiveAppleEmail)  return effectiveAppleEmail;
    return user.email ?? null;
  })();

  const buyerEmail: string | null = (() => {
    // iOS App Store purchases are always tied to the user's Apple ID.
    // If the user signed in with Google but purchased via iOS IAP, the
    // payment identity is their Apple ID — captured here if Apple is also linked.
    if (!user) return null;
    return effectiveAppleEmail ?? null;
  })();

  const photoURL: string | null =
    googleProviderData?.photoURL ?? user?.photoURL ?? null;

  // Firebase providerData can be incomplete after some re-login paths.
  // Supplement with provider IDs previously observed and persisted in Firestore.
  const linkedProviders = (() => {
    const set = new Set(user?.providerData.map(p => p.providerId) ?? []);
    for (const id of storedLinkedProviderIds) set.add(id);
    // Legacy fallback: treat persisted provider emails as linked-provider evidence.
    if (effectiveGoogleEmail) set.add('google.com');
    if (effectiveAppleEmail) set.add('apple.com');
    return Array.from(set);
  })();

  return {
    user,
    uid: user?.uid ?? null,
    isAnonymous: user?.isAnonymous ?? true,
    isLinked: provider !== 'anonymous',
    provider,
    isPremium,
    isClaimPremium,
    loading,
    error,
    displayName: user?.displayName ?? null,
    signedEmail,
    buyerEmail,
    photoURL,
    linkedProviders,
    linkWithApple,
    linkWithGoogle,
    signOut,
    refreshPremium,
  };
}
