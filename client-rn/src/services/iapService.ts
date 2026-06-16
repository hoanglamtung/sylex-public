/**
 * iapService — #181
 *
 * Client-side In-App Purchase bridge for iOS (StoreKit 2 via react-native-iap)
 * and Android (Google Play Billing v7 via react-native-iap).
 *
 * Receipt validation is always server-side — this service sends raw purchase
 * tokens to our API and trusts the server's isPremium verdict.
 *
 * Server endpoints (live from #125):
 *   POST /v1/subscription/validate  — validate a new purchase receipt
 *   GET  /v1/subscription/status    — current user subscription state
 *   POST /v1/subscription/restore   — server-side restore lookup
 */

import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type ProductSubscription,
  type ProductSubscriptionAndroid,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { Platform } from 'react-native';
import { getAuth, getIdToken } from '@react-native-firebase/auth';

// ─── Product IDs ─────────────────────────────────────────────────────────────

export const PRODUCT_IDS = {
  monthly: 'assistantpro.premium.monthly',
  yearly: 'assistantpro.premium.yearly',
} as const;

export type ProductId = (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionStatus {
  isPremium: boolean;
  plan: 'monthly' | 'yearly' | null;
  expiresAt: string | null;
  gracePeriod: boolean;
}

export interface ValidateResult {
  isPremium: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.car-assistant-pro.silverleaf.studio';

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const user = getAuth().currentUser;
  if (!user) return { 'Content-Type': 'application/json' };
  const token = await getIdToken(user);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Module-level offer token cache (Android) ────────────────────────────────
// Populated in initIAP so purchaseSubscription can look up offerToken without
// an extra network round-trip.
const _offerTokenCache = new Map<string, string>();

// ─── Connection ───────────────────────────────────────────────────────────────

/**
 * Must be called once on app start (e.g. in App.tsx useEffect).
 * Returns the available subscription products so the paywall can show live prices.
 * On Android, also populates the offerToken cache needed for requestPurchase.
 */
export async function initIAP(): Promise<ProductSubscription[]> {
  await initConnection();
  const skus = Object.values(PRODUCT_IDS);
  const products = (await fetchProducts({ skus, type: 'subs' })) as ProductSubscription[];

  // Cache the first offerToken for each Android subscription product
  for (const product of products) {
    const p = product as ProductSubscriptionAndroid;
    if (Array.isArray(p.subscriptionOfferDetailsAndroid) && p.subscriptionOfferDetailsAndroid.length > 0) {
      _offerTokenCache.set(p.productId, p.subscriptionOfferDetailsAndroid[0].offerToken);
    }
  }

  return products;
}

/** Call on app unmount / cleanup. */
export function endIAPConnection(): void {
  endConnection();
}

// ─── Listeners ────────────────────────────────────────────────────────────────

/**
 * Attach purchase listeners.
 * Call this once per app session (e.g. in App.tsx useEffect).
 * Returns an unsubscribe function.
 *
 * @param onPurchase  Called with a validated Purchase — callers should finish
 *                   the transaction and refresh Auth token.
 * @param onError     Called with a PurchaseError.
 */
export function attachPurchaseListeners(
  onPurchase: (purchase: Purchase) => void,
  onError: (err: PurchaseError) => void,
): () => void {
  const purchaseSub = purchaseUpdatedListener((purchase: Purchase) => {
    onPurchase(purchase);
  });
  const errorSub = purchaseErrorListener((err: PurchaseError) => {
    onError(err);
  });
  return () => {
    purchaseSub.remove();
    errorSub.remove();
  };
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

/**
 * Triggers the native purchase sheet for the given product ID.
 * Throws on cancellation or network error — callers should catch PurchaseError.
 * Actual purchase result arrives asynchronously via purchaseUpdatedListener.
 */
export async function purchaseSubscription(productId: ProductId): Promise<void> {
  if (Platform.OS === 'android') {
    const offerToken = _offerTokenCache.get(productId);
    await requestPurchase({
      type: 'subs',
      request: {
        google: {
          skus: [productId],
          subscriptionOffers: offerToken
            ? [{ sku: productId, offerToken }]
            : undefined,
        },
      },
    });
  } else {
    await requestPurchase({
      type: 'subs',
      request: {
        apple: {
          sku: productId,
          andDangerouslyFinishTransactionAutomatically: false,
        },
      },
    });
  }
}

// ─── Server validation ────────────────────────────────────────────────────────

/**
 * Sends the raw purchase token to our server for receipt validation.
 * The server sets a Firebase custom claim `isPremium: true` on success.
 *
 * Routes:
 *   iOS    → POST /v1/subscription/validate/apple  { originalTransactionId }
 *   Android → POST /v1/subscription/validate/google { purchaseToken, subscriptionId }
 *
 * After calling this, force-refresh the Firebase ID token to pick up the
 * new claim:
 *   await auth().currentUser?.getIdToken(true)
 */
export async function validateReceipt(purchase: Purchase): Promise<ValidateResult> {
  const headers = await authHeaders();

  let endpoint: string;
  let body: Record<string, string | null>;

  if (Platform.OS === 'ios') {
    // Prefer originalTransactionIdentifierIOS (stable across renewals);
    // fall back to transactionId for new purchases where they are identical.
    const originalTxId =
      (purchase as any).originalTransactionIdentifierIOS ?? purchase.transactionId ?? null;
    endpoint = `${API_BASE}/v1/subscription/validate/apple`;
    body = { originalTransactionId: originalTxId };
  } else {
    endpoint = `${API_BASE}/v1/subscription/validate/google`;
    body = {
      purchaseToken: (purchase as any).purchaseToken ?? null,
      subscriptionId: purchase.productId,
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Receipt validation failed: ${res.status}`);
  }

  const json = (await res.json()) as { isPremium: boolean };
  return { isPremium: !!json.isPremium };
}

/**
 * Acknowledge and finish a transaction after server validation succeeds.
 * This is required by both App Store and Play Store or the purchase is refunded.
 */
export async function finishPurchase(purchase: Purchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: false });
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restores previous purchases and validates each one with the server.
 * Also finishes/acknowledges each valid transaction so it is not left pending.
 * Returns true if at least one valid premium purchase was found.
 */
export async function restorePurchases(): Promise<boolean> {
  const purchases = await getAvailablePurchases();
  if (purchases.length === 0) return false;

  // Validate each purchase individually using the platform-specific endpoints.
  // Always finish the transaction after validation so it doesn't stay pending
  // (an unacknowledged purchase causes "already owned" on the next purchase attempt).
  const results = await Promise.all(
    purchases.map(async (p) => {
      try {
        const result = await validateReceipt(p);
        await finishPurchase(p).catch(() => {});
        return result;
      } catch (e) {
        // Propagate server errors (5xx) so callers can show a real error message
        // instead of silently treating a server failure as "no subscription".
        if (e instanceof Error && /\b5\d{2}\b/.test(e.message)) throw e;
        return { isPremium: false };
      }
    }),
  );
  return results.some(r => r.isPremium);
}

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Fetches the current subscription status from the server.
 * Call on app launch (after Firebase Auth is ready) to refresh premium state.
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/v1/subscription/status`, { headers });

  if (!res.ok) {
    return { isPremium: false, plan: null, expiresAt: null, gracePeriod: false };
  }

  const json = (await res.json()) as Partial<SubscriptionStatus>;
  return {
    isPremium: !!json.isPremium,
    plan: json.plan ?? null,
    expiresAt: json.expiresAt ?? null,
    gracePeriod: !!json.gracePeriod,
  };
}
