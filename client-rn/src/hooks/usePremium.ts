/**
 * usePremium — #181
 *
 * Provides the current premium status and a convenience `openPaywall` action.
 *
 * Premium status is sourced from the Firebase ID-token custom claim `isPremium`,
 * managed by useAuth. The server sets this claim after receipt validation (#125).
 *
 * Usage:
 *   const { isPremium, openPaywall } = usePremium();
 */

import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from './useAuth';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export interface PremiumState {
  /** True when the Firebase Auth token carries isPremium: true (server-set) */
  isPremium: boolean;
  /** True while the auth state / token is still loading */
  loading: boolean;
  /** Navigate to the Upgrade / Paywall screen */
  openPaywall: () => void;
}

export function usePremium(): PremiumState {
  const { isPremium, loading } = useAuth();
  const navigation = useNavigation<Nav>();

  const openPaywall = useCallback(() => {
    navigation.navigate('Upgrade');
  }, [navigation]);

  return { isPremium, loading, openPaywall };
}
