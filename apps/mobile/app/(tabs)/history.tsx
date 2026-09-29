import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GuideAvatar } from '../../src/components/companion';
import { Chip, EmptyState, Section, T } from '../../src/components/ui';
import { companionStore } from '../../src/store/companion';
import { useCompanion, useT } from '../../src/store/hooks';
import { space, useTheme } from '../../src/theme/theme';

export default function History() {
  const snap = useCompanion();
  const t = useT();
  const { c } = useTheme();
  const [server, setServer] = useState<Array<{ placeId: string; placeName: string; at: number }>>([]);
  const locale = snap.settings.locale === 'ru' ? 'ru-RU' : 'en-US';

  useEffect(() => {
    let alive = true;
    void companionStore()
      .fetchServerHistory()
      .then((r) => alive && setServer(r));
    return () => {
      alive = false;
    };
  }, [snap.transport.kind, snap.transport.sessionId]);

  const localIds = new Set(snap.history.map((h) => h.placeName));
  const extra = server.filter((s) => !localIds.has(s.placeName));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={snap.history}
        keyExtractor={(h) => h.planId}
        contentContainerStyle={{ padding: space['4'], gap: space['3'] }}
        ListHeaderComponent={
          <T v="title-1" accessibilityRole="header" style={{ marginBottom: space['2'] }}>
            {t.history}
          </T>
        }
        ListEmptyComponent={<EmptyState icon="time-outline" title={t.history} body={t.historyEmpty} />}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', gap: space['3'], paddingVertical: space['2'], borderBottomWidth: 1, borderColor: c.line }} accessible accessibilityLabel={`${item.placeName}. ${new Date(item.at).toLocaleString(locale)}. ${item.excerpt}`}>
            <GuideAvatar guideId={item.guideId} sizeDp={36} />
            <View style={{ flex: 1, gap: 4 }}>
              <T v="headline">{item.placeName}</T>
              <View style={{ flexDirection: 'row', gap: space['2'], alignItems: 'center' }}>
                <T v="caption" color={c.text3}>
                  {new Date(item.at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                </T>
                {item.simulated ? <Chip label={t.simulatedTag} tone="signal" /> : null}
              </View>
              <T v="body-sm" color={c.text2} numberOfLines={3}>
                {item.excerpt}
              </T>
            </View>
          </View>
        )}
        ListFooterComponent={
          extra.length ? (
            <View style={{ marginTop: space['6'] }}>
              <Section title={t.historyServer}>
                {extra.map((s) => (
                  <View key={s.placeId} style={{ paddingVertical: space['2'], borderBottomWidth: 1, borderColor: c.line }}>
                    <T v="body">{s.placeName}</T>
                    <T v="caption" color={c.text3}>
                      {new Date(s.at).toLocaleDateString(locale)}
                    </T>
                  </View>
                ))}
              </Section>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
