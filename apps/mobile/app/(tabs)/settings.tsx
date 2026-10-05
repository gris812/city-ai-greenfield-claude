/**
 * Settings: guide, talkativeness, units, language, voice input/output, background session,
 * connection, simulation, delete my data, and the hidden "Operator access" entry (long-press
 * the version row, or it is shown once this phone is paired).
 */
import { EMIL, IDA } from '@city/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, Switch, View } from 'react-native';
import { Banner, Button, Row, Screen, Section, Segmented, T } from '../../src/components/ui';
import { config } from '../../src/config';
import type { Settings } from '../../src/logic/settings';
import { companionStore } from '../../src/store/companion';
import { useAdmin, useCompanion, useT } from '../../src/store/hooks';
import { space, useTheme } from '../../src/theme/theme';

export default function SettingsScreen() {
  const snap = useCompanion();
  const admin = useAdmin();
  const t = useT();
  const { c } = useTheme();
  const store = companionStore();
  const s = snap.settings;
  const [revealOps, setRevealOps] = useState(false);
  const [taps, setTaps] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const set = (p: Partial<Settings>) => void store.updateSettings(p);
  const bgPerm = snap.permissions.location.background;

  const confirmDelete = () =>
    Alert.alert(t.deleteData, t.deleteDataBody, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.deleteConfirm,
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const r = await store.deleteData();
          setDeleting(false);
          Alert.alert(t.deleteData, r.server === 'failed' ? t.deleteFailed : t.deleted);
          router.replace('/onboarding');
        },
      },
    ]);

  return (
    <Screen>
      <T v="title-1" accessibilityRole="header">
        {t.settings}
      </T>

      <Section title={t.settingsGuide}>
        <Segmented label={t.settingsGuide} value={s.guideId} onChange={(v) => set({ guideId: v })} options={[IDA, EMIL].map((g) => ({ value: g.id as 'ida' | 'emil', label: g.name }))} />
      </Section>

      <Section title={t.settingsTalk}>
        <Segmented
          label={t.settingsTalk}
          value={String(s.talkativeness) as '-2' | '-1' | '0' | '1' | '2'}
          onChange={(v) => set({ talkativeness: Number(v) })}
          options={[
            { value: '-2', label: t.quieter },
            { value: '-1', label: '−1' },
            { value: '0', label: '0' },
            { value: '1', label: '+1' },
            { value: '2', label: t.chattier },
          ]}
        />
      </Section>

      <Section title={t.settingsUnits}>
        <Segmented label={t.settingsUnits} value={s.units} onChange={(v) => set({ units: v })} options={[{ value: 'metric', label: t.metric }, { value: 'imperial', label: t.imperial }]} />
      </Section>

      <Section title={t.settingsLanguage}>
        <Segmented label={t.settingsLanguage} value={s.locale} onChange={(v) => set({ locale: v })} options={[{ value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }]} />
      </Section>

      <Section title={t.settingsVoiceInput}>
        <Segmented label={t.settingsVoiceInput} value={s.stt} onChange={(v) => set({ stt: v })} options={[{ value: 'auto', label: t.sttAuto }, { value: 'device', label: t.sttDevice }, { value: 'server', label: t.sttServer }]} />
        {snap.permissions.mic === 'denied' ? <Banner text={t.micDenied} tone="warn" icon="mic-off" action={{ label: t.openSettings, onPress: () => void Linking.openSettings() }} /> : null}
      </Section>

      <View>
        <Row label={t.settingsVoiceOutput} icon="volume-high-outline">
          <Switch value={s.voice} onValueChange={(v) => set({ voice: v })} accessibilityLabel={t.settingsVoiceOutput} />
        </Row>
        <Row label={t.settingsBackground} detail={bgPerm === 'granted' ? undefined : t.backgroundDenied} icon="lock-closed-outline">
          <Switch
            value={s.backgroundLocation && bgPerm === 'granted'}
            onValueChange={async (v) => {
              if (v && bgPerm !== 'granted') {
                const ok = await store.requestBackgroundLocation();
                if (!ok) void Linking.openSettings();
              }
              set({ backgroundLocation: v });
            }}
            accessibilityLabel={t.settingsBackground}
          />
        </Row>
      </View>

      <Section title={t.settingsConnection}>
        <Segmented label={t.settingsConnection} value={s.transport} onChange={(v) => set({ transport: v })} options={[{ value: 'auto', label: t.connAuto }, { value: 'live', label: t.connLive }, { value: 'local', label: t.connDemo }]} />
        {!config.apiBaseUrl ? <Banner text={t.apiNotConfigured} tone="info" icon="cloud-offline-outline" /> : null}
      </Section>

      <View>
        <Row label={t.simulation} detail={t.simulationHint} icon="flask-outline" onPress={() => router.push('/simulation')} />
        {revealOps || admin.session ? <Row label={t.operatorAccess} icon="shield-checkmark-outline" onPress={() => router.push('/admin')} /> : null}
      </View>

      <Section title={t.deleteData}>
        <T v="body-sm" color={c.text2}>
          {t.deleteDataBody}
        </T>
        <Button kind="danger" icon="trash-outline" label={t.deleteData} onPress={confirmDelete} busy={deleting} />
      </Section>

      <Section title={t.about}>
        <T v="body-sm" color={c.text2}>
          {t.privacyNote}
        </T>
        <Pressable
          accessibilityRole="text"
          accessibilityLabel={`${t.version} ${config.appVersion} (${config.buildNumber})`}
          onLongPress={() => setRevealOps(true)}
          onPress={() => {
            const n = taps + 1;
            setTaps(n);
            if (n >= 7) setRevealOps(true);
          }}
          delayLongPress={800}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <T v="caption" color={c.text3}>
            {`${t.version} ${config.appVersion} (${config.buildNumber}) · ${config.variant} · ${snap.transport.kind}`}
          </T>
        </Pressable>
      </Section>
      <View style={{ height: space['8'] }} />
    </Screen>
  );
}
