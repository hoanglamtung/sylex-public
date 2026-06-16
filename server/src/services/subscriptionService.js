/**
 * SubscriptionService — #125
 *
 * Server-side receipt / subscription validation for:
 *   • Apple App Store (App Store Server API — JWT-authenticated, StoreKit 2)
 *   • Google Play Billing (Google Play Developer API — service account)
 *
 * On successful validation the `isPremium` Firebase Auth custom claim is set
 * (or revoked) on the user's account. This claim is then read by the auth
 * middleware on every API request — the client never supplies it directly.
 *
 * Required environment variables (see .env):
 *   APPLE_BUNDLE_ID          — e.g. studio.silverleaf.carassistantpro
 *   APPLE_ISSUER_ID          — from App Store Connect → Keys
 *   APPLE_KEY_ID             — from App Store Connect → Keys
 *   APPLE_PRIVATE_KEY        — contents of the .p8 file (newlines as \n)
 *   APPLE_ENVIRONMENT        — "sandbox" | "production"
 *
 *   GOOGLE_PLAY_PACKAGE_NAME — e.g. studio.silverleaf.carassistantpro
 *   GOOGLE_PLAY_SA_JSON      — path to Google Play service account JSON
 *
 *   FIREBASE_SERVICE_ACCOUNT — path to Firebase Admin SDK service account JSON
 *                              (can reuse GOOGLE_APPLICATION_CREDENTIALS if same project)
 */

import { createHash, createSign } from 'crypto';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

// Firebase Admin is a CommonJS package — load via createRequire
const require = createRequire(import.meta.url);
let admin;
try {
  admin = require('firebase-admin');
} catch {
  // Will be initialised lazily when credentials are available
  admin = null;
}

// ─── Firebase Admin init ──────────────────────────────────────────────────────

let _adminApp = null;

function getAdminApp() {
  if (_adminApp) return _adminApp;
  if (!admin) throw new AppError('CONFIG_ERROR', 'firebase-admin package not installed', 500);

  if (admin.apps.length > 0) {
    _adminApp = admin.apps[0];
    return _adminApp;
  }

  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (saEnv) {
    // Accept either raw JSON content or a file path
    let serviceAccount;
    if (saEnv.trimStart().startsWith('{')) {
      serviceAccount = JSON.parse(saEnv);
    } else {
      serviceAccount = JSON.parse(readFileSync(saEnv, 'utf8'));
    }
    _adminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // Cloud Run: use Application Default Credentials from attached SA
    _adminApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

  logger.info('Firebase Admin initialised for subscription validation');
  return _adminApp;
}

// ─── Custom claim helpers ─────────────────────────────────────────────────────

/**
 * Set or revoke the `isPremium` custom claim on a Firebase Auth user.
 * @param {string}  uid        Firebase UID
 * @param {boolean} isPremium  true to grant, false to revoke
 */
async function setIsPremiumClaim(uid, isPremium) {
  const app = getAdminApp();
  try {
    await admin.auth(app).setCustomUserClaims(uid, { isPremium });
  } catch (err) {
    logger.error('setCustomUserClaims failed', { uid, isPremium, message: err.message, code: err.code });
    throw new AppError('CLAIM_ERROR', `Failed to set isPremium claim: ${err.message}`, 500);
  }
  logger.info('isPremium claim updated', { uid, isPremium });
}

// ─── Apple App Store Server API ───────────────────────────────────────────────

/**
 * Build a signed ES256 JWT for the App Store Server API.
 * Ref: https://developer.apple.com/documentation/appstoreserverapi/generating_tokens_for_api_requests
 */
function buildAppleJWT() {
  const issuerId  = process.env.APPLE_ISSUER_ID;
  const keyId     = process.env.APPLE_KEY_ID;
  const privateKey = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const bundleId  = process.env.APPLE_BUNDLE_ID;

  if (!issuerId || !keyId || !privateKey || !bundleId) {
    throw new AppError(
      'CONFIG_ERROR',
      'Apple App Store credentials missing. Set APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID in .env',
      500,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuerId,
    iat: now,
    exp: now + 3600,
    aud: 'appstoreconnect-v1',
    bid: bundleId,
  })).toString('base64url');

  const data = `${header}.${payload}`;
  const sign = createSign('SHA256');
  sign.update(data);
  const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

  return `${data}.${signature}`;
}

/**
 * Call the Apple App Store Server API for one environment.
 * Returns { ok, status, data, rawBody }.
 */
