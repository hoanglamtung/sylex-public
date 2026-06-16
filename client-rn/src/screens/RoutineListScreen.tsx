/**
 * RoutineListScreen — #130
 *
 * Displays the list of built-in template routines and the user's custom
 * routines. Templates are always visible; custom routines are Premium-only.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  SectionList,
  SafeAreaView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../hooks/useAuth';
import { useRoutines } from '../hooks/useRoutines';
import type { VoiceRoutine } from '../types/routine';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'RoutineList'>;

export function RoutineListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { isPremium, loading: authLoading, uid } = useAuth();
  const { templates, customRoutines, loading } = useRoutines(uid);

  const sections: { title: string; data: VoiceRoutine[] }[] = [
    { title: t('routines_templates'), data: templates },
    ...(isPremium ? [{ title: t('routines_my_routines'), data: customRoutines }] : []),
  ];

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.headerSide}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{t('routines_title')}</Text>
        <View style={styles.headerSide}>
          {isPremium && (
            <Pressable onPress={() => navigation.navigate('RoutineBuilder', {})}>
              <Text style={styles.newBtn}>{t('routines_new')}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color="#00E5FF" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderSectionFooter={({ section }) =>
            section.title === t('routines_my_routines') && section.data.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{t('routines_empty')}</Text>
                <Pressable onPress={() => navigation.navigate('RoutineBuilder', {})}>
                  <Text style={styles.emptyAction}>{t('routines_create_first')}</Text>
                </Pressable>
              </View>
            ) : null
          }
          renderItem={({ item }: { item: VoiceRoutine }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                navigation.navigate('RoutineDetail', {
                  routineId: item.id,
                  category: item.category,
                })
              }
            >
              <View style={styles.rowContent}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {item.tasks.length} steps · {formatDuration(item.estimatedDurationSeconds)}
                </Text>
                <Text style={styles.rowTrigger}>"{item.triggerPhrase}"</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
          ListFooterComponent={
            !isPremium && !authLoading ? (
              <Pressable style={styles.upsell} onPress={() => navigation.navigate('Upgrade')}>
                <Text style={styles.upsellText}>{t('routines_upsell')}</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,229,255,0.2)',
  },
  headerSide: { width: 60 },
  back: { color: '#00E5FF', fontSize: 28 },
  title: { color: '#81ECFF', fontSize: 15, fontWeight: '700', letterSpacing: 1.6 },
  newBtn: { color: '#00E5FF', fontSize: 13, fontWeight: '700', textAlign: 'right' },
  loader: { flex: 1 },
  listContent: { paddingBottom: 32 },
  sectionHeader: {
    color: 'rgba(237,244,255,0.45)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowContent: { flex: 1 },
  rowName: { color: '#EDF4FF', fontSize: 16, fontWeight: '600' },
  rowMeta: { color: 'rgba(237,244,255,0.45)', fontSize: 12, marginTop: 2 },
  rowTrigger: { color: 'rgba(0,229,255,0.6)', fontSize: 12, marginTop: 2 },
  chevron: { color: 'rgba(237,244,255,0.3)', fontSize: 22 },
  emptyState: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  emptyText: { color: 'rgba(237,244,255,0.4)', fontSize: 14 },
  emptyAction: { color: '#00E5FF', fontSize: 13, fontWeight: '600' },
  upsell: {
    margin: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.2)',
    backgroundColor: 'rgba(0,229,255,0.06)',
    alignItems: 'center',
  },
  upsellText: { color: '#00E5FF', fontSize: 13, fontWeight: '600' },
});
