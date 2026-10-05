/**
 * Guest-first onboarding: no account, no sign-up. Permission rationale screens come BEFORE the
 * OS prompts (and every prompt can be skipped): location (when-in-use, then optional
 * background for locked-screen driving), microphone (push-to-talk only).
 */
import { EMIL, IDA } from '@city/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { GuideAvatar } from '../src/components/companion';
import { Banner, Button, Card, Icon, Screen, T, type IconName } from '../src/components/ui';
import { companionStore } from '../src/store/companion';
import { useCompanion, useT } from '../src/store/hooks';
import { guideColor, radius, space, useTheme } from '../src/theme/theme';

type Step = 'welcome' | 'guide' | 'location' | 'background' | 'mic' | 'done';
const ORDER: Step[] = ['welcome', 'guide', 'location', 'background', 'mic', 'done'];

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MARK = require('../assets/brand/splash-mark.png') as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MARK_DARK = require('../assets/brand/splash-mark-dark.png') as number;

export default function Onboarding() {
  const t = useT();
  const snap = useCompanion();
  const { c, name } = useTheme();
  const store = companionStore();
  const [step, setStep] = useState<Step>('welcome');
  const [busy, setBusy] = useState(false);
  const next = () => setStep(ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(step) + 1)]!);
  const perms = snap.permissions.location;

  const finish = async (mode: 'gps' | 'demo') => {
    setBusy(true);
    await store.completeOnboarding();
    router.replace('/(tabs)');
    if (mode === 'gps' && perms.foreground === 'granted') void store.startGps();
    else void store.startManual();
    setBusy(false);
  };

  const Dots = (
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }} accessibilityLabel={`Step ${ORDER.indexOf(step) + 1} of ${ORDER.length}`}>
      {ORDER.map((s) => (
        <View key={s} style={{ width: s === step ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: s === step ? c.brand : c.line }} />
      ))}
    </View>
  );

  const Rationale = ({ icon, title, body, extra }: { icon: IconName; title: string; body: string; extra?: string }) => (
    <View style={{ gap: space['4'] }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.infoBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={30} color={c.info} />
      </View>
      <T v="title-1" accessibilityRole="header">
        {title}
      </T>
      <T v="body" color={c.text2}>
        {body}
      </T>
      {extra ? (
        <T v="body-sm" color={c.text3}>
          {extra}
        </T>
      ) : null}
    </View>
  );

  return (
    <Screen edges={['top', 'bottom']}>
      {Dots}
      {step === 'welcome' ? (
        <View style={{ gap: space['5'] }}>
          <Image source={name === 'light' ? MARK : MARK_DARK} style={{ width: 88, height: 88 }} accessibilityIgnoresInvertColors accessibilityLabel="Telvey" />
          <T v="display" accessibilityRole="header">
            {t.appName}
          </T>
          <T v="title-2">{t.obWelcomeTitle}</T>
          <T v="body" color={c.text2}>
            {t.obWelcomeBody}
          </T>
          <Banner text={t.obGuestNote} tone="info" icon="person-circle-outline" />
          <Button label={t.continue} onPress={next} big />
        </View>
      ) : null}

      {step === 'guide' ? (
        <View style={{ gap: space['4'] }}>
          <T v="title-1" accessibilityRole="header">
            {t.obGuideTitle}
          </T>
          <T v="body" color={c.text2}>
            {t.obGuideBody}
          </T>
          {[IDA, EMIL].map((g) => {
            const on = snap.settings.guideId === g.id;
            const gc = guideColor(c, g.id);
            return (
              <Pressable
                key={g.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                accessibilityLabel={`${g.name}. ${g.tagline}`}
                onPress={() => void store.updateSettings({ guideId: g.id as 'ida' | 'emil' })}
              >
                <Card accent={on ? gc.main : c.line} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: on ? 2 : 1 }}>
                  <GuideAvatar guideId={g.id} sizeDp={56} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="headline">{g.name}</T>
                    <T v="body-sm" color={c.text2}>
                      {g.tagline}
                    </T>
                  </View>
                  {on ? <Icon name="checkmark-circle" color={gc.main} /> : null}
                </Card>
              </Pressable>
            );
          })}
          <Button label={t.continue} onPress={next} big />
        </View>
      ) : null}

      {step === 'location' ? (
        <View style={{ gap: space['5'] }}>
          <Rationale icon="location" title={t.obLocationTitle} body={t.obLocationBody} />
          {perms.foreground === 'denied' ? <Banner text={t.locationDenied} tone="warn" icon="alert-circle" action={{ label: t.openSettings, onPress: () => void Linking.openSettings() }} /> : null}
          <Button
            label={perms.foreground === 'granted' ? t.continue : t.allow}
            busy={busy}
            big
            onPress={async () => {
              if (perms.foreground !== 'granted') {
                setBusy(true);
                const p = await store.requestLocationPermission();
                setBusy(false);
                if (p.foreground !== 'granted') return;
              }
              next();
            }}
          />
          <Button kind="ghost" label={t.obManualMode} onPress={() => setStep('mic')} />
        </View>
      ) : null}

      {step === 'background' ? (
        <View style={{ gap: space['5'] }}>
          <Rationale icon="car-sport" title={t.settingsBackground} body={t.obLocationAlways} extra={t.privacyNote} />
          <Button
            label={perms.background === 'granted' ? t.continue : t.allow}
            busy={busy}
            big
            onPress={async () => {
              if (perms.background !== 'granted' && perms.foreground === 'granted') {
                setBusy(true);
                await store.requestBackgroundLocation();
                setBusy(false);
              }
              next();
            }}
          />
          <Button kind="ghost" label={t.notNow} onPress={next} />
        </View>
      ) : null}

      {step === 'mic' ? (
        <View style={{ gap: space['5'] }}>
          <Rationale icon="mic" title={t.obMicTitle} body={t.obMicBody} />
          <Button
            label={snap.permissions.mic === 'granted' ? t.continue : t.allow}
            busy={busy}
            big
            onPress={async () => {
              if (snap.permissions.mic !== 'granted') {
                setBusy(true);
                await store.requestMicPermission();
                setBusy(false);
              }
              next();
            }}
          />
          <Button kind="ghost" label={t.notNow} onPress={next} />
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={{ gap: space['5'] }}>
          <View style={{ width: 64, height: 64, borderRadius: radius.xl, backgroundColor: c.successBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checkmark" size={32} color={c.success} />
          </View>
          <T v="title-1" accessibilityRole="header">
            {t.obDoneTitle}
          </T>
          <T v="body" color={c.text2}>
            {t.obDoneBody}
          </T>
          {perms.foreground === 'granted' ? (
            <Button label={t.start} icon="navigate" big busy={busy} onPress={() => void finish('gps')} />
          ) : (
            <>
              <Banner text={t.locationDenied} tone="warn" icon="flask" />
              <Button label={t.start} icon="flask" big busy={busy} onPress={() => void finish('demo')} />
            </>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