async function callAppleAPI(originalTransactionId, isSandbox, jwt, fetch) {
  const host = isSandbox
    ? 'https://api.storekit-sandbox.itunes.apple.com'
    : 'https://api.storekit.itunes.apple.com';
  const url = `${host}/inApps/v1/subscriptions/${originalTransactionId}`;
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  } catch (err) {
    logger.error('Apple API network error', { url, message: err.message });
    throw new AppError('NETWORK_ERROR', `Apple API unreachable: ${err.message}`, 502);
  }
  const rawBody = await response.text();
  let data = null;
  try { data = JSON.parse(rawBody); } catch { /* non-JSON body */ }
  return { ok: response.ok, status: response.status, data, rawBody, url };
}

/**
 * Validate an App Store originalTransactionId with the App Store Server API.
 * Automatically falls back to the other environment when Apple reports that the
 * transaction belongs there (errorCode 4040010 — common for TestFlight builds
 * validated against production, or vice-versa).
 * Returns { isActive, expiresDate } — never exposes Apple-specific data to clients.
 */
async function validateAppleTransaction(originalTransactionId) {
  const configuredEnv = process.env.APPLE_ENVIRONMENT ?? 'sandbox';
  const primaryIsSandbox = configuredEnv !== 'production';

  logger.info('Apple API request', {
    originalTransactionId,
    environment: configuredEnv,
  });

  const jwt = buildAppleJWT();

  // Dynamic import of node-fetch (ESM-only in latest versions)
  const { default: fetch } = await import('node-fetch');

  let result = await callAppleAPI(originalTransactionId, primaryIsSandbox, jwt, fetch);

  // errorCode 4040010 → transaction not found in this environment (e.g. TestFlight
  // sandbox transaction sent to production endpoint). Retry the other environment.
  if (!result.ok && result.data?.errorCode === 4040010) {
    logger.info('Apple API environment mismatch — retrying opposite environment', {
      originalTransactionId,
      primaryIsSandbox,
    });
    result = await callAppleAPI(originalTransactionId, !primaryIsSandbox, jwt, fetch);
  }

  if (!result.ok) {
    logger.error('Apple API non-OK response', {
      originalTransactionId,
      url: result.url,
      httpStatus: result.status,
      appleBody: result.rawBody.substring(0, 500),
    });
    throw new AppError('VALIDATION_ERROR', 'Apple subscription validation failed', 502);
  }

  const data = result.data;
  const latest = data?.data?.[0]?.lastTransactions?.[0];

  if (!latest) {
    return { isActive: false, expiresDate: null };
  }

  // status 1 = active, 2 = expired, 3 = billing retry, 4 = billing grace, 5 = revoked
  const isActive = latest.status === 1 || latest.status === 3 || latest.status === 4;
  const expiresDate = latest.expiresDate ? new Date(latest.expiresDate) : null;

  return { isActive, expiresDate };
}

// ─── Google Play Billing ──────────────────────────────────────────────────────

/**
 * Validate a Google Play subscription purchase token.
 * Uses the Google Play Developer API v3.
 * Returns { isActive, expiresDate }.
 */
async function validateGooglePlayPurchase(purchaseToken, subscriptionId) {
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const saPath      = process.env.GOOGLE_PLAY_SA_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!packageName) {
    throw new AppError(
      'CONFIG_ERROR',
      'Google Play credentials missing. Set GOOGLE_PLAY_PACKAGE_NAME in .env',
      500,
    );
  }

  // Use googleapis (CommonJS) via require
  let google;
  try {
    google = require('googleapis').google;
  } catch {
    throw new AppError('CONFIG_ERROR', 'googleapis package not installed', 500);
  }

  // On Cloud Run the attached SA provides ADC — no key file needed.
  const authOptions = { scopes: ['https://www.googleapis.com/auth/androidpublisher'] };
  if (saPath) authOptions.keyFile = saPath;
  const auth = new google.auth.GoogleAuth(authOptions);

  const androidPublisher = google.androidpublisher({ version: 'v3', auth });
  let result;
  try {
    result = await androidPublisher.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken,
    });
  } catch (err) {
    logger.warn('Google Play API error', { message: err.message });
    throw new AppError('VALIDATION_ERROR', 'Google Play subscription validation failed', 502);
  }

  const sub = result.data;
  // subscriptionState: ACTIVE, PAUSED, IN_GRACE_PERIOD, ON_HOLD, CANCELED, EXPIRED
  const activeStates = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'];
  const isActive = activeStates.includes(sub.subscriptionState);
  const expiresDate = sub.lineItems?.[0]?.expiryTime
    ? new Date(sub.lineItems[0].expiryTime)
    : null;

  return { isActive, expiresDate };
}

