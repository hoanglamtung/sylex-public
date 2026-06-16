import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface GradientProgressBarProps {
  progress: number;
}

export function GradientProgressBar({ progress }: GradientProgressBarProps) {
  const safeProgress = Math.max(0, Math.min(progress, 100));

  return (
    <View style={styles.container}>
      <Svg width="100%" height="100%" viewBox="0 0 100 10" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#00E3FD" />
            <Stop offset="100%" stopColor="#B400FF" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="10" rx="5" fill="rgba(237, 244, 255, 0.14)" />
        <Rect x="0" y="0" width={safeProgress} height="10" rx="5" fill="url(#progressGradient)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '92%',
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
