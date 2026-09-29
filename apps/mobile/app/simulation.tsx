/**
 * Simulation (dev + demo): replay a fixture trace (subset bundled from /fixtures) into the LIVE
 * API when connected (frames carry simulated: true) or into the offline LocalEngine otherwise.
 * Always bannered; history entries are tagged "simulated". Manual puck mode: tap the map.
 */
import { formatDuration } from '@city/client';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Banner, Button, Card, Chip, Icon, Screen, Section, Segmented, T } from '../src/components/ui';
import { availableScenarios } from '../src/sim/demo-data';
import { companionStore } from '../src/store/companion';
import { useCompanion, useT } from '../src/store/hooks';
import { space, useTheme } from '../src/theme/theme';

export default function Simulation() {
  const snap = useCompanion();
  const t = useT();
  const { c } = useTheme();
  const store = companionStore();
  const scenarios = availableScenarios();
  const sim = snap.sim;
  const last = snap.debug[0];

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T v="title-1" accessibilityRole="header">
          {t.simulation}
        </T>
        <Button kind="ghost" label={t.close} onPress={() => router.back()} />
      </View>
      <Banner text={`${t.simulatedBanner}. ${t.simulationHint}`} tone="signal" icon="flask" />
      <T v="body-sm" color={c.text2}>
        {snap.transport.kind === 'live' ? `${t.live}: frames go to the API with simulated: true.` : `${t.offlineDemo}: ${snap.transport.reason ?? ''}`}
      </T>

      <Section title={t.scenario}>
        {scenarios.length === 0 ? <T v="body-sm">{t.noScenarios}</T> : null}
        {scenarios.map((s) => {
          const on = sim?.scenario === s.name;
          return (
            <Pressable key={s.name} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} accessibilityLabel={`${s.label}. ${s.description}`} onPress={() => void store.selectScenario(s.name)}>
              <Card accent={on ? c.brand : c.line} style={{ borderWidth: on ? 2 : 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
                  <T v="headline" style={{ flex: 1 }}>
                    {s.label}
                  </T>
                  <Chip label={s.guide.name} />
                </View>
                <T v="body-sm" color={c.text2}>
                  {s.description}
                </T>
              </Card>
            </Pressable>
          );
        })}
      </Section>

      {sim ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
            <Icon name="time-outline" />
            <T v="body" style={{ flex: 1 }}>
              {`${formatDuration(sim.elapsedMs)} / ${formatDuration(sim.durationMs)}`}
            </T>
            {sim.done ? <Chip label="done" tone="ok" /> : null}
          </View>
          <View style={[{ height: 4, borderRadius: 2, backgroundColor: c.surface2, overflow: 'hidden' }]}>
            <View style={{ height: '100%', width: `${Math.round((sim.elapsedMs / Math.max(1, sim.durationMs)) * 100)}%`, backgroundColor: c.brand }} />
          </View>
          <Segmented
            label={t.speed}
            value={String(sim.speed) as '1' | '4' | '10' | '20'}
            onChange={(v) => store.setSimSpeed(Number(v))}
            options={['1', '4', '10', '20'].map((v) => ({ value: v as '1' | '4' | '10' | '20', label: `×${v}` }))}
          />
          <View style={{ flexDirection: 'row', gap: space['2'] }}>
            {sim.playing ? (
              <Button kind="secondary" icon="pause" label={t.pauseTrace} onPress={() => store.pauseSim()} style={{ flex: 1 }} />
            ) : (
              <Button
                icon="play"
                label={t.playTrace}
                disabled={sim.done}
                onPress={() => {
                  store.playSim();
                  router.back();
                }}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </Card>
      ) : null}

      <View style={{ gap: space['2'] }}>
        <Button kind="secondary" icon="hand-left-outline" label={t.manualMode} onPress={() => void store.startManual().then(() => router.back())} />
        <Button kind="ghost" icon="navigate-outline" label={t.useRealLocation} onPress={() => void store.startGps().then(() => router.back())} />
      </View>

      <Section title="Debug">
        <T v="caption" color={c.text3}>
          {`regime ${snap.view.regime} · density ${snap.view.density} · driveSafe ${snap.view.driveSafe} · silence ${snap.view.silence ?? '—'} · directives ${snap.view.directiveCount}`}
        </T>
        {last ? (
          <T v="caption" color={c.text3}>
            {`last decision: ${last.decision}${last.reason ? ` (${last.reason})` : ''}${last.target ? ` → ${last.target}` : ''}`}
          </T>
        ) : null}
        <T v="caption" color={c.text3}>
          {`barge-in stop p50 ${snap.bargeStats.p50?.toFixed(0) ?? '—'} ms · p95 ${snap.bargeStats.p95?.toFixed(0) ?? '—'} ms (n=${snap.bargeIns.length})`}
        </T>
      </Section>
    </Screen>
  );
}
