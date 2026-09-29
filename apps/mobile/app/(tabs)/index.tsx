/**
 * Explore: map + companion surfaces. Switches to the DRIVE HUD automatically when the server's
 * `state` directive says drive-safe (E1) — the user never has to select a mode.
 */
import { guideById } from '@city/core';
import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaptionCard, DriveHud, ListeningSheet, NavigateCard, NowPlayingCard, QuietCard, ResultsStrip, StatusBanners } from '../../src/components/companion';
import { MapPanel } from '../../src/components/MapPanel';
import { MicButton } from '../../src/components/MicButton';
import { Button, Card, Chip, IconButton, T } from '../../src/components/ui';
import { companionStore } from '../../src/store/companion';
import { useCompanion, useT } from '../../src/store/hooks';
import { radius, space, useTheme } from '../../src/theme/theme';

export default function Explore() {
  const snap = useCompanion();
  const t = useT();
  const { c } = useTheme();
  const store = companionStore();
  const view = snap.view;
  const guide = guideById(snap.settings.guideId);

  if (view.driveSafe && snap.sessionActive) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
        <View style={{ height: '28%', borderBottomWidth: 1, borderColor: c.line }}>
          <MapPanel position={snap.position} view={view} trail={snap.trail} drive label={t.explore} />
        </View>
        <DriveHud snap={snap} t={t} onMicIn={() => void store.micDown()} onMicOut={() => store.micUp()} onStop={() => store.skip()} />
      </SafeAreaView>
    );
  }

  const conn =
    snap.transport.kind === 'live'
      ? { label: snap.transport.health === 'online' ? t.live : t.degradedBanner, tone: snap.transport.health === 'online' ? ('ok' as const) : ('warn' as const) }
      : { label: t.offlineDemo, tone: 'info' as const };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <MapPanel position={snap.position} view={view} trail={snap.trail} drive={false} label={t.explore} onPressMap={snap.locationMode === 'manual' ? (p) => store.moveManual(p) : undefined} />
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={[styles.header, { backgroundColor: c.surface, borderColor: c.line }]}>
          <T v="headline" style={{ flex: 1 }} accessibilityRole="header">
            {t.appName}
          </T>
          <Chip label={conn.label} tone={conn.tone} />
          <IconButton icon="flask-outline" label={t.simulation} onPress={() => router.push('/simulation')} />
          {snap.sessionActive ? <IconButton icon="power" label={t.stopSim} onPress={() => void store.endSession()} /> : null}
        </View>
        <View style={{ paddingHorizontal: space['3'] }}>
          <StatusBanners snap={snap} t={t} onEnableLocation={() => void store.startGps().then((ok) => (ok ? undefined : Linking.openSettings()))} />
        </View>
      </SafeAreaView>

      <View style={styles.bottom} pointerEvents="box-none">
        <ScrollView style={{ maxHeight: '62%' }} contentContainerStyle={{ gap: space['3'], padding: space['3'] }} keyboardShouldPersistTaps="handled">
          {!snap.sessionActive ? (
            <Card>
              <T v="title-2">{t.obDoneTitle}</T>
              <T v="body-sm" color={c.text2}>
                {t.promise}
              </T>
              <Button label={t.start} icon="navigate" onPress={() => void store.startGps()} />
              <Button kind="ghost" label={t.simulation} icon="flask-outline" onPress={() => router.push('/simulation')} />
            </Card>
          ) : snap.listening.active ? (
            <ListeningSheet
              l={snap.listening}
              drive={view.driveSafe}
              t={t}
              onSubmitText={(s) => store.submitText(s)}
              onCancel={() => store.cancelListening()}
              onTypeInstead={() => store.typeInstead()}
              onDone={() => store.finishListening()}
            />
          ) : view.nowPlaying ? (
            <NowPlayingCard
              np={view.nowPlaying}
              guideId={snap.settings.guideId}
              guideName={guide?.name ?? 'Ida'}
              t={t}
              onPause={() => store.pauseStory()}
              onResume={() => store.resumeStory()}
              onSkip={() => store.skip()}
              onNotThat={() => store.notThatOne()}
            />
          ) : view.caption ? (
            <CaptionCard text={view.caption.text} t={t} />
          ) : (
            <QuietCard view={view} t={t} guideId={snap.settings.guideId} />
          )}
          {snap.sessionActive ? <ResultsStrip view={view} units={snap.settings.units} t={t} /> : null}
          {view.navigate ? <NavigateCard name={view.navigate.name} t={t} onOpen={() => void store.openNavigation()} onDismiss={() => store.clearNavigate()} /> : null}
        </ScrollView>
        {snap.sessionActive ? (
          <View style={[styles.micRow, { backgroundColor: c.bg, borderTopColor: c.line }]}>
            <MicButton listening={snap.listening.active && !!snap.listening.engine} busy={snap.listening.busy} onPressIn={() => void store.micDown()} onPressOut={() => store.micUp()} label={t.holdToTalk} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, gap: space['2'] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space['2'], marginHorizontal: space['3'], marginTop: space['2'], paddingLeft: space['4'], paddingRight: space['1'], paddingVertical: space['1'], borderRadius: radius.pill, borderWidth: 1 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  micRow: { alignItems: 'center', paddingVertical: space['1'], borderTopWidth: StyleSheet.hairlineWidth },
});
