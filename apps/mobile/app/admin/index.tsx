/**
 * Operator dashboard (D-013): health, today's KPIs (sessions, DAU, stories funnel), latency
 * p50/p95, cost today / 7 days, recent errors; owner-only paired-device list. Role-aware: the
 * server enforces roles; sections a role cannot read show their own empty state. When the API is
 * not configured or unreachable, an explicit "API not connected" state — never cached data.
 */
import { roleAtLeast } from '@city/client';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { adminStore } from '../../src/admin/store';
import { Banner, Button, Card, Chip, EmptyState, Icon, IconButton, Section, T } from '../../src/components/ui';
import { config } from '../../src/config';
import { costSummary, errorLines, formatMs, formatUsd, healthLines, kpisFrom, latencyRows } from '../../src/logic/admin';
import { useAdmin, useT } from '../../src/store/hooks';
import { FONT, space, useTheme } from '../../src/theme/theme';

function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 120, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <T v="caption" color={c.text3}>
        {label}
      </T>
      <T v="title-2" style={{ fontFamily: FONT.sans[600] }}>
        {value}
      </T>
    </View>
  );
}

export default function AdminHome() {
  const a = useAdmin();
  const t = useT();
  const { c } = useTheme();
  const store = adminStore();
  const [signingOut, setSigningOut] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (adminStore().getSnapshot().session) void adminStore().refresh();
    }, []),
  );

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
      <IconButton icon="chevron-back" label={t.back} onPress={() => router.back()} />
      <T v="title-1" style={{ flex: 1 }} accessibilityRole="header">
        {t.adminTitle}
      </T>
      {a.session ? <IconButton icon="refresh" label={t.refresh} onPress={() => void store.refresh()} /> : null}
    </View>
  );

  if (!a.session) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
        <ScrollView contentContainerStyle={{ padding: space['4'], gap: space['5'] }}>
          {header}
          {a.error === 'revoked' ? <Banner text={t.revoked} tone="warn" icon="alert-circle" /> : null}
          {!config.apiBaseUrl ? (
            <EmptyState icon="cloud-offline-outline" title={t.apiNotConfigured} body={t.apiNotConnectedAdmin} />
          ) : (
            <Card>
              <T v="title-2">{t.adminConnectTitle}</T>
              <T v="body" color={c.text2}>
                {t.adminConnectBody}
              </T>
              <Button icon="qr-code-outline" label={t.scanQr} onPress={() => router.push({ pathname: '/admin/pair', params: { scan: '1' } })} />
              <Button kind="ghost" icon="keypad-outline" label={t.enterCode} onPress={() => router.push('/admin/pair')} />
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const role = a.session.role;
  const kpis = kpisFrom(a.overview1d);
  const cost = costSummary(a.cost7d, Date.now());
  const lat = latencyRows(a.latency);
  const health = healthLines(a.health);
  const errors = errorLines(a.health);
  const unreachable = a.status === 'unreachable';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space['4'], gap: space['6'] }} refreshControl={<RefreshControl refreshing={a.status === 'loading'} onRefresh={() => void store.refresh()} />}>
        {header}
        <View style={{ flexDirection: 'row', gap: space['2'], flexWrap: 'wrap' }}>
          <Chip label={t.signedInAs(role)} tone="info" icon="shield-checkmark" />
          <Chip label={a.session.deviceName} />
          {a.fetchedAt ? <Chip label={new Date(a.fetchedAt).toLocaleTimeString()} /> : null}
        </View>

        {unreachable ? (
          <EmptyState icon="cloud-offline-outline" title={t.apiNotConfigured} body={t.apiNotConnectedAdmin} action={<Button label={t.retry} icon="refresh" onPress={() => void store.refresh()} />} />
        ) : (
          <>
            <Section title={t.health}>
              <Card>
                {health.length === 0 ? (
                  <T v="body-sm" color={c.text3}>
                    {t.noData}
                  </T>
                ) : (
                  health.map((h) => (
                    <View key={h.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }} accessible accessibilityLabel={`${h.label} ${h.value}`}>
                      <Icon name={h.ok ? 'checkmark-circle' : 'alert-circle'} color={h.ok ? c.success : c.error} size={18} />
                      <T v="body" style={{ flex: 1 }}>
                        {h.label}
                      </T>
                      <T v="body-sm" color={c.text2}>
                        {h.value}
                      </T>
                    </View>
                  ))
                )}
              </Card>
            </Section>

            <Section title={t.today}>
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['4'] }}>
                  <Stat label={t.sessions} value={kpis.sessions?.toString() ?? '—'} />
                  <Stat label={t.dau} value={kpis.dau?.toString() ?? '—'} />
                </View>
                {kpis.funnel.length ? (
                  <View style={{ gap: 6 }}>
                    <T v="caption" color={c.text3}>
                      {t.storiesFunnel}
                    </T>
                    {kpis.funnel.map((f) => {
                      const max = Math.max(1, ...kpis.funnel.map((x) => x.n));
                      return (
                        <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }} accessible accessibilityLabel={`${f.key.replace('story_', '')}: ${f.n}`}>
                          <T v="caption" color={c.text2} style={{ width: 92 }}>
                            {f.key.replace('story_', '')}
                          </T>
                          <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.surface2, overflow: 'hidden' }}>
                            <View style={{ width: `${(f.n / max) * 100}%`, height: '100%', backgroundColor: c.brand }} />
                          </View>
                          <T v="caption" style={{ width: 44, textAlign: 'right', fontFamily: FONT.sans[600] }}>
                            {String(f.n)}
                          </T>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <T v="body-sm" color={c.text3}>
                    {t.noData}
                  </T>
                )}
              </Card>
            </Section>

            <Section title={t.latency}>
              <Card>
                {lat.length === 0 ? (
                  <T v="body-sm" color={c.text3}>
                    {t.noData}
                  </T>
                ) : (
                  lat.map((r) => (
                    <View key={r.key} style={{ flexDirection: 'row', gap: space['2'] }} accessible accessibilityLabel={`${r.key}: p50 ${formatMs(r.p50)}, p95 ${formatMs(r.p95)}`}>
                      <T v="body-sm" style={{ flex: 1 }} numberOfLines={1}>
                        {r.key.replaceAll('_', ' ')}
                      </T>
                      <T v="body-sm" color={c.text2}>{`${formatMs(r.p50)} / ${formatMs(r.p95)}`}</T>
                    </View>
                  ))
                )}
              </Card>
            </Section>

            <Section title={t.cost}>
              <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['4'] }}>
                  <Stat label={t.costToday} value={formatUsd(cost.today)} />
                  <Stat label={t.cost7d} value={formatUsd(cost.week)} />
                </View>
                {cost.note ? (
                  <T v="caption" color={c.text3}>
                    {cost.note}
                  </T>
                ) : null}
              </Card>
            </Section>

            <Section title={t.recentErrors}>
              <Card>
                {errors.length === 0 ? (
                  <T v="body-sm" color={c.text3}>
                    {a.health ? t.noErrors : t.noData}
                  </T>
                ) : (
                  errors.map((e, i) => (
                    <View key={`${e.at}-${i}`} style={{ gap: 2 }}>
                      <T v="caption" color={c.text3}>
                        {e.at}
                      </T>
                      <T v="body-sm">{e.text}</T>
                    </View>
                  ))
                )}
              </Card>
            </Section>

            {roleAtLeast(role, 'owner') ? (
              <Section title={t.devices}>
                <Card>
                  {(a.users?.devices ?? []).filter((d) => !d.revoked_at).length === 0 ? (
                    <T v="body-sm" color={c.text3}>
                      {t.noData}
                    </T>
                  ) : (
                    (a.users?.devices ?? [])
                      .filter((d) => !d.revoked_at)
                      .map((d) => (
                        <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
                          <View style={{ flex: 1 }}>
                            <T v="body">{`${d.name}${d.id === a.session?.deviceId ? ' (this phone)' : ''}`}</T>
                            <T v="caption" color={c.text3}>
                              {`${d.role} · ${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}`}
                            </T>
                          </View>
                          <Button kind="ghost" label={t.revoke} onPress={() => void store.revokeDevice(d.id)} />
                        </View>
                      ))
                  )}
                </Card>
              </Section>
            ) : null}
          </>
        )}

        <Button
          kind="danger"
          icon="log-out-outline"
          label={t.signOut}
          busy={signingOut}
          onPress={() =>
            Alert.alert(t.signOut, '', [
              { text: t.cancel, style: 'cancel' },
              {
                text: t.signOut,
                style: 'destructive',
                onPress: async () => {
                  setSigningOut(true);
                  await store.signOut();
                  setSigningOut(false);
                },
              },
            ])
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}
