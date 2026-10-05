/**
 * Companion surfaces: now-playing card, quiet stretch, listening sheet, nearby results, navigation
 * hand-off, status banners and the DRIVE HUD. Everything renders server directives (D-002).
 */
import { driveStatusLine, formatDistance, formatDuration, type CompanionView, type NowPlaying } from '@city/client';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { MDict } from '../i18n';
import type { ListeningState, Snapshot } from '../store/companion';
import { guideColor, radius, size, space, typeStyle, useTheme } from '../theme/theme';
import { MicButton } from './MicButton';
import { Banner, Button, Card, Chip, Icon, IconButton, T } from './ui';

const AVATARS = {
  ida: require('../../assets/guides/ida/avatar.png') as number,
  emil: require('../../assets/guides/emil/avatar.png') as number,
};

export function GuideAvatar({ guideId, sizeDp = 40 }: { guideId: string; sizeDp?: number }) {
  const { c } = useTheme();
  const g = guideColor(c, guideId);
  return (
    <Image
      source={guideId === 'emil' ? AVATARS.emil : AVATARS.ida}
      style={{ width: sizeDp, height: sizeDp, borderRadius: sizeDp / 2, borderWidth: 2, borderColor: g.main }}
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

export function NowPlayingCard({ np, guideId, guideName, t, onPause, onResume, onSkip, onNotThat }: { np: NowPlaying; guideId: string; guideName: string; t: MDict; onPause: () => void; onResume: () => void; onSkip: () => void; onNotThat: () => void }) {
  const { c } = useTheme();
  const g = guideColor(c, guideId);
  const seg = np.segments.find((s) => s.index === np.segmentIndex) ?? np.segments[0];
  const remainingMs = np.segments.filter((s) => s.index >= np.segmentIndex).reduce((a, s) => a + s.durationMs, 0) - (seg ? seg.durationMs * np.segmentProgress : 0);
  const pos = np.segments.findIndex((s) => s.index === np.segmentIndex) + 1;
  const statusLabel = np.status === 'paused' ? t.paused : np.status === 'interrupted' ? t.interrupted : null;
  return (
    <Card accent={g.main} style={{ gap: space['3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}>
        <GuideAvatar guideId={guideId} />
        <View style={{ flex: 1 }}>
          <T v="overline" color={g.ink}>
            {`${t.nowTelling} · ${guideName}`}
          </T>
          <T v="title-2" numberOfLines={2} accessibilityRole="header">
            {np.placeName}
          </T>
          {np.spatialCue ? (
            <T v="body-sm" color={c.text2} numberOfLines={1}>
              {np.spatialCue}
            </T>
          ) : null}
        </View>
      </View>
      {np.bridgeText ? (
        <T v="story" color={c.text2} style={{ fontStyle: 'italic' }}>
          {np.bridgeText}
        </T>
      ) : null}
      {seg ? (
        <ScrollView style={{ maxHeight: 140 }} accessibilityLabel={seg.text}>
          <T v="story">{seg.text}</T>
        </ScrollView>
      ) : null}
      <View style={[styles.progress, { backgroundColor: c.surface2 }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(np.segmentProgress * 100) }}>
        <View style={{ width: `${Math.round(np.segmentProgress * 100)}%`, height: '100%', backgroundColor: g.main, borderRadius: radius.pill }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'], alignItems: 'center' }}>
        <T v="caption" color={c.text3}>
          {`${t.segmentOf(Math.max(1, pos), np.segments.length)} · ${t.left(formatDuration(remainingMs))}`}
        </T>
        {np.audio === 'device' ? <Chip label={t.deviceVoice} tone="warn" icon="volume-medium" /> : null}
        {np.audio === 'text' ? <Chip label={t.textOnly} tone="warn" icon="text" /> : null}
        {statusLabel ? <Chip label={statusLabel} tone="info" /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space['2'] }}>
        {np.status === 'playing' ? <Button kind="secondary" icon="pause" label={t.pause} onPress={onPause} style={{ flex: 1 }} /> : <Button kind="primary" icon="play" label={t.resume} onPress={onResume} style={{ flex: 1 }} />}
        <IconButton icon="play-skip-forward" label={t.skip} onPress={onSkip} />
        <IconButton icon="thumbs-down-outline" label={t.notThatOne} onPress={onNotThat} />
      </View>
    </Card>
  );
}

export function QuietCard({ view, t, guideId }: { view: CompanionView; t: MDict; guideId: string }) {
  const { c } = useTheme();
  const reason = view.silence ? t.silence[view.silence] : null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}>
        <GuideAvatar guideId={guideId} sizeDp={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="headline">{view.silence === 'no_fix' ? t.noFix : view.silence === 'warming_up' ? t.warmingUp : t.quietTitle}</T>
          <T v="body-sm" color={c.text2}>
            {view.silence === 'no_fix' || view.silence === 'warming_up' ? (reason ?? '') : t.quietBody}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space['2'], flexWrap: 'wrap' }}>
        <Chip label={t.regime[view.regime] ?? view.regime} icon={view.regime.includes('driving') ? 'car' : view.regime === 'walking' ? 'walk' : 'location'} />
        <Chip label={t.density[view.density] ?? view.density} />
        {reason && view.silence !== 'no_fix' && view.silence !== 'warming_up' ? <Chip label={reason} tone="info" /> : null}
      </View>
    </Card>
  );
}

export function CaptionCard({ text, t }: { text: string; t: MDict }) {
  const { c } = useTheme();
  return (
    <Card>
      <T v="overline" color={c.text3}>
        {t.answering}
      </T>
      <T v="story" accessibilityRole="text">
        {text}
      </T>
    </Card>
  );
}

export function ResultsStrip({ view, units, t }: { view: CompanionView; units: 'metric' | 'imperial'; t: MDict }) {
  const { c } = useTheme();
  if (!view.results?.length) return null;
  return (
    <View style={{ gap: space['2'] }}>
      <T v="overline" color={c.text3} accessibilityRole="header">
        {t.results}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space['2'] }}>
        {view.results.map((r) => (
          <View key={r.placeId} style={[styles.result, { backgroundColor: c.surface, borderColor: c.line }]} accessible accessibilityLabel={`${r.name}, ${formatDistance(r.distanceM, units)}`}>
            <T v="body" numberOfLines={1}>
              {r.name}
            </T>
            <T v="caption" color={c.text3}>
              {formatDistance(r.distanceM, units)}
            </T>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function NavigateCard({ name, t, onOpen, onDismiss }: { name: string; t: MDict; onOpen: () => void; onDismiss: () => void }) {
  return (
    <Card>
      <T v="headline">{name}</T>
      <View style={{ flexDirection: 'row', gap: space['2'] }}>
        <Button icon="navigate" label={t.navigate} onPress={onOpen} style={{ flex: 1 }} />
        <IconButton icon="close" label={t.close} onPress={onDismiss} />
      </View>
    </Card>
  );
}

export function ListeningSheet({ l, drive, t, onSubmitText, onCancel, onTypeInstead, onDone }: { l: ListeningState; drive: boolean; t: MDict; onSubmitText: (s: string) => void; onCancel: () => void; onTypeInstead: () => void; onDone: () => void }) {
  const { c } = useTheme();
  const [text, setText] = useState('');
  if (!l.active) return null;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Card style={{ borderColor: c.listening }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
          <Icon name={l.mode === 'text' ? 'create-outline' : 'mic'} color={c.listening} />
          <T v="headline" style={{ flex: 1 }} accessibilityRole="header">
            {l.mode === 'text' ? t.typeQuestion : l.mode === 'prompt' ? t.tapToTalk : t.listening}
          </T>
          <IconButton icon="close" label={t.cancel} onPress={onCancel} />
        </View>
        {l.note ? <Banner text={l.note} tone="warn" icon="alert-circle" /> : null}
        {l.mode === 'text' && !drive ? (
          <View style={{ flexDirection: 'row', gap: space['2'], alignItems: 'center' }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t.listeningHint}
              placeholderTextColor={c.text3}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={() => {
                onSubmitText(text);
                setText('');
              }}
              accessibilityLabel={t.typeQuestion}
              style={[typeStyle('body'), styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.surface2 }]}
            />
            <IconButton
              icon="send"
              label={t.send}
              bg={c.brand}
              color={c.onBrand}
              onPress={() => {
                onSubmitText(text);
                setText('');
              }}
            />
          </View>
        ) : (
          <>
            <T v="story" color={l.partial ? c.text : c.text3} accessibilityLiveRegion="polite">
              {l.partial || t.listeningHint}
            </T>
            <View style={{ flexDirection: 'row', gap: space['2'] }}>
              {l.engine ? <Button label={t.done} icon="checkmark" onPress={onDone} style={{ flex: 1 }} busy={l.busy} /> : null}
              {!drive && !l.busy ? <Button kind="ghost" label={t.typeInstead} icon="create-outline" onPress={onTypeInstead} style={{ flex: 1 }} /> : null}
            </View>
          </>
        )}
      </Card>
    </KeyboardAvoidingView>
  );
}

/** Top banners: simulated location, demo/offline/degraded transport. */
export function StatusBanners({ snap, t, onEnableLocation }: { snap: Snapshot; t: MDict; onEnableLocation?: () => void }) {
  const out: React.ReactNode[] = [];
  const sim = snap.locationMode === 'trace' || snap.locationMode === 'manual' || snap.view.simulated;
  if (sim) out.push(<Banner key="sim" text={t.simulatedBanner} tone="signal" icon="flask" />);
  if (!snap.network) out.push(<Banner key="off" text={t.offlineBanner} tone="warn" icon="cloud-offline" />);
  else if (snap.transport.kind === 'local') out.push(<Banner key="demo" text={`${t.demoBanner}${snap.transport.reason ? ` · ${snap.transport.reason}` : ''}`} tone="info" icon="cube-outline" />);
  else if (snap.transport.health === 'degraded') out.push(<Banner key="deg" text={t.degradedBanner} tone="warn" icon="sync" />);
  if (snap.locationMode === 'manual' && snap.permissions.location.foreground === 'denied' && onEnableLocation)
    out.push(<Banner key="loc" text={t.locationDenied} tone="warn" icon="location-outline" action={{ label: t.locationDeniedAction, onPress: onEnableLocation }} />);
  if (snap.notice) out.push(<Banner key="notice" text={snap.notice} tone="info" icon="information-circle" />);
  return out.length ? <View style={{ gap: space['1'] }}>{out}</View> : null;
}

/**
 * DRIVE HUD (D-008 / E1): dark high-contrast palette, one glanceable line, one big mic, one
 * large stop target. No text input, no lists, no body copy. Nothing needs to be touched to keep
 * ambient discovery running.
 */
export function DriveHud({ snap, t, onMicIn, onMicOut, onStop }: { snap: Snapshot; t: MDict; onMicIn: () => void; onMicOut: () => void; onStop: () => void }) {
  const { c } = useTheme();
  const line = driveStatusLine(snap.view, t, snap.listening.active);
  const speaking = !!snap.view.nowPlaying && snap.view.nowPlaying.status === 'playing';
  const sim = snap.locationMode === 'trace' || snap.locationMode === 'manual' || snap.view.simulated;
  return (
    <View style={[styles.drive, { backgroundColor: c.bg }]} testID="drive-hud" accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', gap: space['2'], flexWrap: 'wrap' }}>
        <View style={[styles.driveChip, { borderColor: c.line }]}>
          <T v="caption" color={c.text2} maxScale={1.2}>
            {`${t.drive.toUpperCase()} · ${t.regime[snap.view.regime] ?? ''}`}
          </T>
        </View>
        {sim ? (
          <View style={[styles.driveChip, { backgroundColor: c.signal, borderColor: c.signal }]}>
            <T v="caption" color={c.onSignal} maxScale={1.2}>
              {t.simulated.toUpperCase()}
            </T>
          </View>
        ) : null}
        {!snap.network ? (
          <View style={[styles.driveChip, { borderColor: c.alert }]}>
            <Icon name="cloud-offline" size={14} color={c.alert} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: space['3'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] }}>
          {speaking ? <View style={[styles.speakDot, { backgroundColor: c.accent }]} /> : null}
          <T v="drive-hero" numberOfLines={2} maxScale={1.15} testID="drive-hero">
            {line}
          </T>
        </View>
        {snap.listening.active && snap.listening.note ? (
          <T v="drive-label" color={c.signal} numberOfLines={1} maxScale={1.1}>
            {snap.listening.note}
          </T>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {speaking ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.stopStory}
            onPress={onStop}
            style={({ pressed }) => [styles.driveStop, { borderColor: c.line, backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 }]}
          >
            <Icon name="stop" size={36} color={c.text} />
          </Pressable>
        ) : (
          <View style={{ width: size.touchDrive }} />
        )}
        <MicButton drive listening={snap.listening.active && !!snap.listening.engine} busy={snap.listening.busy} onPressIn={onMicIn} onPressOut={onMicOut} label={t.holdToTalkDrive} />
        <View style={{ width: size.touchDrive }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { height: 4, borderRadius: radius.pill, overflow: 'hidden' },
  result: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space['3'], paddingVertical: space['2'], minWidth: 140, maxWidth: 220, minHeight: size.touchMin },
  input: { flex: 1, minHeight: size.touchMin, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space['3'] },
  drive: { flex: 1, padding: space['5'], gap: space['4'] },
  driveChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space['3'], paddingVertical: 4 },
  speakDot: { width: 18, height: 18, borderRadius: 9 },
  driveStop: { width: size.touchDrive, height: size.touchDrive, borderRadius: size.touchDrive / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
