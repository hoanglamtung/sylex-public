import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { tokens } from '../theme/tokens';

export function DualSpinner() {
  const outerRotation = useSharedValue(0);
  const innerRotation = useSharedValue(0);

  useEffect(() => {
    outerRotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    innerRotation.value = withRepeat(
      withTiming(-360, { duration: 1500, easing: Easing.linear }),
      -1,
      false,
    );
  }, [innerRotation, outerRotation]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${outerRotation.value}deg` }],
  }));

  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${innerRotation.value}deg` }],
  }));

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.ring, styles.outerRing, outerStyle]} />
      <Animated.View style={[styles.ring, styles.innerRing, innerStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 6,
    borderColor: 'transparent',
  },
  outerRing: {
    width: 140,
    height: 140,
    borderColor: 'rgba(0, 229, 255, 0.18)',
    borderTopColor: tokens.colors.cyan,
  },
  innerRing: {
    width: 102,
    height: 102,
    borderColor: 'rgba(180, 0, 255, 0.18)',
    borderTopColor: tokens.colors.magenta,
  },
});
