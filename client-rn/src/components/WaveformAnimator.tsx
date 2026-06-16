import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

import { tokens } from '../theme/tokens';

const BAR_COUNT = 9;
const MIN_HEIGHT = 48;
const MAX_HEIGHT = 124;
const CYCLE_DURATION = 800;   // ms — matches WaveformAnimator.js cycleDuration 0.8s
const STAGGER_DELAY = 80;     // ms — matches staggerDelay 0.08s

interface WaveformAnimatorProps {
  active: boolean;
}

export function WaveformAnimator({ active }: WaveformAnimatorProps) {
  const heights = Array.from({ length: BAR_COUNT }, () => useSharedValue(MIN_HEIGHT));

  useEffect(() => {
    heights.forEach((h, i) => {
      if (active) {
        h.value = withDelay(
          i * STAGGER_DELAY,
          withRepeat(
            withSequence(
              withTiming(MAX_HEIGHT, { duration: CYCLE_DURATION / 2, easing: Easing.inOut(Easing.ease) }),
              withTiming(MIN_HEIGHT, { duration: CYCLE_DURATION / 2, easing: Easing.inOut(Easing.ease) }),
            ),
            -1,
            false,
          ),
        );
      } else {
        h.value = withTiming(MIN_HEIGHT, { duration: 300 });
      }
    });
  }, [active]);

  return (
    <View style={styles.container}>
      {heights.map((h, i) => {
        const animStyle = useAnimatedStyle(() => ({ height: h.value }));
        return (
          <Animated.View key={i} style={[styles.bar, i % 2 === 0 ? styles.barCyan : styles.barMagenta, animStyle]} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 10,
    height: MAX_HEIGHT + 16,
  },
  bar: {
    width: 12,
    borderRadius: 999,
  },
  barCyan: {
    backgroundColor: tokens.colors.cyan,
    shadowColor: tokens.colors.cyan,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  barMagenta: {
    backgroundColor: tokens.colors.magenta,
    shadowColor: tokens.colors.magenta,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});
