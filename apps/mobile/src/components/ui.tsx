/**
 * UI primitives on brand tokens. Accessibility: every control has a role + label, touch targets
 * are ≥ 48 dp (tokens.size.touch-min; ≥ 44 pt iOS guideline) and ≥ 76–96 dp in drive mode, text
 * scales with the OS font size (capped where a layout must not reflow).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, size, space, typeStyle, useTheme, type TypeVariant } from '../theme/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function T({
  v = 'body',
  color,
  style,
  children,
  numberOfLines,
  maxScale,
  accessibilityRole,
  accessibilityLiveRegion,
  testID,
}: {
  v?: TypeVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  maxScale?: number;
  accessibilityRole?: 'header' | 'text' | 'link';
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Text
      style={[typeStyle(v), { color: color ?? c.text }, style]}
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={maxScale ?? (v.startsWith('drive') ? 1.2 : 1.8)}
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion={accessibilityLiveRegion}
      testID={testID}
    >
      {children}
    </Text>
  );
}

export function Icon({ name, size: s = size.iconMd, color }: { name: IconName; size?: number; color?: string }) {
  const { c } = useTheme();
  return <Ionicons name={name} size={s} color={color ?? c.text} accessibilityElementsHidden importantForAccessibility="no" />;
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  hint,
  style,
  big,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
  testID?: string;
}) {
  const { c, name } = useTheme();
  const bg = kind === 'primary' ? c.brand : kind === 'accent' ? c.accent : kind === 'danger' ? c.error : kind === 'secondary' ? c.surface2 : 'transparent';
  const fg = kind === 'primary' ? c.onBrand : kind === 'accent' ? c.onAccent : kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? c.brand : c.text;
  const minH = big || name === 'drive' ? size.touchDrive : size.touchMin;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        { minHeight: minH, backgroundColor: bg, borderColor: kind === 'ghost' ? c.line : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={size.iconSm} /> : null}
      <T v={big || name === 'drive' ? 'drive-label' : 'headline'} color={fg} maxScale={1.4} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color, bg, sizeDp = size.touchMin, disabled }: { icon: IconName; label: string; onPress: () => void; color?: string; bg?: string; sizeDp?: number; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: sizeDp, height: sizeDp, borderRadius: sizeDp / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg ?? c.surface2, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 })}
    >
      <Icon name={icon} color={color ?? c.text} size={Math.round(sizeDp * 0.46)} />
    </Pressable>
  );
}

export function Card({ children, style, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; accent?: string }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: accent ?? c.line }, style]}>{children}</View>;
}

export function Chip({ label, tone = 'neutral', icon }: { label: string; tone?: 'neutral' | 'signal' | 'warn' | 'ok' | 'error' | 'info'; icon?: IconName }) {
  const { c } = useTheme();
  const map = {
    neutral: [c.surface2, c.text2],
    signal: [c.signal, c.onSignal],
    warn: [c.warnBg, c.warn],
    ok: [c.successBg, c.success],
    error: [c.errorBg, c.error],
    info: [c.infoBg, c.info],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]} accessible accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <T v="caption" color={fg} numberOfLines={1} maxScale={1.4}>
        {label}
      </T>
    </View>
  );
}

export function Banner({ text, tone = 'signal', icon, action }: { text: string; tone?: 'signal' | 'warn' | 'info' | 'error'; icon?: IconName; action?: { label: string; onPress: () => void } }) {
  const { c } = useTheme();
  const bg = tone === 'signal' ? c.signal : tone === 'warn' ? c.warnBg : tone === 'error' ? c.errorBg : c.infoBg;
  const fg = tone === 'signal' ? c.onSignal : tone === 'warn' ? c.warn : tone === 'error' ? c.error : c.info;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <T v="caption" color={fg} style={{ flex: 1 }} maxScale={1.5}>
        {text}
      </T>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={10} style={{ minHeight: 32, justifyContent: 'center' }}>
          <T v="caption" color={fg} style={{ textDecorationLine: 'underline' }}>
            {action.label}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: c.surface2 }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, on ? { backgroundColor: c.surface, borderColor: c.line } : null]}
          >
            <T v="body-sm" color={on ? c.text : c.text2} numberOfLines={1} maxScale={1.4} style={on ? { fontFamily: typeStyle('headline').fontFamily } : null}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ label, detail, children, onPress, icon }: { label: string; detail?: string; children?: ReactNode; onPress?: () => void; icon?: IconName }) {
  const { c } = useTheme();
  const body = (
    <View style={[styles.row, { borderBottomColor: c.line }]}>
      {icon ? <Icon name={icon} color={c.text2} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T v="body">{label}</T>
        {detail ? (
          <T v="caption" color={c.text3}>
            {detail}
          </T>
        ) : null}
      </View>
      {children}
      {onPress ? <Icon name="chevron-forward" color={c.text3} size={18} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T v="overline" color={c.text3} accessibilityRole="header">
          {title}
        </T>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Screen({ children, scroll = true, edges = ['top'] }: { children: ReactNode; scroll?: boolean; edges?: Array<'top' | 'bottom' | 'left' | 'right'> }) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ padding: space['4'], gap: space['6'], paddingBottom: space['16'] }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space['3'], paddingVertical: space['8'] }} accessible accessibilityLabel={`${title}. ${body ?? ''}`}>
      <Icon name={icon} size={40} color={c.idle} />
      <T v="headline" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? (
        <T v="body-sm" color={c.text2} style={{ textAlign: 'center' }}>
          {body}
        </T>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space['2'], paddingHorizontal: space['5'], borderRadius: radius.pill, borderWidth: 1 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space['4'], gap: space['3'] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space['2'], paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space['2'], paddingHorizontal: space['3'], paddingVertical: space['2'], borderRadius: radius.md },
  seg: { flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  segItem: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: space['2'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space['3'], minHeight: size.touchMin + 8, paddingVertical: space['2'], borderBottomWidth: StyleSheet.hairlineWidth },
});
