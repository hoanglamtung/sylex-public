import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  AppState,
  AppStateStatus,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useWakeWord } from '../hooks/useWakeWord';
import { CUSTOM_WAKE_WORD_KEY, CUSTOM_WAKE_WORD_ENABLED_KEY } from '../hooks/useWakeWordEnrollment';
import { secureGet, SecureKeys } from '../services/secureStorage';
import { useErrorRecovery } from '../hooks/useErrorRecovery';
import { useAuth } from '../hooks/useAuth';
import { useImageAttachment } from '../hooks/useImageAttachment';
import { isModeAvailable } from '../config/featureFlags';
import type { RoutineCategory } from '../types/routine';

import { WaveformAnimator } from '../components/WaveformAnimator';
import { ErrorBanner } from '../components/ErrorBanner';
import { DualSpinner } from '../components/DualSpinner';
import { GradientProgressBar } from '../components/GradientProgressBar';
import {
  ChatIcon,
  GearIcon,
  ImagePickerIcon,
  MenuIcon,
  MicIcon as NavMicIcon,
  MicrophoneIcon,
  SpeakerIcon as SpeakerSvgIcon,
  UpgradeIcon,
  UserIcon,
  VaultIcon,
} from '../components/HomeIcons';
import {
  AD_DAILY_LIMIT,
  AD_REWARD_COMMANDS,
  DAILY_LIMIT,
  SESSION_DURATION_MS,
  SESSION_DURATION_PREMIUM_MS,
  endSession,
  getAdRewardStatus,
  getDailyCount,
  grantAdRewardCommands,
  onAppBackground,
  startSession,
} from '../services/usageService';
import { showRewardedAd } from '../services/admobRewardService';
import { tokens } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { isPremium, loading: authLoading, uid, isLinked, displayName } = useAuth();

  // Avatar initial for the profile button
  const avatarInitial: string = (() => {
    if (!isLinked || !displayName) return '';
    return displayName.trim()[0].toUpperCase();
  })();
  const sessionDurationMs = isPremium ? SESSION_DURATION_PREMIUM_MS : SESSION_DURATION_MS;
  const [dailyRemaining, setDailyRemaining] = useState(DAILY_LIMIT);
  const [quotaRemainingPercent, setQuotaRemainingPercent] = useState(100);
  const [rewardAdLoading, setRewardAdLoading] = useState(false);
  const [adRewardStatus, setAdRewardStatus] = useState<{
    canWatchAd: boolean;
    adsRemainingToday: number;
    cooldownMsLeft: number;
    blockReason: 'none' | 'daily_limit' | 'cooldown';
  }>({
    canWatchAd: true,
    adsRemainingToday: AD_DAILY_LIMIT,
    cooldownMsLeft: 0,
    blockReason: 'none',
  });
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(Math.floor(sessionDurationMs / 1000));
  const [sessionEndsAtGmt2, setSessionEndsAtGmt2] = useState('');
  const { image: attachedImage, isLoading: imageLoading, pick: pickImage, clear: clearImage } =
    useImageAttachment(isPremium, () => navigation.navigate('Upgrade'));
  const [alwaysListeningEnabled, setAlwaysListeningEnabled] = useState(false);
  const [activeWakeWord, setActiveWakeWord] = useState('Hey Sylex');
  const isFocused = useIsFocused();
  const {
    voiceState,
    transcript,
    replyText,
    isRecording,
    errorMessage,
    isInSession,
    onPressIn,
    onPressOut,
    onTap,
    cancel,
    stopVoiceInteraction,
    startVoiceSession,
    endVoiceSession,
  } = usePushToTalk({
    mode: 'standard',
    isPremium, // consistent premium state (includes DEV override when active)
    uid,
    imageBase64: attachedImage?.base64 ?? null,
    imageMimeType: attachedImage?.mimeType,
    onRoutineIntent: (routineId, categoryRaw) => {
      const category: RoutineCategory = categoryRaw === 'custom' ? 'custom' : 'template';
      navigation.navigate('RoutineExecution', { routineId, category });
    },
  });
  const { error, showError, dismiss, retry } = useErrorRecovery();

  // ── always-listening pref ───────────────────────────────────────────────
  const loadWakeWordPref = useCallback(async () => {
    const [sylex, custom, customWord] = await Promise.all([
      secureGet(SecureKeys.WAKE_WORD_ENABLED),
      AsyncStorage.getItem(CUSTOM_WAKE_WORD_ENABLED_KEY),
      AsyncStorage.getItem(CUSTOM_WAKE_WORD_KEY),
    ]);
    // Either mode being active enables the listener; useWakeWord itself
    // decides which phrase(s) to fire based on the customEnabled flag.
    setAlwaysListeningEnabled(sylex === 'true' || custom === 'true');
    setActiveWakeWord(custom === 'true' && customWord ? customWord : 'Hey Sylex');
  }, []);

  // Reload when the user returns from Settings (they may have toggled it).
  useEffect(() => {
    void loadWakeWordPref();
    const unsubFocus = navigation.addListener('focus', () => void loadWakeWordPref());
    return () => unsubFocus();
  }, [navigation, loadWakeWordPref]);

  // ── wake-word callback ─────────────────────────────────────────────────
  // "Hey Sylex" detected → enter session mode (#226) then start recording.
  const handleWakeWord = useCallback(() => {
    startVoiceSession();
    onTap();
  }, [onTap, startVoiceSession]);

  // ── wake-word listener ─────────────────────────────────────────────────
  // Suspends automatically while PTT is recording / processing / speaking.
  useWakeWord({
    isPremium,
    enabled: alwaysListeningEnabled,
    paused: voiceState !== 'idle' || isInSession || !isFocused,
    onWakeWord: handleWakeWord,
  });

  const refreshUsage = useCallback(async () => {
    const [count, currentAdRewardStatus] = await Promise.all([
      getDailyCount(),
      getAdRewardStatus(),
    ]);
    const used = Math.max(0, Math.min(count, DAILY_LIMIT));
    const remaining = DAILY_LIMIT - used;
    setDailyRemaining(remaining);
    setQuotaRemainingPercent(Math.round((remaining / DAILY_LIMIT) * 100));
    setAdRewardStatus({
      canWatchAd: currentAdRewardStatus.canWatchAd,
      adsRemainingToday: currentAdRewardStatus.adsRemainingToday,
      cooldownMsLeft: currentAdRewardStatus.cooldownMsLeft,
      blockReason: currentAdRewardStatus.blockReason,
    });
  }, []);

  const showDailyAdLimitPopup = useCallback(() => {
    Alert.alert(
      'Daily limit reached',
      'You have reached the maximum of 6 rewarded ads for today. Upgrade to Pro for unlimited usage.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Upgrade to Pro',
          onPress: () => navigation.navigate('Upgrade'),
        },
      ],
    );
  }, [navigation]);

  const handleWatchAdReward = useCallback(async () => {
    console.log('[AdMob] Watch ad tapped', { rewardAdLoading, isPremium });
    if (rewardAdLoading || isPremium || dailyRemaining > DAILY_LIMIT - AD_REWARD_COMMANDS || !adRewardStatus.canWatchAd) {
      console.log('[AdMob] Watch ad ignored', { reason: rewardAdLoading ? 'loading' : 'premium' });
      if (adRewardStatus.blockReason === 'daily_limit') {
        showDailyAdLimitPopup();
      } else if (adRewardStatus.blockReason === 'cooldown') {
        const mins = Math.ceil(adRewardStatus.cooldownMsLeft / 60000);
        Alert.alert('Ad cooldown active', `Please wait about ${mins} minute${mins === 1 ? '' : 's'} before watching the next ad.`);
      }
      return;
    }

    setRewardAdLoading(true);
    try {
      const result = await showRewardedAd();
      console.log('[AdMob] Watch ad completed', result);
      if (!result.rewarded) {
        Alert.alert('Reward not unlocked', 'Please watch the full ad to receive +5 commands.');
        return;
      }

      await grantAdRewardCommands(5);
      await refreshUsage();
      console.log('[AdMob] +5 commands granted');
      Alert.alert('Reward unlocked', '+5 commands added to your account.');
    } catch (error) {
      if (error instanceof Error && error.message === 'AD_REWARD_DAILY_LIMIT_REACHED') {
        showDailyAdLimitPopup();
        return;
      }
      if (error instanceof Error && error.message === 'AD_REWARD_COOLDOWN_ACTIVE') {
        Alert.alert('Ad cooldown active', 'Please wait 5 minutes before watching the next ad.');
        return;
      }
      console.warn('[AdMob] Rewarded ad failed', error);
      Alert.alert('Ad unavailable', 'Unable to load ad right now. Please try again shortly.');
    } finally {
      setRewardAdLoading(false);
    }
  }, [adRewardStatus.blockReason, adRewardStatus.canWatchAd, adRewardStatus.cooldownMsLeft, dailyRemaining, isPremium, refreshUsage, rewardAdLoading, showDailyAdLimitPopup]);

  const handleImagePickerPress = useCallback(() => {
    Alert.alert(
      t('chat_attachment_title'),
      t('chat_attachment_message'),
      [
        { text: t('home_library'), onPress: () => pickImage('gallery') },
        { text: t('home_camera'), onPress: () => pickImage('camera') },
        { text: t('settings_clear_data_cancel'), style: 'cancel' },
      ],
    );
  }, [pickImage, t]);

  const shouldShowWatchAd = !isPremium && dailyRemaining <= DAILY_LIMIT - AD_REWARD_COMMANDS;
  const adButtonDisabled = rewardAdLoading || !adRewardStatus.canWatchAd;

  let adRewardHint = `Ads left today: ${adRewardStatus.adsRemainingToday}/${AD_DAILY_LIMIT}`;
  if (adRewardStatus.blockReason === 'cooldown') {
    const mins = Math.ceil(adRewardStatus.cooldownMsLeft / 60000);
    adRewardHint = `Cooldown active: ~${mins} minute${mins === 1 ? '' : 's'} remaining`;
  } else if (adRewardStatus.blockReason === 'daily_limit') {
    adRewardHint = 'Daily ad limit reached (6/6)';
  }

  useEffect(() => {
    let sessionEnd = Date.now() + sessionDurationMs;
    let sessionRenewTimer: ReturnType<typeof setInterval> | null = null;

    startSession(
      () => { if (!isPremium) showError('error_session_warning'); },
      () => {
        if (isPremium) {
          // Auto-renew session for premium users (#212)
          endSession();
          sessionEnd = Date.now() + sessionDurationMs;
          setSessionEndsAtGmt2(formatGmt2Time(sessionEnd));
          startSession(
            () => {},
            () => {
              // Renew again on next expiry — handled by the interval below
            },
          );
        } else {
          showError('error_session_ended');
        }
      },
    );
    setSessionEndsAtGmt2(formatGmt2Time(sessionEnd));

    // Premium: auto-renew every 30 min so the session never truly expires
    if (isPremium) {
      sessionRenewTimer = setInterval(() => {
        endSession();
        sessionEnd = Date.now() + sessionDurationMs;
        setSessionEndsAtGmt2(formatGmt2Time(sessionEnd));
        startSession(() => {}, () => {});
      }, sessionDurationMs);
    }

    void refreshUsage();
    const countdownTimer = setInterval(() => {
      const leftMs = Math.max(0, sessionEnd - Date.now());
      setSessionSecondsLeft(Math.ceil(leftMs / 1000));
    }, 1000);
    const usageTimer = setInterval(() => {
      void refreshUsage();
    }, 15_000);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') onAppBackground();
    });

    return () => {
      clearInterval(countdownTimer);
      clearInterval(usageTimer);
      if (sessionRenewTimer) clearInterval(sessionRenewTimer);
      endSession();
      sub.remove();
    };
  }, [isPremium]);

  useEffect(() => {
    if (errorMessage) showError(errorMessage as Parameters<typeof showError>[0]);
  }, [errorMessage]);

  const speakingProgress = replyText ? Math.min(100, Math.max(24, Math.round(replyText.length * 1.4))) : 28;

  return (
    <SafeAreaView style={styles.root}>
      <View pointerEvents="none" style={styles.bgGlowLeft} />
      <View pointerEvents="none" style={styles.bgGlowRight} />
      <View pointerEvents="none" style={styles.bgGlowCenter} />
      <View pointerEvents="none" style={styles.bgGrid}>
        {Array.from({ length: 10 }, (_, row) => (
          <View key={`bg-row-${row}`} style={[styles.bgDotRow, { top: 44 + row * 42 }]}>
            {Array.from({ length: 9 }, (_, col) => (
              <View key={`bg-dot-${row}-${col}`} style={styles.bgDot} />
            ))}
          </View>
        ))}
      </View>

      <View style={styles.headerShell}>
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <Pressable
              onPress={() => navigation.navigate('UserProfile')}
              style={({ pressed }: { pressed: boolean }) => [
                styles.headerAvatar,
                isLinked && styles.headerAvatarLinked,
                pressed && styles.headerAvatarPressed,
              ]}
            >
              {isLinked && avatarInitial ? (
                <Text style={styles.headerAvatarInitial}>{avatarInitial}</Text>
              ) : (
                <UserIcon size={16} color={tokens.colors.cyanSoft} />
              )}
              {isLinked && isPremium && (
                <View style={styles.headerAvatarBadge}>
                  <Text style={styles.headerAvatarBadgeText}>PRO</Text>
                </View>
              )}
            </Pressable>
            <Text style={styles.appTitle}>ASSISTANT PRO</Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.proPill}>
              <Text style={styles.proPillText}>{isPremium ? 'PRO' : 'FREE'}</Text>
            </View>
            <Pressable onPress={() => navigation.navigate('Settings')} style={styles.menuBtn}>
              <MenuIcon size={20} color={tokens.colors.cyanSoft} />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.voiceAreaScroll}
        contentContainerStyle={styles.voiceArea}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!isPremium && !authLoading && (
          <View style={styles.premiumGate}>
            <View style={styles.premiumGateCopy}>
              <Text style={styles.premiumGateIcon}>✦</Text>
              <View>
                <Text style={styles.premiumGateTitle}>{t('home_premium_gate_title')}</Text>
                <Text style={styles.premiumGateSubtitle}>{t('home_premium_gate_sub')}</Text>
              </View>
            </View>
            <Pressable style={styles.premiumGateBtn} onPress={() => navigation.navigate('Upgrade')}>
              <Text style={styles.premiumGateBtnText}>{t('home_upgrade_btn')}</Text>
            </Pressable>
          </View>
        )}

        <View style={[
          styles.stageCard,
          voiceState === 'speaking' && styles.stageCardSpeaking,
          voiceState === 'error' && styles.stageCardError,
        ]}>
          {(voiceState === 'idle' || voiceState === 'error') && (
            <>
              <View style={styles.idleOrbWrap}>
                <View style={styles.idleOrbGlow} />
                <View style={styles.idleOrbGlowSecondary} />
                <View style={styles.idleOrbRing} />
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.orbButton,
                    isRecording && styles.orbButtonActive,
                    pressed && styles.orbButtonPressed,
                  ]}
                  onPressIn={onPressIn}
                  onPressOut={onPressOut}
                >
                  <View pointerEvents="none" style={styles.orbHighlight} />
                  <View pointerEvents="none" style={styles.orbAura} />
                  {isRecording ? (
                    <View style={styles.stopGlyph} />
                  ) : (
                    <View style={styles.micGlyph}>
                      <MicrophoneIcon size={42} color="#005762" />
                    </View>
                  )}
                  <Text style={styles.orbLabel}>{isRecording ? t('home_tap_to_stop') : 'INITIALIZE'}</Text>
                </Pressable>

                {isPremium && (
                  <Pressable
                    style={[styles.orbImagePickerBtn, attachedImage && styles.orbImagePickerBtnFilled]}
                    onPress={handleImagePickerPress}
                    disabled={imageLoading}
                  >
                    {imageLoading ? (
                      <ActivityIndicator size="small" color={tokens.colors.cyan} />
                    ) : attachedImage ? (
                      <Image source={{ uri: attachedImage.uri }} style={styles.orbImagePickerThumb} />
                    ) : (
                      <ImagePickerIcon size={18} color={tokens.colors.cyanSoft} />
                    )}
                  </Pressable>
                )}

                {isPremium && attachedImage && (
                  <Pressable style={styles.orbImageClearBtn} onPress={clearImage}>
                    <Text style={styles.orbImageClearText}>✕</Text>
                  </Pressable>
                )}
              </View>
              <Text style={styles.idleHint}>{t('home_hold_to_speak')}</Text>
            </>
          )}

          {voiceState === 'listening' && (
            <View style={styles.voicePanel}>
              <WaveformAnimator active={isRecording} />
              <Text style={styles.statePill}>{t('state_listening')}</Text>
              <Pressable style={styles.cancelStateBtn} onPress={cancel}>
                <Text style={styles.cancelStateBtnText}>{t('home_stop')}</Text>
              </Pressable>
            </View>
          )}

          {voiceState === 'processing' && (
            <View style={styles.voicePanel}>
              <View style={styles.processingOrb}>
                <DualSpinner />
              </View>
              {transcript !== '' && (
                <View style={styles.transcriptDisplay}>
                  <Text style={styles.transcriptLabel}>{t('state_you_said')}</Text>
                  <Text style={styles.transcriptText}>{transcript}</Text>
                </View>
              )}
              <Text style={styles.statePill}>{t('state_processing')}</Text>
              <Pressable style={styles.cancelStateBtn} onPress={cancel}>
                <Text style={styles.cancelStateBtnText}>{t('home_stop')}</Text>
              </Pressable>
            </View>
          )}

          {voiceState === 'speaking' && (
            <View style={styles.voicePanel}>
              <View style={styles.speakerOrbWrap}>
                <View style={styles.speakerOrbGlow} />
                <Pressable style={styles.speakerOrb} onPress={stopVoiceInteraction}>
                  <SpeakerSvgIcon size={38} color={tokens.colors.magenta} />
                </Pressable>
              </View>
              {replyText !== '' && (
                <View style={[styles.transcriptDisplay, styles.responseCardSpeaking]}>
                  <Text style={[styles.transcriptText, styles.speakingResponseText]}>{replyText}</Text>
                </View>
              )}
              <GradientProgressBar progress={Math.max(speakingProgress, 12)} />
              <Text style={[styles.statePill, styles.statePillSpeaking]}>{t('state_speaking')}</Text>
              <Pressable style={styles.cancelStateBtn} onPress={cancel}>
                <Text style={styles.cancelStateBtnText}>{t('home_stop')}</Text>
              </Pressable>
            </View>
          )}

          {isPremium && alwaysListeningEnabled && voiceState === 'idle' && (
            <Text style={styles.wakeWordHint}>{t('home_wake_word_hint', { word: activeWakeWord })}</Text>
          )}
        </View>

        <View style={styles.voiceCopyBlock}>
          <Text style={styles.status}>{t('server_connected')}</Text>
        </View>

        {(transcript !== '' || (replyText !== '' && voiceState !== 'speaking')) && (
          <View style={styles.qaBlock}>
            {transcript !== '' && (
              <Text style={styles.qaQuestion}>{transcript}</Text>
            )}
            {replyText !== '' && voiceState !== 'speaking' && (
              <Text style={styles.qaAnswer}>{replyText}</Text>
            )}
          </View>
        )}

        {attachedImage && !isPremium && (
          <View style={styles.imagePreview}>
            <Image source={{ uri: attachedImage.uri }} style={styles.imageThumb} />
            <Text style={styles.imagePreviewLabel}>{t('home_image_attached')}</Text>
            <Pressable onPress={clearImage} style={styles.imagePreviewClear}>
              <Text style={styles.imagePreviewClearText}>✕</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.usageCard}>
          <View style={styles.usageBlock}>
            {isPremium ? (
              <View style={styles.usagePremiumPill}>
                <View style={styles.usagePremiumDot} />
                <Text style={styles.usagePremiumLabel}>PRO ACTIVE • UNLIMITED ACCESS</Text>
              </View>
            ) : (
              <>
                <View style={styles.usageRow}>
                  <Text style={styles.usageLabel}>{t('home_daily_limit')}</Text>
                  <Text style={styles.usageValue}>{dailyRemaining}/{DAILY_LIMIT} {t('home_remaining')}</Text>
                </View>
                <View style={styles.usageTrack}>
                  <View style={[styles.usageFill, { width: `${quotaRemainingPercent}%` }]} />
                </View>
                {shouldShowWatchAd && (
                  <>
                    <Pressable
                      style={({ pressed }: { pressed: boolean }) => [
                        styles.usageRewardCta,
                        adButtonDisabled && styles.usageRewardCtaDisabled,
                        pressed && !adButtonDisabled && styles.usageRewardCtaPressed,
                      ]}
                      onPress={handleWatchAdReward}
                      disabled={adButtonDisabled}
                    >
                      <Text style={styles.usageRewardCtaText}>
                        {rewardAdLoading ? 'LOADING AD...' : 'WATCH AD FOR +5 COMMANDS'}
                      </Text>
                    </Pressable>
                    <Text style={styles.usageRewardHint}>{adRewardHint}</Text>
                  </>
                )}
              </>
            )}
            <Text style={styles.usageSessionText}>
              {t('home_session_left', { time: formatDuration(sessionSecondsLeft) })} | {t('home_session_ends', { time: sessionEndsAtGmt2 })}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomNavShell}>
        <View style={styles.bottomNavItems}>
          <Pressable style={styles.bottomNavItem} onPress={() => navigation.navigate('TextChat')}>
            <View style={styles.bottomNavIconWrap}>
              <ChatIcon size={17} color={'rgba(219,231,245,0.42)'} />
            </View>
            <Text style={styles.bottomNavLabel}>{t('nav_chat')}</Text>
          </Pressable>
          <View style={[styles.bottomNavItem, styles.bottomNavItemActive]}>
            <View style={[styles.bottomNavIconWrap, styles.bottomNavIconWrapActive]}>
              <NavMicIcon size={16} color={'rgba(129, 236, 255, 0.98)'} />
            </View>
            <Text style={[styles.bottomNavLabel, styles.bottomNavLabelActive]}>VOICE</Text>
          </View>
          <Pressable style={styles.bottomNavItem} onPress={() => navigation.navigate('ConversationHistory')}>
            <View style={styles.bottomNavIconWrap}>
              <VaultIcon size={15} color={'rgba(219,231,245,0.42)'} />
            </View>
            <Text style={styles.bottomNavLabel}>{t('nav_history')}</Text>
          </Pressable>
          <Pressable style={styles.bottomNavItem} onPress={() => navigation.navigate(isPremium ? 'Settings' : 'Upgrade')}>
            <View style={styles.bottomNavIconWrap}>
              {isPremium ? (
                <GearIcon size={17} color={'rgba(219,231,245,0.42)'} />
              ) : (
                <UpgradeIcon size={17} color={'rgba(219,231,245,0.42)'} />
              )}
            </View>
            <Text style={styles.bottomNavLabel}>{isPremium ? 'MANAGE' : t('nav_upgrade')}</Text>
          </Pressable>
        </View>
      </View>

      <ErrorBanner error={error} onRetry={retry} onDismiss={dismiss} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.colors.bgBase,
  },
  bgGlowLeft: {
    position: 'absolute',
    width: 360,
    height: 420,
    borderRadius: 210,
    left: -110,
    top: 150,
    backgroundColor: 'rgba(0, 229, 255, 0.10)',
    opacity: 0.36,
  },
  bgGlowRight: {
    position: 'absolute',
    width: 360,
    height: 420,
    borderRadius: 210,
    right: -120,
    top: 170,
    backgroundColor: 'rgba(180, 0, 255, 0.08)',
    opacity: 0.30,
  },
  bgGlowCenter: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    alignSelf: 'center',
    top: 210,
    backgroundColor: 'rgba(129, 236, 255, 0.06)',
    opacity: 0.4,
  },
  bgGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.22,
  },
  bgDotRow: {
    position: 'absolute',
    left: 22,
    right: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bgDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(129, 236, 255, 0.55)',
  },
  headerShell: {
    backgroundColor: 'rgba(10, 31, 51, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(129, 236, 255, 0.06)',
    shadowColor: tokens.colors.primary,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.30)',
    backgroundColor: 'rgba(10, 31, 51, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: tokens.colors.primary,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  headerAvatarLinked: {
    borderColor: 'rgba(129, 236, 255, 0.55)',
    backgroundColor: 'rgba(10, 31, 51, 0.92)',
  },
  headerAvatarPressed: {
    opacity: 0.7,
  },
  headerAvatarBadge: {
    position: 'absolute',
    top: -6,
    right: -12,
    backgroundColor: tokens.colors.primary,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  headerAvatarBadgeText: {
    color: tokens.colors.accentDark,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  headerAvatarDot: {
    color: tokens.colors.cyan,
    fontSize: 10,
    lineHeight: 10,
  },
  headerAvatarInitial: {
    color: tokens.colors.cyanSoft,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 15,
  },
  appTitle: {
    color: 'rgba(129, 236, 255, 0.96)',
    fontSize: 17,
    letterSpacing: 1.6,
    fontWeight: '700',
    fontFamily: 'SpaceGrotesk-Bold',
  },
  headerUserName: {
    color: 'rgba(237, 244, 255, 0.50)',
    fontSize: 10,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  proPill: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.34)',
    backgroundColor: 'rgba(0, 229, 255, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proPillText: {
    color: tokens.colors.cyan,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: 'Manrope-Bold',
  },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.25)',
    backgroundColor: 'rgba(0, 229, 255, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIcon: {
    fontSize: 17,
    color: tokens.colors.cyan,
  },
  voiceAreaScroll: {
    flex: 1,
  },
  voiceArea: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 18,
  },
  premiumGate: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.16)',
    backgroundColor: 'rgba(7, 20, 32, 0.56)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  premiumGateCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  premiumGateIcon: {
    color: 'rgba(129, 236, 255, 0.95)',
    fontSize: 15,
  },
  premiumGateTitle: {
    color: 'rgba(129, 236, 255, 0.95)',
    fontSize: 10,
    letterSpacing: 1.1,
    fontWeight: '700',
  },
  premiumGateSubtitle: {
    color: 'rgba(237, 244, 255, 0.56)',
    fontSize: 9,
    marginTop: 2,
  },
  premiumGateBtn: {
    height: 28,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.32)',
    backgroundColor: 'rgba(0, 229, 255, 0.10)',
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumGateBtnText: {
    color: 'rgba(129, 236, 255, 0.95)',
    fontSize: 9,
    letterSpacing: 0.9,
    fontWeight: '700',
  },
  greetingSection: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  greetingLabel: {
    color: tokens.colors.textSecondary,
    fontSize: 12,
    letterSpacing: 3.6,
    fontWeight: '500',
  },
  greetingText: {
    color: tokens.colors.textPrimary,
    fontSize: 30,
    textAlign: 'center',
    lineHeight: 36,
    fontWeight: '700',
  },
  greetingName: {
    color: tokens.colors.primaryDark,
  },
  stageCard: {
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
    minHeight: 340,
    backgroundColor: 'transparent',
    paddingVertical: 0,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    overflow: 'visible',
  },
  stageCardSpeaking: {
    borderColor: 'transparent',
  },
  stageCardError: {
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255, 59, 48, 0.60)',
    backgroundColor: 'rgba(24, 10, 10, 0.42)',
    paddingVertical: 22,
    paddingHorizontal: 20,
  },
  voicePanel: {
    width: '100%',
    maxWidth: 540,
    alignItems: 'center',
    gap: 18,
  },
  idleOrbWrap: {
    width: '100%',
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleOrbGlow: {
    position: 'absolute',
    width: 330,
    height: 330,
    borderRadius: 165,
    backgroundColor: 'rgba(129, 236, 255, 0.14)',
    opacity: 0.42,
  },
  idleOrbGlowSecondary: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    opacity: 0.55,
  },
  idleOrbRing: {
    position: 'absolute',
    width: 256,
    height: 256,
    borderRadius: 128,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(129, 236, 255, 0.10)',
  },
  orbButton: {
    width: 224,
    height: 224,
    borderRadius: 112,
    borderWidth: 4,
    borderColor: 'rgba(4, 15, 25, 0.20)',
    backgroundColor: '#81ECFF',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    overflow: 'visible',
    shadowColor: tokens.colors.cyan,
    shadowOpacity: 0.34,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  orbButtonActive: {
    backgroundColor: '#64E8F7',
  },
  orbButtonPressed: {
    transform: [{ scale: 0.97 }],
  },
  orbHighlight: {
    position: 'absolute',
    top: 18,
    left: 28,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    opacity: 0.6,
  },
  orbAura: {
    position: 'absolute',
    top: -16,
    right: -16,
    bottom: -16,
    left: -16,
    borderRadius: 128,
    borderWidth: 1.5,
    borderColor: 'rgba(129, 236, 255, 0.20)',
  },
  micGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  micGlyphCapsule: {
    width: 34,
    height: 54,
    borderRadius: 17,
    backgroundColor: '#005762',
  },
  micGlyphStem: {
    width: 6,
    height: 18,
    borderRadius: 3,
    backgroundColor: '#005762',
    marginTop: 4,
  },
  micGlyphBase: {
    width: 28,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#005762',
    marginTop: 4,
  },
  stopGlyph: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#005762',
    marginBottom: 6,
  },
  orbImagePickerBtn: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.40)',
    backgroundColor: 'rgba(23, 39, 54, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: 84 }, { translateY: 78 }],
    shadowColor: tokens.colors.cyan,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    overflow: 'hidden',
  },
  orbImagePickerBtnFilled: {
    borderColor: 'rgba(129, 236, 255, 0.70)',
  },
  orbImagePickerIcon: {
    color: tokens.colors.cyanSoft,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 26,
  },
  orbImagePickerThumb: {
    width: '100%',
    height: '100%',
  },
  orbImageClearBtn: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(4, 15, 25, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: 128 }, { translateY: 60 }],
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.28)',
  },
  orbImageClearText: {
    color: 'rgba(237, 244, 255, 0.88)',
    fontSize: 10,
    lineHeight: 12,
  },
  orbLabel: {
    color: '#005762',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  processingOrb: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingOrbInner: {
    width: 102,
    height: 102,
    borderRadius: 51,
    borderWidth: 1,
    borderColor: 'rgba(180, 0, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speakerOrbWrap: {
    position: 'relative',
  },
  speakerOrbGlow: {
    position: 'absolute',
    top: -54,
    right: -54,
    bottom: -54,
    left: -54,
    borderRadius: 999,
    backgroundColor: 'rgba(180, 0, 255, 0.22)',
    opacity: 0.8,
  },
  speakerOrb: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 3,
    borderColor: 'rgba(180, 0, 255, 0.56)',
    backgroundColor: 'rgba(180, 0, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: tokens.colors.magenta,
    shadowOpacity: 0.26,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  speakerOrbIcon: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -1,
    color: tokens.colors.magenta,
  },
  statePill: {
    color: 'rgba(129, 236, 255, 0.95)',
    fontSize: 18,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  statePillSpeaking: {
    color: 'rgba(255, 214, 255, 0.95)',
  },
  cancelStateBtn: {
    minHeight: 34,
    minWidth: 114,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 129, 0.45)',
    backgroundColor: 'rgba(255, 107, 129, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelStateBtnText: {
    color: '#ff9eb1',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  voiceCopyBlock: {
    width: '100%',
    maxWidth: 680,
    alignItems: 'center',
    gap: 8,
    marginTop: -10,
  },
  idleHint: {
    color: 'rgba(237, 244, 255, 0.48)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginTop: -6,
  },
  wakeWordHint: {
    color: tokens.colors.cyan,
    fontSize: 11,
    opacity: 0.7,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  transcript: {
    color: '#EBEBF5',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  qaBlock: {
    width: '100%',
    gap: 8,
  },
  featuresSection: {
    width: '100%',
    maxWidth: 540,
    flexDirection: 'row',
    gap: 16,
    marginTop: 2,
  },
  featureCard: {
    flex: 1,
    backgroundColor: tokens.colors.darkSecondary,
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.05)',
    borderRadius: 16,
    padding: 17,
    gap: 7,
  },
  featureTitle: {
    color: tokens.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  featureDescription: {
    color: tokens.colors.textSecondary,
    fontSize: 11,
    lineHeight: 18,
  },
  qaQuestion: {
    color: 'rgba(237, 244, 255, 0.62)',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 20,
  },
  qaAnswer: {
    color: tokens.colors.text,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  qaAnswerCar: {
    color: tokens.colors.text,
    fontSize: 20,
    textAlign: 'center',
    lineHeight: 28,
    fontWeight: '600',
  },
  businessCard: {
    backgroundColor: 'rgba(0, 229, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.16)',
    borderRadius: 14,
    padding: 16,
    width: '100%',
  },
  responseCard: {
    width: '92%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.16)',
    backgroundColor: 'rgba(0, 229, 255, 0.05)',
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  transcriptDisplay: {
    width: '92%',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  transcriptLabel: {
    color: tokens.colors.cyan,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    textAlign: 'center',
  },
  transcriptText: {
    color: 'rgba(237, 244, 255, 0.92)',
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
  },
  responseCardSpeaking: {
    backgroundColor: 'rgba(180, 0, 255, 0.10)',
    borderWidth: 2,
    borderColor: 'rgba(180, 0, 255, 0.34)',
  },
  speakingResponseText: {
    fontSize: 18,
  },
  status: {
    color: 'rgba(237, 244, 255, 0.48)',
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 360,
    lineHeight: 18,
  },
  voiceTitle: {
    color: 'rgba(237, 244, 255, 0.96)',
    fontSize: 36,
    fontWeight: '400',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(237, 244, 255, 0.12)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: tokens.colors.cyan,
  },
  attachRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.28)',
    backgroundColor: 'rgba(0, 229, 255, 0.07)',
  },
  attachBtnDisabled: {
    opacity: 0.45,
  },
  attachBtnIcon: {
    fontSize: 14,
  },
  attachBtnLabel: {
    color: 'rgba(129, 236, 255, 0.85)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  imagePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.28)',
    backgroundColor: 'rgba(0, 229, 255, 0.06)',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  imageThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  imagePreviewLabel: {
    flex: 1,
    color: 'rgba(237, 244, 255, 0.75)',
    fontSize: 12,
  },
  imagePreviewClear: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewClearText: {
    color: 'rgba(237, 244, 255, 0.7)',
    fontSize: 12,
  },
  usageCard: {
    width: '100%',
    maxWidth: 220,
    alignSelf: 'center',
    padding: 0,
    marginTop: 2,
    marginBottom: 14,
  },
  usageBlock: {
    width: '100%',
    gap: 6,
  },
  usagePremiumPill: {
    alignSelf: 'center',
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(62, 73, 85, 0.10)',
    backgroundColor: 'rgba(23, 39, 54, 0.50)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 17,
    paddingVertical: 9,
  },
  usagePremiumDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: tokens.colors.cyan,
    shadowColor: tokens.colors.cyan,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  usagePremiumLabel: {
    color: tokens.colors.textSecondary,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '500',
  },
  usageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  usageLabel: {
    color: 'rgba(237, 244, 255, 0.52)',
    fontSize: 9,
    letterSpacing: 1.4,
    fontWeight: '500',
  },
  usageValue: {
    color: tokens.colors.cyan,
    fontSize: 9,
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  usageTrack: {
    width: '100%',
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(237, 244, 255, 0.20)',
  },
  usageFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: tokens.colors.cyan,
    shadowColor: tokens.colors.cyan,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  usageRewardCta: {
    width: '100%',
    height: 34,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.20)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  usageRewardCtaPressed: {
    opacity: 0.78,
  },
  usageRewardCtaDisabled: {
    opacity: 0.5,
  },
  usageRewardCtaText: {
    color: 'rgba(219, 231, 245, 0.94)',
    fontSize: 10,
    letterSpacing: 0.4,
    fontWeight: '500',
  },
  usageRewardHint: {
    marginTop: 6,
    color: 'rgba(190, 214, 238, 0.72)',
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 12,
  },
  usageSessionText: {
    color: 'rgba(237, 244, 255, 0.40)',
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 14,
  },
  bottomNavShell: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(129, 236, 255, 0.12)',
    backgroundColor: 'rgba(7, 20, 32, 0.80)',
    paddingTop: 12,
    paddingBottom: 26,
  },
  bottomNavStatus: {
    color: 'rgba(237, 244, 255, 0.45)',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  bottomNavItems: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  bottomNavItem: {
    minWidth: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bottomNavItemActive: {
    backgroundColor: 'transparent',
  },
  bottomNavIconWrap: {
    minHeight: 18,
  },
  bottomNavIconWrapActive: {
    shadowColor: tokens.colors.cyanSoft,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  bottomNavIcon: {
    color: 'rgba(237, 244, 255, 0.40)',
    fontSize: 13,
  },
  bottomNavIconActive: {
    color: 'rgba(129, 236, 255, 0.95)',
    textShadowColor: 'rgba(129, 236, 255, 0.45)',
    textShadowRadius: 8,
  },
  bottomNavLabel: {
    color: 'rgba(219, 231, 245, 0.42)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
  bottomNavLabelActive: {
    color: 'rgba(129, 236, 255, 0.96)',
  },
});

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function formatGmt2Time(timestampMs: number): string {
  const utcMs = timestampMs + (new Date(timestampMs).getTimezoneOffset() * 60 * 1000);
  const gmt2 = new Date(utcMs + (2 * 60 * 60 * 1000));
  const hours = gmt2.getUTCHours().toString().padStart(2, '0');
  const minutes = gmt2.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
