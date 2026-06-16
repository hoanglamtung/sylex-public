/**
 * PremiumGate — #133
 *
 * Wraps any pressable child with a premium check.
 * - Premium user: renders children transparently (no-op wrapper)
 * - Free user: renders children at 50% opacity with a lock overlay,
 *   shows UpgradeBottomSheet when tapped
 */

import React, { useState } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { UpgradeBottomSheet } from './UpgradeBottomSheet';

interface Props {
  isPremium: boolean;
  featureName: string;
  onUpgrade: () => void;
  children: React.ReactNode;
}

export function PremiumGate({ isPremium, featureName, onUpgrade, children }: Props) {
  const [sheetVisible, setSheetVisible] = useState(false);

  if (isPremium) {
    return <>{children}</>;
  }

  const handleUpgrade = () => {
    setSheetVisible(false);
    onUpgrade();
  };

  return (
    <>
      <View style={styles.wrapper}>
        {/* Children visible but non-interactive */}
        <View pointerEvents="none" style={styles.locked}>
          {children}
        </View>
        {/* Lock badge */}
        <View style={styles.lockBadge} pointerEvents="none">
          <Text style={styles.lockIcon}>🔒</Text>
        </View>
        {/* Full-cover tap interceptor */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setSheetVisible(true)}
        />
      </View>

      <UpgradeBottomSheet
        visible={sheetVisible}
        featureName={featureName}
        onClose={() => setSheetVisible(false)}
        onUpgrade={handleUpgrade}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  locked: {
    opacity: 0.45,
  },
  lockBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  lockIcon: {
    fontSize: 10,
  },
});
