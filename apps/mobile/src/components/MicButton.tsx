/**
 * The one voice target. Tap = talk (tap again to send; end-of-speech also sends); press-and-hold
 * = push-to-talk (release to send). 72 dp normally, 96 dp in drive mode (D-008 / E1). The
 * listening pulse is the only looping animation allowed in drive mode (1 Hz, tokens.motion).
 */
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, View } from 'react-native';
import { motion, size, useTheme } from '../theme/theme';
import { Icon } from './ui';

export function MicButton({ listening, busy, onPressIn, onPressOut, label, drive }: { listening: boolean; busy?: boolean; onPressIn: () => void; onPressOut: () => void; label: string; drive?: boolean }) {
  const { c } = useTheme();
  const d = drive ? size.micDrive : size.mic;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || !listening || reduce) return;
      loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: motion['listening-pulse'], easing: Easing.out(Easing.quad), useNativeDriver: true }));
      loop.start();
    });
    if (!listening) pulse.setValue(0);
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [listening, pulse]);
  const bg = listening ? c.listening : c.brand;
  const fg = listening ? c.onAccent : c.onBrand;
  return (
    <View style={{ width: d + 24, height: d + 24, alignItems: 'center', justifyContent: 'center' }}>
      {listening ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: c.listening,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
          }}
        />
      ) : null}
      <Pressable
        testID="mic"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: listening, busy: !!busy }}
        accessibilityHint={listening ? 'Tap to send' : 'Tap to talk, or press and hold'}
        onPressIn={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          onPressIn();
        }}
        onPressOut={onPressOut}
        hitSlop={12}
        style={({ pressed }) => ({ width: d, height: d, borderRadius: d / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}
      >
        <Icon name={listening ? 'radio-button-on' : 'mic'} size={drive ? 44 : 32} color={fg} />
      </Pressable>
    </View>
  );
}
