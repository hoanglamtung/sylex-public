/**
 * PremiumBadge — #133
 *
 * Small "PRO" badge displayed next to account status in Settings
 * and in the header for premium users.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  /** 'pro' shows cyan PRO badge; 'free' shows muted FREE badge */
  tier?: 'pro' | 'free';
}

export function PremiumBadge({ tier = 'free' }: Props) {
  const isPro = tier === 'pro';
  return (
    <View style={[styles.badge, isPro ? styles.badgePro : styles.badgeFree]}>
      <Text style={[styles.text, isPro ? styles.textPro : styles.textFree]}>
        {isPro ? '✦ PRO' : 'FREE'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 22,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgePro: {
    borderColor: 'rgba(0,229,255,0.45)',
    backgroundColor: 'rgba(0,229,255,0.12)',
  },
  badgeFree: {
    borderColor: 'rgba(237,244,255,0.2)',
    backgroundColor: 'rgba(237,244,255,0.06)',
  },
  text: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  textPro: {
    color: '#00E5FF',
  },
  textFree: {
    color: 'rgba(237,244,255,0.45)',
  },
});
