/**
 * permissionService — runtime permission helpers for Android.
 *
 * iOS handles mic & location via Info.plist usage strings (no runtime API needed).
 * Android requires explicit PermissionsAndroid.request() for dangerous permissions.
 *
 * Usage:
 *   const granted = await requestMicPermission();     // before Voice.start()
 *   const granted = await requestLocationPermission(); // before Geolocation.getCurrentPosition()
 */

import { Platform, PermissionsAndroid, Linking } from 'react-native';

type PermissionResult = 'granted' | 'denied' | 'unavailable';

/**
 * Request RECORD_AUDIO on Android.
 * On iOS the permission is handled by the native Voice module via Info.plist.
 * Returns 'granted' | 'denied'. Opens Settings when DENIED or NEVER_ASK_AGAIN.
 */
export async function requestMicPermission(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (already) return 'granted';

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone Permission',
      message: 'Assistant Pro needs microphone access for voice commands.',
      buttonPositive: 'Allow',
    },
  );

  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    void Linking.openSettings();
    return 'denied';
  }
  return 'granted';
}

/**
 * Request ACCESS_FINE_LOCATION (+ ACCESS_COARSE_LOCATION) on Android.
 * Call this before any Geolocation.getCurrentPosition() / watchPosition() call.
 * On iOS the permission is requested automatically by the native module via
 * NSLocationWhenInUseUsageDescription in Info.plist.
 * Returns 'granted' | 'denied'. Opens Settings when DENIED or NEVER_ASK_AGAIN.
 */
export async function requestLocationPermission(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  const already = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  if (already) return 'granted';

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location Permission',
      message:
        'Assistant Pro needs your location to answer navigation and nearby-place queries.',
      buttonPositive: 'Allow',
    },
  );

  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    void Linking.openSettings();
    return 'denied';
  }
  return 'granted';
}
