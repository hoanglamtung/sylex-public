/**
 * WakeWordEnrollmentModal — #210 Phase 2
 *
 * Enrollment UI for custom wake-word recording.
 * Opens as a full-screen transparent modal (dark card over dim backdrop).
 *
 * States driven by useWakeWordEnrollment:
 *   idle       → "Tap to record" CTA
 *   recording  → mic pulse animation + "Listening…" label
 *   recognised → phrase displayed + CONFIRM / RETRY buttons
 *   saving     → ActivityIndicator + "Saving…"
 *   error      → error message + RETRY button
 *
 * Colours match SettingsScreen theme:
 *   Background: #000000, Card: #1C1C1E, CTA: #00E5FF, Secondary: #4A90E2
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  TextInput,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useWakeWordEnrollment } from '../hooks/useWakeWordEnrollment';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: (phrase: string) => void;
}

export function WakeWordEnrollmentModal({ visible, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { state, recognisedPhrase, errorMessage, startRecording, confirmPhrase, savePhrase, retry, reset } =
    useWakeWordEnrollment(onSaved);
  const [typedPhrase, setTypedPhrase] = useState('');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const loopRef   = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (state === 'recording') {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.35, duration: 650, easing: Easing.ease, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.00, duration: 650, easing: Easing.ease, useNativeDriver: true }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [state, pulseAnim]);

  useEffect(() => {
    if (visible) {
      setTypedPhrase(recognisedPhrase);
    }
  }, [visible, recognisedPhrase]);

  const handleClose = () => {
    setTypedPhrase('');
    reset();
    onClose();
  };

  const handleSaveTypedPhrase = () => {
    void savePhrase(typedPhrase);
  };

  const handleRetry = () => {
    setTypedPhrase('');
    retry();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Close button */}
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>

          <Text style={styles.title}>{t('enrollment_title')}</Text>
          <Text style={styles.hint}>{t('enrollment_tap_to_record')}</Text>

          {(state === 'idle' || state === 'recognised' || state === 'error') && (
            <View style={styles.inputSection}>
              <TextInput
                value={typedPhrase}
                onChangeText={setTypedPhrase}
                placeholder="Type your wake word"
                placeholderTextColor="#667286"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={48}
              />
              <View style={styles.buttonRowHorizontal}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => void startRecording()}>
                  <Text style={styles.secondaryBtnText}>{t('enrollment_record')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.ctaBtn, !typedPhrase.trim() && styles.disabledBtn]}
                  onPress={handleSaveTypedPhrase}
                  disabled={!typedPhrase.trim()}
                >
                  <Text style={[styles.ctaBtnText, !typedPhrase.trim() && styles.disabledBtnText]}>
                    Save phrase
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── idle ─────────────────────────────────────────── */}
          {state === 'idle' && (
            <></>
          )}

          {/* ── recording ────────────────────────────────────── */}
          {state === 'recording' && (
            <>
              <Animated.Text style={[styles.micIcon, { transform: [{ scale: pulseAnim }] }]}>
                🎙
              </Animated.Text>
              <Text style={styles.hint}>{t('enrollment_recording')}</Text>
            </>
          )}

          {/* ── saving ───────────────────────────────────────── */}
          {state === 'saving' && (
            <>
              <ActivityIndicator color="#00E5FF" size="large" style={styles.spinner} />
              <Text style={styles.hint}>{t('enrollment_saving')}</Text>
            </>
          )}

          {/* ── error ────────────────────────────────────────── */}
          {state === 'error' && (
            <>
              <Text style={styles.errorText}>{t(errorMessage || 'enrollment_error')}</Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleRetry}>
                <Text style={styles.secondaryBtnText}>{t('enrollment_retry')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    paddingTop: 48,
    paddingBottom: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.12)',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 16,
  },
  closeBtnText: {
    color: '#636366',
    fontSize: 18,
    fontWeight: '600',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 20,
    textAlign: 'center',
  },
  hint: {
    color: '#8E8E93',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 20,
  },
  inputSection: {
    width: '100%',
    gap: 12,
    marginBottom: 20,
    flexDirection: 'column',
  },
  buttonRowHorizontal: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  input: {
    width: '100%',
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a4159',
    backgroundColor: '#10151d',
    color: '#f1f6ff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  micIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  phraseLabel: {
    color: '#00E5FF',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 28,
    letterSpacing: 0.5,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  ctaBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#00E5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#4A90E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnWide: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#4A90E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#4A90E2',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  disabledBtn: {
    opacity: 0.6,
    backgroundColor: '#00A6CC',
  },
  disabledBtnText: {
    color: '#4a4a4a',
    fontSize: 13,
  },
  spinner: {
    marginBottom: 16,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
});
