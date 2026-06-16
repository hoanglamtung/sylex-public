/**
 * Assistant Pro — React Native entry point
 */

import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import notifee, { EventType } from '@notifee/react-native';
import { useNavigationContainerRef } from '@react-navigation/native';
import { initI18n } from '../src/i18n';
import { AppNavigator, type RootStackParamList } from '../src/navigation/AppNavigator';
import { initFirestore } from '../src/services/syncService';
import { useAuth } from '../src/hooks/useAuth';
import {
  initIAP,
  endIAPConnection,
  attachPurchaseListeners,
  validateReceipt,
  finishPurchase,
  restorePurchases,
} from '../src/services/iapService';
import {
  getRoutineNotificationTarget,
  handleRoutineNotificationDelivery,
  type RoutineNotificationTarget,
} from '../src/services/routineScheduleService';

// Now safe — RN runtime is up by the time the App function body runs
initI18n();

// Web client ID from google-services.json (type 3) — required for idToken generation
GoogleSignin.configure({
  webClientId: '770916292247-bisiv278sikl61be3752qphkm7qgogot.apps.googleusercontent.com',
});

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const pendingRoutineRouteRef = useRef<RoutineNotificationTarget | null>(null);
  // Triggers anonymous Firebase Auth sign-in on first launch.
  // The returned uid is available for Firestore reads/writes via syncService.
  const { uid, isPremium, refreshPremium } = useAuth();
  const [iapReady, setIapReady] = useState(false);

  const openRoutineTarget = (target: RoutineNotificationTarget) => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('RoutineExecution', target);
      return;
    }
    pendingRoutineRouteRef.current = target;
  };

  useEffect(() => {
    initFirestore();
    logEvent(getAnalytics(), 'app_open');
  }, []);

  useEffect(() => {
    const unsubscribe = notifee.onForegroundEvent(async ({ type, detail }) => {
      if (type === EventType.DELIVERED) {
        await handleRoutineNotificationDelivery(detail.notification);
        return;
      }

      if (type === EventType.PRESS || type === EventType.ACTION_PRESS) {
        const target = getRoutineNotificationTarget(detail.notification);
        if (target) openRoutineTarget(target);
      }
    });

    void notifee.getInitialNotification().then((initial) => {
      const target = getRoutineNotificationTarget(initial?.notification);
      if (target) openRoutineTarget(target);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    initIAP()
      .then(() => setIapReady(true))
      .catch((e) => console.warn('[IAP] init failed', e));

    const detach = attachPurchaseListeners(
      async (purchase) => {
        try {
          await validateReceipt(purchase);
          await finishPurchase(purchase);
          // Force-refresh the Firebase token to pick up the updated isPremium claim
          await refreshPremium();
        } catch (e) {
          // On server errors (5xx) leave the transaction pending so StoreKit
          // re-delivers it on next launch and the server gets another chance.
          const isServerError = e instanceof Error && /\b5\d{2}\b/.test((e as Error).message);
          if (!isServerError) {
            await finishPurchase(purchase).catch(() => {});
          }
          console.warn('[IAP] background validation error', e);
        }
      },
      (err) => {
        const errCode = (err as { code?: string }).code;
        if (errCode === 'already-owned' || errCode === 'E_ALREADY_OWNED') {
          // Item already owned — force-refresh the token so the UI reflects latest premium state.
          // If the background listener already validated + finished the transaction, the
          // server's Firestore record is up-to-date and a token refresh is enough.
          restorePurchases()
            .then(async () => {
              await refreshPremium();
            })
            .catch((e) => console.warn('[IAP] restore-on-owned failed', e));
        } else {
          console.warn('[IAP] purchase error', err);
        }
      },
    );

    return () => {
      detach();
      endIAPConnection();
      setIapReady(false);
    };
  }, []);

  // #213: Force-refresh premium claim on every app launch / reinstall.
  // Covers the reinstall scenario where the user's linked account (Apple/Google)
  // already has the isPremium claim set server-side but the local token is stale.
  // Runs independently of IAP — even if StoreKit init fails, the claim is read.
  useEffect(() => {
    if (!uid) return;
    refreshPremium().catch(() => {});
  }, [uid]);

  // Auto-restore subscriptions on every new uid (app launch, account switch, reinstall).
  // Covers anonymous users who purchased before linking an account — they regain
  // premium access without any user action after a restart or reinstall.
  // Also re-validates when a user logs into an existing account on a new device.
  const prevUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!iapReady || !uid || uid === prevUidRef.current) return;
    prevUidRef.current = uid;
    console.log('[IAP] auto-restore check — uid:', uid, 'isPremium:', isPremium, 'iapReady:', iapReady);
    if (isPremium) {
      console.log('[IAP] claim already present — skipping restore');
      return;
    }
    console.log('[IAP] isPremium=false, attempting restorePurchases…');
    restorePurchases()
      .then(async (restored) => {
        console.log('[IAP] restorePurchases returned:', restored);
        if (restored) {
          await refreshPremium();
          console.log('[IAP] subscription auto-restored for uid', uid);
        } else {
          console.log('[IAP] restorePurchases returned false — no active purchases found (expected on dev builds)');
        }
      })
      .catch((e) => console.warn('[IAP] auto-restore failed', e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, iapReady]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppNavigator
        navigationRef={navigationRef}
        onReady={() => {
          const target = pendingRoutineRouteRef.current;
          if (!target) return;
          pendingRoutineRouteRef.current = null;
          navigationRef.navigate('RoutineExecution', target);
        }}
      />
    </SafeAreaProvider>
  );
}

export default App;
