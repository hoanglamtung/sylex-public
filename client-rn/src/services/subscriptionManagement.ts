/**
 * subscriptionManagement — #140
 *
 * Deep-links to the OS-native subscription management screens.
 * Apple and Google own the billing UI — we never replicate it in-app.
 *
 * Usage:
 *   import { openSubscriptionManagement } from './subscriptionManagement';
 *   await openSubscriptionManagement();
 */

import { Linking, Platform } from 'react-native';

const ANDROID_PACKAGE = 'studio.silverleaf.carassistantpro';
// Product ID registered in Google Play Console
const ANDROID_PRODUCT_ID = 'assistantpro.premium.monthly';

/**
 * Opens the system subscription management screen.
 * - iOS  → App Store account subscriptions page
 * - Android → Google Play subscriptions deep-link for this app
 */
export async function openSubscriptionManagement(): Promise<void> {
  const url =
    Platform.OS === 'ios'
      ? 'itms-apps://apps.apple.com/account/subscriptions'
      : `https://play.google.com/store/account/subscriptions?sku=${ANDROID_PRODUCT_ID}&package=${ANDROID_PACKAGE}`;

  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
  } else {
    // Fallback: open web App Store / Play Store
    const fallback =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : `https://play.google.com/store/account/subscriptions?sku=${ANDROID_PRODUCT_ID}&package=${ANDROID_PACKAGE}`;
    await Linking.openURL(fallback);
  }
}
