/**
 * RoutineDetailScreen — #130
 *
 * Shows a single routine's trigger phrase, steps, and estimated duration.
 * Actions available to premium users:
 *  - Edit   (custom routines only) → RoutineBuilderScreen
 *  - Duplicate → creates a copy in the user's collection
 *  - Delete (custom routines only) → confirmation dialog
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  SafeAreaView,
  Alert,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../hooks/useAuth';
import { useRoutines } from '../hooks/useRoutines';
import { ROUTINE_TEMPLATES } from '../types/routine';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'RoutineDetail'>;

export function RoutineDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { routineId, category } = route.params;
  const { isPremium, uid } = useAuth();
  const { customRoutines, remove, duplicate } = useRoutines(uid);

  const routine = useMemo(() => {
    if (category === 'template') return ROUTINE_TEMPLATES.find(r => r.id === routineId) ?? null;
    return customRoutines.find(r => r.id === routineId) ?? null;
  }, [routineId, category, customRoutines]);

  const handleDuplicate = useCallback(async () => {
    if (!routine || !isPremium) return;
    try {
      await duplicate(routine);
      navigation.goBack();
    } catch {
      Alert.alert(t('routine_detail_error'), t('routine_detail_duplicate_error'));
    }
  }, [routine, isPremium, duplicate, navigation]);

  const handleDelete = useCallback(() => {
    if (!routine) return;
    Alert.alert(
      t('routine_detail_delete_title'),
      t('routine_detail_delete_msg'),
      [
        { text: t('routine_detail_cancel'), style: 'cancel' },
        {
          text: t('routine_detail_delete_action'),
          style: 'destructive',
          onPress: async () => {
            try {
              await remove(routineId);
              navigation.goBack();
            } catch {
              Alert.alert(t('routine_detail_error'), t('routine_detail_delete_error'));
            }
          },
        },
      ],
    );
  }, [routine, remove, routineId, navigation]);

  if (!routine) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>{t('routine_detail_not_found')}</Text>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.notFoundBack}>{t('routine_detail_go_back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.headerSide}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {routine.name}
        </Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{t('routine_detail_trigger')}</Text>
          <Text style={styles.heroValue}>"{routine.triggerPhrase}"</Text>
          <Text style={styles.heroDuration}>
            ~{formatDuration(routine.estimatedDurationSeconds)} · {routine.tasks.length} steps
          </Text>
          {category === 'template' && (
            <View style={styles.templateBadge}>
              <Text style={styles.templateBadgeText}>{t('routine_detail_template')}</Text>
            </View>
          )}
        </View>

        {(category === 'template' || isPremium) && (
          <Pressable
            style={styles.runBtn}
            onPress={() => navigation.navigate('RoutineExecution', { routineId, category })}
          >
            <Text style={styles.runBtnText}>{t('routine_detail_run')}</Text>
          </Pressable>
        )}

        <Text style={styles.sectionLabel}>{t('routine_detail_steps')}</Text>
        {routine.tasks.map((task, i) => (
          <View key={task.id} style={styles.taskRow}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <View style={styles.taskInfo}>
              <Text style={styles.taskLabel}>{task.label}</Text>
              {task.durationSeconds != null && (
                <Text style={styles.taskDuration}>{task.durationSeconds}s</Text>
              )}
            </View>
          </View>
        ))}

        {isPremium && (
          <View style={styles.actions}>
            {category === 'custom' && (
              <Pressable
                style={styles.actionBtn}
                onPress={() => navigation.navigate('RoutineBuilder', { routineId })}
              >
                <Text style={styles.actionBtnText}>{t('routine_detail_edit')}</Text>
              </Pressable>
            )}
            <Pressable style={styles.actionBtn} onPress={handleDuplicate}>
              <Text style={styles.actionBtnText}>{t('routine_detail_duplicate')}</Text>
            </Pressable>
            {category === 'custom' && (
              <Pressable
                style={[styles.actionBtn, styles.destructiveBtn]}
                onPress={handleDelete}
              >
                <Text style={[styles.actionBtnText, styles.destructiveBtnText]}>{t('routine_detail_delete')}</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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
  headerSide: { width: 44 },
  back: { color: '#00E5FF', fontSize: 28 },
  title: {
    flex: 1,
    color: '#81ECFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 4 },
  hero: { paddingVertical: 20, gap: 6 },
  heroLabel: {
    color: 'rgba(237,244,255,0.4)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  heroValue: { color: '#00E5FF', fontSize: 18, fontWeight: '600' },
  heroDuration: { color: 'rgba(237,244,255,0.5)', fontSize: 13 },
  templateBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
    backgroundColor: 'rgba(0,229,255,0.08)',
  },
  templateBadgeText: { color: '#00E5FF', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  sectionLabel: {
    color: 'rgba(237,244,255,0.4)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginTop: 12,
    marginBottom: 8,
  },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,229,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberText: { color: '#00E5FF', fontSize: 11, fontWeight: '700' },
  taskInfo: { flex: 1, gap: 2 },
  taskLabel: { color: '#EDF4FF', fontSize: 15 },
  taskDuration: { color: 'rgba(237,244,255,0.4)', fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28 },
  actionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
    backgroundColor: 'rgba(0,229,255,0.08)',
  },
  actionBtnText: { color: '#00E5FF', fontSize: 13, fontWeight: '600' },
  destructiveBtn: {
    borderColor: 'rgba(255,69,58,0.3)',
    backgroundColor: 'rgba(255,69,58,0.08)',
  },
  destructiveBtnText: { color: '#FF453A' },
  runBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.35)',
    backgroundColor: 'rgba(0,229,255,0.12)',
    alignItems: 'center',
    marginVertical: 8,
  },
  runBtnText: { color: '#00E5FF', fontSize: 14, fontWeight: '700', letterSpacing: 1.2 },
  notFound: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  notFoundText: { color: 'rgba(237,244,255,0.6)', fontSize: 16 },
  notFoundBack: { color: '#00E5FF', fontSize: 14 },
});
