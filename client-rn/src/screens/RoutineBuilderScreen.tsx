/**
 * RoutineBuilderScreen — #130 / #238
 *
 * Handles both CREATE (no routineId param) and EDIT (routineId param) flows.
 *
 * Form fields:
 *  - Routine name (required, max 60 chars)
 *  - Trigger phrase (required, max 80 chars)
 *  - Task list (at least 1 task, all tasks must have a label)
 *    Each task: label (required) + optional durationSeconds
 *  - Schedule section (#238): optional trigger time + repeat days
 *
 * Gated: non-premium users see an upgrade prompt instead of the form.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  SafeAreaView,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../hooks/useAuth';
import { useRoutines } from '../hooks/useRoutines';
import type { RoutineTask } from '../types/routine';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'RoutineBuilder'>;

export function RoutineBuilderScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { routineId } = route.params ?? {};
  const { isPremium, loading: authLoading, uid } = useAuth();
  const { customRoutines, create, update } = useRoutines(uid);

  const existing = routineId
    ? customRoutines.find(r => r.id === routineId) ?? null
    : null;
  const isEdit = Boolean(existing);

  const [name, setName] = useState(existing?.name ?? '');
  const [triggerPhrase, setTriggerPhrase] = useState(existing?.triggerPhrase ?? '');
  const [tasks, setTasks] = useState<RoutineTask[]>(existing?.tasks ?? []);
  const [saving, setSaving] = useState(false);

  // ── Schedule fields (#238) ────────────────────────────────────────────────
  const [scheduleEnabled, setScheduleEnabled] = useState(
    Boolean(existing?.triggerTime),
  );
  // triggerTime: 'HH:MM' 24-hour
  const [triggerHour, setTriggerHour] = useState(
    existing?.triggerTime ? existing.triggerTime.split(':')[0] : '07',
  );
  const [triggerMinute, setTriggerMinute] = useState(
    existing?.triggerTime ? existing.triggerTime.split(':')[1] : '00',
  );
  // repeatDays: 0=Sun 1=Mon … 6=Sat
  const [repeatDays, setRepeatDays] = useState<number[]>(
    existing?.repeatDays ?? [1, 2, 3, 4, 5], // default: weekdays
  );

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setTriggerPhrase(existing.triggerPhrase);
      setTasks(existing.tasks);
      setScheduleEnabled(Boolean(existing.triggerTime));
      if (existing.triggerTime) {
        setTriggerHour(existing.triggerTime.split(':')[0]);
        setTriggerMinute(existing.triggerTime.split(':')[1]);
      }
      setRepeatDays(existing.repeatDays ?? [1, 2, 3, 4, 5]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const addTask = useCallback(() => {
    setTasks(prev => [
      ...prev,
      { id: Math.random().toString(36).slice(2), label: '', durationSeconds: 30 },
    ]);
  }, []);

  const updateTask = useCallback((id: string, changes: Partial<RoutineTask>) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...changes } : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert(t('routine_builder_validation'), t('routine_builder_error_name'));
      return;
    }
    if (!triggerPhrase.trim()) {
      Alert.alert(t('routine_builder_validation'), t('routine_builder_error_trigger'));
      return;
    }
    if (tasks.length === 0) {
      Alert.alert(t('routine_builder_validation'), t('routine_builder_error_one_task'));
      return;
    }
    if (tasks.some(t => !t.label.trim())) {
      Alert.alert(t('routine_builder_validation'), t('routine_builder_error_task_label'));
      return;
    }

    // Validate schedule time if enabled
    if (scheduleEnabled) {
      const h = parseInt(triggerHour, 10);
      const m = parseInt(triggerMinute, 10);
      if (isNaN(h) || h < 0 || h > 23 || isNaN(m) || m < 0 || m > 59) {
        Alert.alert(t('routine_builder_validation'), t('routine_builder_error_time'));
        return;
      }
      if (repeatDays.length === 0) {
        Alert.alert(t('routine_builder_validation'), t('routine_builder_error_days'));
        return;
      }
    }

    setSaving(true);
    try {
      const hh = triggerHour.padStart(2, '0');
      const mm = triggerMinute.padStart(2, '0');
      const draft = {
        name: name.trim(),
        triggerPhrase: triggerPhrase.trim(),
        tasks,
        triggerTime: scheduleEnabled ? `${hh}:${mm}` : undefined,
        repeatDays: scheduleEnabled ? repeatDays : undefined,
      };
      if (isEdit && routineId) {
        await update(routineId, draft);
      } else {
        await create(draft);
      }
      navigation.goBack();
    } catch {
      Alert.alert(t('routine_builder_error_title'), t('routine_builder_save_error'));
    } finally {
      setSaving(false);
    }
  }, [name, triggerPhrase, tasks, scheduleEnabled, triggerHour, triggerMinute, repeatDays, isEdit, routineId, create, update, navigation, t]);

  if (!isPremium && !authLoading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.gate}>
          <Text style={styles.gateIcon}>🔒</Text>
          <Text style={styles.gateTitle}>{t('routine_builder_premium_only')}</Text>
          <Text style={styles.gateSub}>
            {t('routine_builder_premium_sub')}
          </Text>
          <Pressable style={styles.upgradeBtn} onPress={() => navigation.navigate('Upgrade')}>
            <Text style={styles.upgradeBtnText}>{t('routine_builder_upgrade_btn')}</Text>
          </Pressable>
          <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
            <Text style={styles.back}>{t('routine_builder_go_back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.headerSide}>
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <Text style={styles.title}>
            {isEdit ? t('routine_builder_edit') : t('routine_builder_new')}
          </Text>
          <Pressable onPress={handleSave} disabled={saving} style={styles.headerSide}>
            {saving ? (
              <ActivityIndicator color="#00E5FF" size="small" />
            ) : (
              <Text style={styles.saveBtn}>{t('routine_builder_save')}</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.fieldLabel}>{t('routine_builder_name_label')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('routine_builder_name_placeholder')}
            placeholderTextColor="rgba(237,244,255,0.25)"
            maxLength={60}
            returnKeyType="next"
          />

          <Text style={styles.fieldLabel}>{t('routine_builder_trigger_label')}</Text>
          <Text style={styles.fieldHint}>
            {t('routine_builder_trigger_hint')}
          </Text>
          <TextInput
            style={styles.input}
            value={triggerPhrase}
            onChangeText={setTriggerPhrase}
            placeholder={t('routine_builder_trigger_placeholder')}
            placeholderTextColor="rgba(237,244,255,0.25)"
            maxLength={80}
            returnKeyType="done"
          />

          <View style={styles.tasksHeader}>
            <Text style={styles.fieldLabel}>{t('routine_builder_tasks_label')}</Text>
            <Pressable onPress={addTask} style={styles.addTaskBtn}>
              <Text style={styles.addTaskBtnText}>{t('routine_builder_add_task')}</Text>
            </Pressable>
          </View>

          {tasks.length === 0 && (
            <Text style={styles.noTasksHint}>
              {t('routine_builder_no_tasks')}
            </Text>
          )}

          {tasks.map((task, i) => (
            <View key={task.id} style={styles.taskRow}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{i + 1}</Text>
              </View>
              <TextInput
                style={[styles.input, styles.taskInput]}
                value={task.label}
                onChangeText={v => updateTask(task.id, { label: v })}
                placeholder={t('routine_builder_task_placeholder')}
                placeholderTextColor="rgba(237,244,255,0.25)"
                maxLength={100}
              />
              <Pressable onPress={() => removeTask(task.id)} style={styles.removeTaskBtn}>
                <Text style={styles.removeTaskText}>✕</Text>
              </Pressable>
            </View>
          ))}

          {/* ── Schedule section (#238) ─────────────────────────────────────── */}
          <View style={styles.scheduleHeader}>
            <Text style={styles.fieldLabel}>{t('routine_builder_schedule_label')}</Text>
            <Switch
              value={scheduleEnabled}
              onValueChange={setScheduleEnabled}
              trackColor={{ false: '#3A3A3C', true: '#00E5FF' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#3A3A3C"
            />
          </View>
          <Text style={styles.fieldHint}>{t('routine_builder_schedule_hint')}</Text>

          {scheduleEnabled && (
            <>
              {/* Time picker — two TextInputs for HH and MM */}
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>{t('routine_builder_schedule_time')}</Text>
              <View style={styles.timeRow}>
                <TextInput
                  style={[styles.input, styles.timeInput]}
                  value={triggerHour}
                  onChangeText={v => setTriggerHour(v.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="07"
                  placeholderTextColor="rgba(237,244,255,0.25)"
                />
                <Text style={styles.timeSep}>:</Text>
                <TextInput
                  style={[styles.input, styles.timeInput]}
                  value={triggerMinute}
                  onChangeText={v => setTriggerMinute(v.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="00"
                  placeholderTextColor="rgba(237,244,255,0.25)"
                />
              </View>

              {/* Repeat days */}
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>{t('routine_builder_schedule_days')}</Text>
              <View style={styles.daysRow}>
                {[
                  t('routine_builder_day_sun'),
                  t('routine_builder_day_mon'),
                  t('routine_builder_day_tue'),
                  t('routine_builder_day_wed'),
                  t('routine_builder_day_thu'),
                  t('routine_builder_day_fri'),
                  t('routine_builder_day_sat'),
                ].map((label, dayIdx) => {
                  const selected = repeatDays.includes(dayIdx);
                  return (
                    <Pressable
                      key={dayIdx}
                      style={[styles.dayBtn, selected && styles.dayBtnSelected]}
                      onPress={() =>
                        setRepeatDays(prev =>
                          selected ? prev.filter(d => d !== dayIdx) : [...prev, dayIdx].sort(),
                        )
                      }
                    >
                      <Text style={[styles.dayBtnText, selected && styles.dayBtnTextSelected]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Quick preset row */}
              <View style={styles.presetRow}>
                {[
                  { label: t('routine_builder_days_daily'), days: [0,1,2,3,4,5,6] },
                  { label: t('routine_builder_days_weekdays'), days: [1,2,3,4,5] },
                  { label: t('routine_builder_days_weekends'), days: [0,6] },
                ].map(({ label, days }) => (
                  <Pressable
                    key={label}
                    style={styles.presetBtn}
                    onPress={() => setRepeatDays(days)}
                  >
                    <Text style={styles.presetBtnText}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  flex: { flex: 1 },
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
  title: { color: '#81ECFF', fontSize: 14, fontWeight: '700', letterSpacing: 1.4 },
  saveBtn: { color: '#00E5FF', fontSize: 14, fontWeight: '700', textAlign: 'right' },
  form: { paddingHorizontal: 16, paddingVertical: 20, gap: 4, paddingBottom: 60 },
  fieldLabel: {
    color: 'rgba(237,244,255,0.45)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    marginTop: 16,
    marginBottom: 6,
  },
  fieldHint: {
    color: 'rgba(237,244,255,0.35)',
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#EDF4FF',
    fontSize: 15,
    backgroundColor: 'rgba(0,229,255,0.04)',
  },
  tasksHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 6,
  },
  addTaskBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
    backgroundColor: 'rgba(0,229,255,0.08)',
  },
  addTaskBtnText: { color: '#00E5FF', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  noTasksHint: { color: 'rgba(237,244,255,0.35)', fontSize: 13, marginBottom: 8 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
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
  taskInput: { flex: 1 },
  removeTaskBtn: { padding: 8 },
  removeTaskText: { color: '#FF453A', fontSize: 16 },
  // ── Schedule section (#238) ──────────────────────────────────────────────
  scheduleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeInput: {
    width: 64,
    textAlign: 'center',
    fontSize: 22,
    paddingVertical: 10,
  },
  timeSep: {
    color: '#EDF4FF',
    fontSize: 24,
    fontWeight: '700',
  },
  daysRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  dayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.2)',
    backgroundColor: 'rgba(0,229,255,0.04)',
    minWidth: 38,
    alignItems: 'center',
  },
  dayBtnSelected: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.18)',
  },
  dayBtnText: {
    color: 'rgba(237,244,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dayBtnTextSelected: { color: '#00E5FF' },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.2)',
    backgroundColor: 'rgba(0,229,255,0.06)',
  },
  presetBtnText: {
    color: 'rgba(237,244,255,0.55)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  gate: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  gateIcon: { fontSize: 44, marginBottom: 8 },
  gateTitle: { color: '#81ECFF', fontSize: 14, fontWeight: '700', letterSpacing: 1.8 },
  gateSub: {
    color: 'rgba(237,244,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  upgradeBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.3)',
    backgroundColor: 'rgba(0,229,255,0.1)',
  },
  upgradeBtnText: { color: '#00E5FF', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
});