// ─── Public API ───────────────────────────────────────────────────────────────

class SubscriptionService {
  /**
   * Validate an Apple StoreKit 2 transaction and set/revoke isPremium claim.
   *
   * @param {string} uid                     - Firebase UID
   * @param {string} originalTransactionId   - from StoreKit 2 Transaction.originalID
   * @returns {Promise<{ isPremium: boolean, expiresDate: Date|null }>}
   */
  async validateApple(uid, originalTransactionId) {
    if (!uid || !originalTransactionId) {
      throw new AppError('INVALID_REQUEST', 'uid and originalTransactionId are required', 400);
    }

    const { isActive, expiresDate } = await validateAppleTransaction(originalTransactionId);
    await setIsPremiumClaim(uid, isActive);

    logger.info('Apple subscription validated', { uid, isActive });
    return { isPremium: isActive, expiresDate };
  }

  /**
   * Validate a Google Play purchase token and set/revoke isPremium claim.
   *
   * @param {string} uid            - Firebase UID
   * @param {string} purchaseToken  - from Play Billing Purchase.purchaseToken
   * @param {string} subscriptionId - Play Console subscription product ID
   * @returns {Promise<{ isPremium: boolean, expiresDate: Date|null }>}
   */
  async validateGoogle(uid, purchaseToken, subscriptionId) {
    if (!uid || !purchaseToken || !subscriptionId) {
      throw new AppError('INVALID_REQUEST', 'uid, purchaseToken, and subscriptionId are required', 400);
    }

    const { isActive, expiresDate } = await validateGooglePlayPurchase(purchaseToken, subscriptionId);
    await setIsPremiumClaim(uid, isActive);

    logger.info('Google Play subscription validated', { uid, isActive });
    return { isPremium: isActive, expiresDate };
  }

  /**
   * Revoke premium access immediately (e.g. refund, manual admin action).
   * @param {string} uid - Firebase UID
   */
  async revoke(uid) {
    if (!uid) throw new AppError('INVALID_REQUEST', 'uid is required', 400);
    await setIsPremiumClaim(uid, false);
    logger.info('Premium access revoked', { uid });
  }

  /**
   * Handle Apple App Store Server Notifications (webhook — signedPayload JWT).
   * Ref: https://developer.apple.com/documentation/appstoreservernotifications
   * Automatically sets/revokes isPremium based on notificationType.
   *
   * @param {string} uid            - Firebase UID (resolved from the originalTransactionId lookup)
   * @param {string} notificationType
   * @param {string} subtype
   */
  async handleAppleWebhook(uid, notificationType, subtype) {
    // Types that mean active subscription
    const activeTypes = new Set(['SUBSCRIBED', 'DID_RENEW', 'DID_CHANGE_RENEWAL_STATUS', 'OFFER_REDEEMED', 'GRACE_PERIOD_EXPIRED_RENEWED']);
    // Types that mean expired / revoked
    const revokedTypes = new Set(['EXPIRED', 'REVOKE', 'REFUND', 'DID_CHANGE_RENEWAL_PREF_TO_FREE']);

    if (activeTypes.has(notificationType)) {
      await setIsPremiumClaim(uid, true);
    } else if (revokedTypes.has(notificationType)) {
      await setIsPremiumClaim(uid, false);
    }
    // Other types (e.g. CONSUMPTION_REQUEST, PRICE_INCREASE) — no claim change

    logger.info('Apple webhook processed', { uid, notificationType, subtype });
  }

  /**
   * Handle Google Play Real-time Developer Notifications (Pub/Sub webhook).
   * Ref: https://developer.android.com/google/play/billing/rtdn-reference
   *
   * @param {string} uid                - Firebase UID
   * @param {number} notificationType   - RTDN notification type integer
   * @param {string} purchaseToken
   * @param {string} subscriptionId
   */
  async handleGoogleWebhook(uid, notificationType, purchaseToken, subscriptionId) {
    // 1/2/3/4/7/8/12/20 = purchased/renewed/recovered/paused → active
    // 3=recovered,4=paused_schedule_changed,5=on_hold,6=in_grace,7=restarted
    // 13=revoked, 12=deferred,10=purchased,9=price_change_confirmed,
    // For simplicity: re-validate via API to get ground truth
    const { isActive } = await validateGooglePlayPurchase(purchaseToken, subscriptionId);
    await setIsPremiumClaim(uid, isActive);
    logger.info('Google Play webhook processed', { uid, notificationType, isActive });
  }
}

export default SubscriptionService;
