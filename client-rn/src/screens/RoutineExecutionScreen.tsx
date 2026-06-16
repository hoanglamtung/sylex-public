/**
 * RoutineExecutionScreen — #130 (routine activation feedback)
 *
 * Auto-starts execution on mount. Shows real-time step-by-step progress:
 *  - Pending steps: dim numbered indicator
 *  - Active step:   cyan spinner + highlighted label
 *  - Done step:     green ✓ + response text (for custom routines)
 *  - Failed step:   red ✕
 *
 * Templates: TTS reads each task label in sequence (client-only).
 * Custom:    Calls POST /v1/routines/:id/execute → Gemini responses → TTS.
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../hooks/useAuth';
import { useRoutines } from '../hooks/useRoutines';
import { ROUTINE_TEMPLATES } from '../types/routine';
import { useRoutineExecution, type StepStatus } from '../hooks/useRoutineExecution';
import { appendConversationEntry } from '../services/syncService';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'RoutineExecution'>;

export function RoutineExecutionScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { routineId, category } = route.params;
  const { uid } = useAuth();
  const { customRoutines, loading } = useRoutines(uid);

  const routine =
    category === 'template'
      ? ROUTINE_TEMPLATES.find(r => r.id === routineId) ?? null
      : customRoutines.find(r => r.id === routineId) ?? null;

  const { status, steps, errorMessage, run, stop } = useRoutineExecution(
    routineId,
    category,
    routine?.tasks ?? [],
  );

  // Auto-start once routine data is available:
  //   - Templates: run immediately (tasks are bundled, no Firestore needed)
  //   - Custom:    wait until Firestore has loaded so tasks/name are correct
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (category === 'custom' && loading) return; // wait for Firestore
    if (uid && routine?.name) {
      void appendConversationEntry(uid, {
        role: 'user',
        text: `Running Routine: ${routine.name}`,
      });
    }
    run();
  }, [loading]); // fires once when loading transitions false (or immediately for templates)

  // When execution finishes, write the full results to history.
  // Use routineId as fallback name so history is always written even if
  // routine data didn't load in time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status === 'done' && uid && steps.length > 0) {
      const name = routine?.name ?? routineId;
      const body = steps
        .map((s, i) =>
          `${i + 1}. ${s.label}${s.text && s.text !== s.label ? `\n${s.text}` : ''}`,
        )
        .join('\n\n');
      void appendConversationEntry(uid, {
        role: 'assistant',
        text: `Routine "${name}" completed:\n\n${body}`,
      });
    }
  }, [status]);

  const isRunning = status === 'loading' || status === 'playing';

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => { stop(); navigation.goBack(); }}
          style={styles.headerSide}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {routine?.name ?? 'Routine'}
        </Text>
        <View style={styles.headerSide} />
      </View>

      {/* Status banner */}
      <View style={styles.statusBanner}>
        {status === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#00E5FF" size="small" />
            <Text style={styles.statusText}>{t('routine_exec_preparing')}</Text>
          </View>
        )}
        {status === 'playing' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#00E5FF" size="small" />
            <Text style={styles.statusText}>{t('routine_exec_running')}</Text>
          </View>
        )}
        {status === 'done' && (
          <Text style={styles.statusDone}>{t('routine_exec_done')}</Text>
        )}
        {status === 'error' && (
          <Text style={styles.statusError} numberOfLines={3}>
            {errorMessage ?? t('routine_exec_error_fallback')}
          </Text>
        )}
      </View>

      {/* Steps list */}
      <ScrollView contentContainerStyle={styles.list}>
        {steps.map((step, i) => (
          <View
            key={step.stepId}
            style={[styles.stepRow, step.status === 'active' && styles.stepRowActive]}
          >
            {/* Status icon */}
            <View style={[styles.stepIcon, stepIconVariant(step.status)]}>
              {step.status === 'active' ? (
                <ActivityIndicator color="#00E5FF" size="small" />
              ) : step.status === 'done' ? (
                <Text style={styles.iconDone}>✓</Text>
              ) : step.status === 'failed' ? (
                <Text style={styles.iconFailed}>✕</Text>
              ) : (
                <Text style={styles.iconPending}>{i + 1}</Text>
              )}
            </View>

            {/* Step content */}
            <View style={styles.stepContent}>
              <Text
                style={[
                  styles.stepLabel,
                  step.status === 'active' && styles.stepLabelActive,
                  step.status === 'done' && styles.stepLabelDone,
                ]}
              >
                {step.label}
              </Text>
              {/* Show Gemini response when done (only for custom routines where text ≠ label) */}
              {step.text != null &&
                step.status !== 'pending' &&
                step.status !== 'active' &&
                step.text !== step.label && (
                  <Text style={styles.stepResponse}>
                    {step.text}
                  </Text>
                )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer action */}
      <View style={styles.footer}>
        {isRunning ? (
          <Pressable
            style={styles.stopBtn}
            onPress={() => { stop(); navigation.goBack(); }}
          >
            <Text style={styles.stopBtnText}>{t('routine_exec_stop')}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.doneBtnText}>
              {status === 'error' ? t('routine_exec_go_back') : t('routine_exec_done_btn')}
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stepIconVariant(s: StepStatus) {
  switch (s) {
    case 'active':  return styles.stepIconActive;
    case 'done':    return styles.stepIconDone;
    case 'failed':  return styles.stepIconFailed;
    default:        return styles.stepIconPending;
  }
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

  statusBanner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    minHeight: 44,
    justifyContent: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { color: 'rgba(237,244,255,0.6)', fontSize: 13 },
  statusDone: { color: '#30D158', fontSize: 13, fontWeight: '600' },
  statusError: { color: '#FF453A', fontSize: 13 },

  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  stepRowActive: {
    backgroundColor: 'rgba(0,229,255,0.05)',
    borderRadius: 10,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },

  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepIconPending: {
    backgroundColor: 'rgba(237,244,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(237,244,255,0.15)',
  },
  stepIconActive: {
    backgroundColor: 'rgba(0,229,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.4)',
  },
  stepIconDone: {
    backgroundColor: 'rgba(48,209,88,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(48,209,88,0.35)',
  },
  stepIconFailed: {
    backgroundColor: 'rgba(255,69,58,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.35)',
  },

  iconPending: { color: 'rgba(237,244,255,0.3)', fontSize: 11, fontWeight: '700' },
  iconDone:    { color: '#30D158', fontSize: 13, fontWeight: '700' },
  iconFailed:  { color: '#FF453A', fontSize: 13, fontWeight: '700' },

  stepContent: { flex: 1, gap: 4 },
  stepLabel: { color: 'rgba(237,244,255,0.4)', fontSize: 15, lineHeight: 20 },
  stepLabelActive: { color: '#EDF4FF', fontWeight: '600' },
  stepLabelDone:   { color: 'rgba(237,244,255,0.7)' },
  stepResponse: {
    color: 'rgba(237,244,255,0.55)',
    fontSize: 13,
    lineHeight: 18,
  },

  footer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,229,255,0.15)',
  },
  stopBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.3)',
    backgroundColor: 'rgba(255,69,58,0.08)',
    alignItems: 'center',
  },
  stopBtnText: { color: '#FF453A', fontSize: 13, fontWeight: '700', letterSpacing: 0.8 },
  doneBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
    backgroundColor: 'rgba(0,229,255,0.08)',
    alignItems: 'center',
  },
  doneBtnText: { color: '#00E5FF', fontSize: 13, fontWeight: '700' },
});
