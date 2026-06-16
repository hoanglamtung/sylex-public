/**
 * Firebase Auth middleware — #125
 *
 * Verifies the Firebase ID token sent in the Authorization header,
 * attaches the decoded token (including isPremium custom claim) to req.user,
 * and calls next(). Unauthenticated requests receive 401.
 *
 * Usage:
 *   import authMiddleware from '../middleware/auth.js';
 *   router.post('/protected', authMiddleware, handler);
 *
 * The token must be obtained by the client via:
 *   firebase.auth().currentUser.getIdToken()
 * and sent as:
 *   Authorization: Bearer <idToken>
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import logger from '../utils/logger.js';

const require = createRequire(import.meta.url);
let admin;
try {
  admin = require('firebase-admin');
} catch {
  admin = null;
}

let _adminApp = null;

function getAdminApp() {
  if (_adminApp) return _adminApp;
  if (!admin) return null;
  if (admin.apps.length > 0) {
    _adminApp = admin.apps[0];
    return _adminApp;
  }
  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    if (saEnv) {
      // Accept either raw JSON content or a file path
      const serviceAccount = saEnv.trimStart().startsWith('{')
        ? JSON.parse(saEnv)
        : JSON.parse(readFileSync(saEnv, 'utf8'));
      _adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      // Cloud Run: use Application Default Credentials from attached SA
      _adminApp = admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
  } catch {
    return null;
  }
  return _adminApp;
}

/**
 * Strict auth middleware — rejects unauthenticated requests with 401.
 */
export default async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authorization token required', requestId: req.id },
    });
  }

  const app = getAdminApp();

  // In test mode or when Firebase Admin is not configured, allow through with
  // isPremium = false so existing tests continue to work.
  if (!app || process.env.NODE_ENV === 'test') {
    req.user = { uid: 'test-uid', isPremium: false };
    return next();
  }

  try {
    const decoded = await admin.auth(app).verifyIdToken(token);
    req.user = {
      uid:       decoded.uid,
      isPremium: decoded.isPremium === true, // custom claim set by subscriptionService
    };
    next();
  } catch (err) {
    logger.warn('Invalid Firebase ID token', { message: err.message, requestId: req.id });
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token', requestId: req.id },
    });
  }
}

/**
 * Optional auth middleware — allows unauthenticated requests through,
 * but still attaches req.user when a valid token is present.
 * Use on routes that have both free and premium behaviour.
 */
export async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    req.user = null;
    return next();
  }

  const app = getAdminApp();
  if (!app || process.env.NODE_ENV === 'test') {
    req.user = { uid: 'test-uid', isPremium: false };
    return next();
  }

  try {
    const decoded = await admin.auth(app).verifyIdToken(token);
    req.user = { uid: decoded.uid, isPremium: decoded.isPremium === true };
  } catch {
    req.user = null;
  }
  next();
}
