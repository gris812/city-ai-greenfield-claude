/**
 * Theme from the brand tokens (single source of truth: /assets/brand/tokens.json). Three
 * palettes: light, dark and DRIVE (high-contrast, glanceable, ≥ 7:1 for every text pair).
 * Sizes are dp; type sizes scale with the OS font size (allowFontScaling) except in drive mode,
 * where the scale is capped so the one status line never wraps into body copy.
 */
import { createContext, useContext } from 'react';
import type { TextStyle } from 'react-native';
import tokens from '../../../../assets/brand/tokens.json';

export type ThemeName = 'light' | 'dark' | 'drive';

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  text: string;
  text2: string;
  text3: string;
  brand: string;
  onBrand: string;
  accent: string;
  onAccent: string;
  accentText: string;
  indicator: string;
  focus: string;
  listening: string;
  speaking: string;
  idle: string;
  signal: string;
  onSignal: string;
  ok: string;
  alert: string;
  route: string;
  poiAhead: string;
  poiMuted: string;
  warn: string;
  warnBg: string;
  error: string;
  errorBg: string;
  success: string;
  successBg: string;
  info: string;
  infoBg: string;
  guide: { ida: string; idaSoft: string; idaInk: string; emil: string; emilSoft: string; emilInk: string };
}

const c = tokens.color;
const guide = {
  ida: c.guide.ida,
  idaSoft: c.guide['ida-soft'],
  idaInk: c.guide['ida-ink'],
  emil: c.guide.emil,
  emilSoft: c.guide['emil-soft'],
  emilInk: c.guide['emil-ink'],
};
const semantic = {
  warn: c.semantic.warn,
  warnBg: c.semantic['warn-bg'],
  error: c.semantic.error,
  errorBg: c.semantic['error-bg'],
  success: c.semantic.success,
  successBg: c.semantic['success-bg'],
  info: c.semantic.info,
  infoBg: c.semantic['info-bg'],
};

function base(t: typeof tokens.theme.light): Omit<Palette, 'signal' | 'onSignal' | 'ok' | 'alert' | 'route' | 'poiAhead' | 'poiMuted' | keyof typeof semantic | 'guide'> {
  return {
    bg: t.bg,
    surface: t.surface,
    surface2: t['surface-2'],
    line: t.line,
    text: t.text,
    text2: t['text-2'],
    text3: t['text-3'],
    brand: t.brand,
    onBrand: t['on-brand'],
    accent: t.accent,
    onAccent: t['on-accent'],
    accentText: t['accent-text'],
    indicator: t.indicator,
    focus: t.focus,
    listening: t.listening,
    speaking: t.speaking,
    idle: t.idle,
  };
}

const d = tokens.theme.drive;

export const PALETTES: Record<ThemeName, Palette> = {
  light: { ...base(tokens.theme.light), signal: c.accent['amber-400'], onSignal: c.neutral.ink, ok: c.semantic.success, alert: c.semantic.error, route: c.brand['petrol-500'], poiAhead: c.accent['ember-600'], poiMuted: c.neutral['stone-400'], ...semantic, guide },
  dark: { ...base(tokens.theme.dark), signal: c.accent['amber-400'], onSignal: c.neutral.ink, ok: '#5EE0A0', alert: '#FF6B5E', route: c.brand['petrol-300'], poiAhead: c.accent['ember-400'], poiMuted: '#4F7C85', ...semantic, warnBg: '#3A2E12', errorBg: '#3A1714', successBg: '#12321F', infoBg: '#124652', guide },
  drive: {
    bg: d.bg,
    surface: d.surface,
    surface2: d['surface-2'],
    line: d.line,
    text: d.text,
    text2: d['text-2'],
    text3: d['text-2'],
    brand: d.text,
    onBrand: d.bg,
    accent: d.voice,
    onAccent: d.bg,
    accentText: d.voice,
    indicator: d.voice,
    focus: d.signal,
    listening: d.voice,
    speaking: d.ok,
    idle: d['poi-muted'],
    signal: d.signal,
    onSignal: d['on-signal'],
    ok: d.ok,
    alert: d.alert,
    route: d.route,
    poiAhead: d['poi-ahead'],
    poiMuted: d['poi-muted'],
    ...semantic,
    warn: d.signal,
    warnBg: d.surface,
    error: d.alert,
    errorBg: d.surface,
    guide,
  },
};

export const space = tokens.space as unknown as Record<'0' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12' | '16' | '20', number>;
export const radius = tokens.radius;
export const size = {
  touchMin: tokens.size['touch-min'],
  touchDrive: tokens.size['touch-drive'],
  mic: tokens.size['mic-button'],
  micDrive: tokens.size['mic-button-drive'],
  iconSm: tokens.size['icon-sm'],
  iconMd: tokens.size['icon-md'],
  iconLg: tokens.size['icon-lg'],
};
export const motion = tokens.motion.duration;

/** Font family keys registered by useFonts in app/_layout.tsx (bundled, no network). */
export const FONT = {
  sans: { 400: 'Onest_400Regular', 500: 'Onest_500Medium', 600: 'Onest_600SemiBold', 700: 'Onest_700Bold' } as Record<number, string>,
  serif: { 400: 'Literata_400Regular', 500: 'Literata_400Regular', 600: 'Literata_400Regular', 700: 'Literata_400Regular' } as Record<number, string>,
  serifItalic: 'Literata_400Regular_Italic',
};

export type TypeVariant = 'display' | 'title-1' | 'title-2' | 'headline' | 'body' | 'body-sm' | 'caption' | 'overline' | 'story' | 'story-lg' | 'drive-hero' | 'drive-label';

export function typeStyle(v: TypeVariant): TextStyle {
  const t = tokens.type[v];
  const fam = t.family === 'serif' ? FONT.serif : FONT.sans;
  return {
    fontFamily: fam[t.weight] ?? fam[400],
    fontSize: t.size,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing * t.size,
    ...(v === 'overline' ? { textTransform: 'uppercase' as const } : {}),
  };
}

export interface Theme {
  name: ThemeName;
  c: Palette;
}

export const ThemeContext = createContext<Theme>({ name: 'light', c: PALETTES.light });

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function guideColor(p: Palette, guideId: string): { main: string; soft: string; ink: string } {
  return guideId === 'emil' ? { main: p.guide.emil, soft: p.guide.emilSoft, ink: p.guide.emilInk } : { main: p.guide.ida, soft: p.guide.idaSoft, ink: p.guide.idaInk };
}
