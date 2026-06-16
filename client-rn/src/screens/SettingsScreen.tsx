import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Switch,
  Alert,
  Platform,
  PermissionsAndroid,
  AppState,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import i18n, { LANG_STORAGE_KEY } from '../i18n';
import { useAuth } from '../hooks/useAuth';
import { DEV_PREMIUM_OVERRIDE_KEY } from '../hooks/useAuth';
import { CUSTOM_WAKE_WORD_KEY, CUSTOM_WAKE_WORD_ENABLED_KEY } from '../hooks/useWakeWordEnrollment';
import { WakeWordEnrollmentModal } from '../components/WakeWordEnrollmentModal';
import { secureGet, secureSet, secureClear, SecureKeys } from '../services/secureStorage';
import { cancelAllRoutineTriggers } from '../services/routineScheduleService';
import { requestMicPermission } from '../services/permissionService';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const LANGUAGES = [
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'en-US', label: 'English' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'pl-PL', label: 'Polski' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'vi-VN', label: 'Tiếng Việt' },
  { code: 'zh-CN', label: '中文' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
];

export function SettingsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { isPremium, signOut } = useAuth();
  const [selectedLang, setSelectedLang] = useState(i18n.language);
  const [initialLang, setInitialLang] = useState(i18n.language);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [initialWakeWordEnabled, setInitialWakeWordEnabled] = useState(false);
  const [customWakeWord, setCustomWakeWord] = useState<string | null>(null);
  const [customWakeWordEnabled, setCustomWakeWordEnabled] = useState(false);
  const [initialCustomWakeWordEnabled, setInitialCustomWakeWordEnabled] = useState(false);
  const [enrollmentVisible, setEnrollmentVisible] = useState(false);
  const [micPermissionStatus, setMicPermissionStatus] = useState<'granted' | 'denied' | 'ios-managed'>('ios-managed');
  // DEV premium defaults to ON (null or 'true' → ON, 'false' → OFF)
  const [devPremiumOverride, setDevPremiumOverride] = useState(true);

  const hasUnsavedChanges =
    selectedLang !== initialLang ||
    wakeWordEnabled !== initialWakeWordEnabled ||
    customWakeWordEnabled !== initialCustomWakeWordEnabled;

  useEffect(() => {
    secureGet(SecureKeys.WAKE_WORD_ENABLED)
      .then(v => {
        const enabled = v === 'true';
        setWakeWordEnabled(enabled);
        setInitialWakeWordEnabled(enabled);
      })
      .catch(() => {});
    AsyncStorage.getItem(CUSTOM_WAKE_WORD_KEY)
      .then(v => setCustomWakeWord(v ?? null))
      .catch(() => {});
    AsyncStorage.getItem(CUSTOM_WAKE_WORD_ENABLED_KEY)
      .then(v => {
        const enabled = v === 'true';
        setCustomWakeWordEnabled(enabled);
        setInitialCustomWakeWordEnabled(enabled);
      })
      .catch(() => {});
    if (__DEV__) {
      AsyncStorage.getItem(DEV_PREMIUM_OVERRIDE_KEY)
        .then(v => setDevPremiumOverride(v !== 'false'))
        .catch(() => {});
    }
  }, []);

  const checkAndroidMicPermission = () => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
      .then(granted => setMicPermissionStatus(granted ? 'granted' : 'denied'))
      .catch(() => setMicPermissionStatus('denied'));
  };

  useEffect(() => {
    if (Platform.OS !== 'android') {
      setMicPermissionStatus('ios-managed');
      return;
    }
    checkAndroidMicPermission();

    // Re-check when user returns from device Settings
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkAndroidMicPermission();
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearData = () => {
    Alert.alert(
      t('settings_clear_data_title'),
      t('settings_clear_data_message'),
      [
        { text: t('settings_clear_data_cancel'), style: 'cancel' },
        {
          text: t('settings_clear_data_confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelAllRoutineTriggers();
              await AsyncStorage.clear();
              await secureClear();
              await signOut();
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            } catch {
              Alert.alert(t('routine_builder_error_title'), t('orchestration_error'));
            }
          },
        },
      ],
    );
  };

  const save = async () => {
    try {
      await Promise.all([
        AsyncStorage.setItem(LANG_STORAGE_KEY, selectedLang),
        secureSet(SecureKeys.WAKE_WORD_ENABLED, wakeWordEnabled ? 'true' : 'false'),
        AsyncStorage.setItem(CUSTOM_WAKE_WORD_ENABLED_KEY, customWakeWordEnabled ? 'true' : 'false'),
      ]);
    } catch {
      // non-critical — language still changes in-session
    }
    setInitialLang(selectedLang);
    setInitialWakeWordEnabled(wakeWordEnabled);
    setInitialCustomWakeWordEnabled(customWakeWordEnabled);
    i18n.changeLanguage(selectedLang);
    navigation.goBack();
  };

  const handleMicPermission = async () => {
    if (Platform.OS !== 'android') {
      // On iOS, open the app's system Settings page so user can toggle Microphone
      void Linking.openSettings();
      return;
    }

    const alreadyGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (alreadyGranted) {
      setMicPermissionStatus('granted');
      return;
    }

    const result = await requestMicPermission();
    // requestMicPermission opens Settings if denied; AppState listener will re-check on return
    if (result === 'granted') setMicPermissionStatus('granted');
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('settingsTitle')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Language section */}
        <Text style={styles.sectionHeader}>{t('languageSection')}</Text>
        <Text style={styles.sectionHint}>{t('languageLabel')}</Text>

        <View style={styles.languageList}>
          {LANGUAGES.map(lang => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.langRow, selectedLang === lang.code && styles.langRowSelected]}
              onPress={() => setSelectedLang(lang.code)}
            >
              <Text style={[styles.langLabel, selectedLang === lang.code && styles.langLabelSelected]}>
                {lang.label}
              </Text>
              {selectedLang === lang.code && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Microphone section */}
        <Text style={styles.sectionHeader}>{t('micSection')}</Text>
        <Text style={styles.micHint}>{t('micPermission')}</Text>
        <View style={styles.micPermissionCard}>
          <Text
            style={[
              styles.micPermissionStatusText,
              // eslint-disable-next-line react-native/no-inline-styles
              { color: micPermissionStatus === 'granted' ? '#22c55e' : micPermissionStatus === 'denied' ? '#ef4444' : '#94a3b8' },
            ]}
          >
            {Platform.OS === 'android'
              ? micPermissionStatus === 'granted'
                ? '✓ Microphone access: Granted'
                : '✗ Microphone access: Not granted'
              : 'Microphone access: tap to open device Settings'}
          </Text>
          <TouchableOpacity style={styles.micPermissionBtn} onPress={handleMicPermission}>
            <Text style={styles.micPermissionBtnText}>
              {Platform.OS === 'android'
                ? micPermissionStatus === 'granted'
                  ? 'Permission granted'
                  : 'Grant Microphone Access'
                : 'Open Device Settings'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Wake-word section — premium only (or DEV override) */}
        {(isPremium || (__DEV__ && devPremiumOverride)) && (
          <>
            <Text style={styles.sectionHeader}>{t('settings_wake_word')}</Text>

            {/* Option 1 — Hey Sylex (built-in). Turning ON turns OFF custom. */}
            <View style={styles.wakeWordCard}>
              <View style={styles.wakeWordInfo}>
                <Text style={styles.wakeWordLabel}>{t('settings_wake_word_label')}</Text>
                <Text style={styles.wakeWordHint}>{t('settings_wake_word_hint')}</Text>
              </View>
              <Switch
                value={wakeWordEnabled && !customWakeWordEnabled}
                onValueChange={(value) => {
                  setWakeWordEnabled(value);
                  if (value) {
                    // Turning on Hey Sylex → disable custom
                    setCustomWakeWordEnabled(false);
                  }
                }}
                trackColor={{ false: '#3A3A3C', true: '#00E5FF' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#3A3A3C"
              />
            </View>

            {/* Option 2 — Custom wake word. Turning ON turns OFF Hey Sylex. */}
            <View style={[styles.wakeWordCard, { marginTop: 8 }]}>
              <View style={styles.wakeWordInfo}>
                <Text style={styles.wakeWordLabel}>{t('enrollment_customise')}</Text>
                <Text style={styles.wakeWordHint}>
                  {customWakeWord
                    ? t('enrollment_active_phrase', { phrase: customWakeWord })
                    : t('enrollment_tap_to_record')}
                </Text>
              </View>
              <Switch
                value={customWakeWordEnabled}
                onValueChange={(value) => {
                  if (value && !customWakeWord) {
                    // No phrase enrolled yet — open modal first, enable after save
                    setEnrollmentVisible(true);
                    return;
                  }
                  setCustomWakeWordEnabled(value);
                  if (value) {
                    // Turning on custom → disable Hey Sylex
                    setWakeWordEnabled(false);
                  }
                }}
                trackColor={{ false: '#3A3A3C', true: '#00E5FF' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#3A3A3C"
              />
            </View>
            {(customWakeWordEnabled || customWakeWord) && (
              <TouchableOpacity
                style={styles.enrollmentBtn}
                onPress={() => setEnrollmentVisible(true)}
              >
                <Text style={styles.enrollmentBtnText}>
                  {t('enrollment_customise')}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}



        {/* DEV premium override toggle — only visible in development builds */}
        {__DEV__ && (
          <>
            <Text style={styles.sectionHeader}>⚙ DEV OPTIONS</Text>
            <View style={styles.wakeWordCard}>
              <View style={styles.wakeWordInfo}>
                <Text style={styles.wakeWordLabel}>Force Premium</Text>
                <Text style={styles.wakeWordHint}>Override isPremium for testing. Restart app after toggling.</Text>
              </View>
              <Switch
                value={devPremiumOverride}
                onValueChange={async (value) => {
                  setDevPremiumOverride(value);
                  await AsyncStorage.setItem(DEV_PREMIUM_OVERRIDE_KEY, value ? 'true' : 'false');
                }}
                trackColor={{ false: '#3A3A3C', true: '#FF9500' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#3A3A3C"
              />
            </View>
            <Text style={[styles.wakeWordHint, { marginTop: 4 }]}>
              isPremium: {isPremium ? '✅ true' : '❌ false'} | override: {devPremiumOverride ? 'ON' : 'OFF'}
            </Text>
          </>
        )}

        {/* Privacy section */}
        <Text style={styles.sectionHeader}>{t('settings_privacy')}</Text>
        <TouchableOpacity style={styles.clearDataBtn} onPress={handleClearData}>
          <Text style={styles.clearDataText}>{t('settings_clear_data')}</Text>
        </TouchableOpacity>
        <Text style={styles.sectionHint}>{t('settings_clear_data_hint')}</Text>
      </ScrollView>

      {hasUnsavedChanges && (
        <TouchableOpacity style={styles.floatingSaveBtn} onPress={save}>
          <Text style={styles.floatingSaveText}>{t('saveButton')}</Text>
        </TouchableOpacity>
      )}

      {/* Rendered outside ScrollView so iOS gesture recognizer doesn't swallow Modal touches */}
      <WakeWordEnrollmentModal
        visible={enrollmentVisible}
        onClose={() => setEnrollmentVisible(false)}
        onSaved={async (phrase) => {
          setCustomWakeWord(phrase);
          // Auto-enable custom mode and disable Hey Sylex on save
          setCustomWakeWordEnabled(true);
          setWakeWordEnabled(false);
          setEnrollmentVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#090b11',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 229, 255, 0.12)',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    color: '#00E5FF',
    fontSize: 30,
    lineHeight: 34,
  },
  title: {
    color: '#81ECFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  saveBtn: { padding: 4 },
  saveText: { color: '#4A90E2', fontSize: 17, fontWeight: '600' },
  floatingSaveBtn: {
    position: 'absolute',
    bottom: 28,
    left: 24,
    right: 24,
    backgroundColor: '#00d6f5',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#73edff',
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  floatingSaveText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 8,
  },
  sectionHeader: {
    color: '#8ca4c5',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 24,
    marginBottom: 8,
  },
  sectionHint: {
    color: '#6f8099',
    fontSize: 13,
    marginBottom: 12,
  },
  languageList: {
    backgroundColor: '#121720',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2b3d',
    overflow: 'hidden',
  },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2b3d',
  },
  langRowSelected: {
    backgroundColor: '#14253c',
  },
  langLabel: {
    color: '#e1e9f5',
    fontSize: 16,
  },
  langLabelSelected: {
    color: '#55b2ff',
    fontWeight: '600',
  },
  checkmark: {
    color: '#55b2ff',
    fontSize: 18,
    fontWeight: '700',
  },
  micHint: {
    color: '#6f8099',
    fontSize: 14,
    lineHeight: 20,
  },
  micPermissionCard: {
    marginTop: 10,
    backgroundColor: '#121720',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2b3d',
    padding: 12,
    gap: 10,
  },
  micPermissionStatusText: {
    color: '#d6e6ff',
    fontSize: 14,
  },
  micPermissionBtn: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f7cc4',
    backgroundColor: '#101d2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micPermissionBtnText: {
    color: '#6ab8ff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  premiumCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
  },
  premiumCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2C2C2E',
  },
  premiumCardLabel: {
    color: '#EBEBF5',
    fontSize: 16,
  },
  manageBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  manageBtnText: {
    color: '#4A90E2',
    fontSize: 16,
  },
  manageBtnChevron: {
    color: '#636366',
    fontSize: 20,
  },
  upgradeBtn: {
    margin: 12,
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  upgradeBtnText: {
    color: '#00E5FF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  // ─── Wake word ─────────────────────────────────────────────────────────────
  wakeWordCard: {
    backgroundColor: '#121720',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2b3d',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  wakeWordInfo: {
    flex: 1,
  },
  wakeWordLabel: {
    color: '#e1e9f5',
    fontSize: 16,
    marginBottom: 4,
  },
  wakeWordHint: {
    color: '#6f8099',
    fontSize: 12,
    lineHeight: 17,
  },
  enrollmentBtn: {
    marginTop: 10,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#101d2d',
    borderWidth: 1,
    borderColor: '#2f7cc4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  enrollmentBtnText: {
    color: '#6ab8ff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  // ─── Account section ───────────────────────────────────────────────────────
  providerText: {
    color: '#8E8E93',
    fontSize: 15,
  },
  signInContainer: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    paddingTop: 4,
    gap: 10,
  },
  appleBtn: {
    width: '100%',
    height: 46,
    borderRadius: 10,
  },
  googleBtn: {
    height: 46,
    borderRadius: 10,
    backgroundColor: '#2C2C2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleBtnText: {
    color: '#EBEBF5',
    fontSize: 15,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  signInHint: {
    color: '#636366',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 4,
  },
  signOutBtn: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2C2C2E',
  },
  signOutBtnText: {
    color: '#FF453A',
    fontSize: 16,
    fontWeight: '500',
  },
  // ─── Privacy section ───────────────────────────────────────────────────────
  clearDataBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.25)',
  },
  clearDataText: {
    color: '#FF453A',
    fontSize: 16,
    fontWeight: '500',
  },
});
