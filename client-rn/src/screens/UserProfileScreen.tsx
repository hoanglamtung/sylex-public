/**
 * UserProfileScreen — #192
 *
 * Accessible from the avatar button (top-left of HomeScreen).
 *
 * Shows:
 *   • Avatar with initials (or anonymous dot)
 *   • Display name + provider badge
 *   • Signed email  (the email used to log in)
 *   • Buyer email   (Apple ID tied to IAP purchases, if different from signed email)
 *   • Sign-in buttons (Apple / Google) when the account is still anonymous
 *   • Sign-out button when linked
 *
 * Buyer-email model:
 *   iOS App Store purchases are billed to the Apple ID in device Settings.
 *   If the user signed in with Google but purchases via IAP, the payment Apple ID
 *   differs from their Google email. This screen shows both so the user can
 *   understand which identity holds their subscription and which holds their data.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { AppleButton } from '@invertase/react-native-apple-authentication';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../hooks/useAuth';
import { PremiumBadge } from '../components/PremiumBadge';
import { GoogleIcon } from '../components/Icons';
import { openSubscriptionManagement } from '../services/subscriptionManagement';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'UserProfile'>;

const PROVIDER_ICON: Record<string, string> = {
  apple:     '',
  google:    'G',
  anonymous: '?',
};

const PROVIDER_LABEL: Record<string, string> = {
  apple:     'Apple ID',
  google:    'Google',
  anonymous: 'Guest (no account)',
};

export function UserProfileScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const {
    displayName,
    signedEmail,
    buyerEmail,
    photoURL: _photoURL, // reserved for future avatar image
    provider,
    isLinked,
    isPremium,
    loading: authLoading,
    linkedProviders,
    linkWithApple,
    linkWithGoogle,
    signOut,
  } = useAuth();

  const [signingIn, setSigningIn] = useState(false);

  // ── which providers are currently linked ───────────────────────────────────
  const hasGoogle = linkedProviders.includes('google.com');
  const hasApple  = linkedProviders.includes('apple.com');

  // ── derive avatar initials ──────────────────────────────────────────────────
  const initials: string = (() => {
    if (!displayName) return '?';
    return displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join('');
  })();

  // ── handlers ───────────────────────────────────────────────────────────────

  async function handleLinkWithApple() {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await linkWithApple();
    } catch (e: any) {
      Alert.alert(t('profile_sign_in_failed'), e.message ?? t('profile_try_again'));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleLinkWithGoogle() {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await linkWithGoogle();
    } catch (e: any) {
      Alert.alert(t('profile_sign_in_failed'), e.message ?? t('profile_try_again'));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    Alert.alert(
      t('profile_sign_out_title'),
      t('profile_sign_out_msg'),
      [
        { text: t('profile_cancel'), style: 'cancel' },
        {
          text: t('profile_sign_out_action'),
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              navigation.goBack();
            } catch (e: any) {
              Alert.alert(t('profile_sign_out_failed'), e.message ?? t('profile_try_again'));
            }
          },
        },
      ],
    );
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  const googleIdentity = hasGoogle ? (signedEmail ?? 'Google linked') : t('profile_not_linked');
  const appleIdentity = hasApple ? (buyerEmail ?? 'Apple linked') : t('profile_not_linked');

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile_title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Avatar ── */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarRing}>
            <View style={styles.avatarCircle}>
              {isLinked ? (
                <Text style={styles.avatarInitials}>{initials}</Text>
              ) : (
                <Text style={styles.avatarDot}>●</Text>
              )}
            </View>
          </View>

          {displayName ? (
            <Text style={styles.displayName}>{displayName}</Text>
          ) : (
            <Text style={styles.displayNameAnon}>{t('profile_guest_user')}</Text>
          )}

          {/* Provider badge */}
          <View style={styles.providerBadge}>
            {hasGoogle && hasApple ? (
              <>
                <Text style={styles.providerBadgeIcon}>G</Text>
                <Text style={styles.providerBadgeText}>Google + Apple</Text>
              </>
            ) : (
              <>
                <Text style={styles.providerBadgeIcon}>{PROVIDER_ICON[provider] ?? '?'}</Text>
                <Text style={styles.providerBadgeText}>{PROVIDER_LABEL[provider] ?? provider}</Text>
              </>
            )}
          </View>

          {/* Premium badge */}
          {isPremium && (
            <View style={styles.premiumRow}>
              <PremiumBadge tier="pro" />
            </View>
          )}
        </View>

        {/* ── Account Identity ── */}
        <>
          <Text style={styles.sectionHeader}>{t('profile_account_identity')}</Text>
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Google</Text>
              <Text style={hasGoogle ? styles.cardValue : styles.cardValueDim} numberOfLines={1}>{googleIdentity}</Text>
            </View>
            {!hasGoogle && (
              <TouchableOpacity
                style={[styles.googleBtn, signingIn && styles.btnDisabled]}
                onPress={handleLinkWithGoogle}
                disabled={signingIn}
              >
                {signingIn ? (
                  <ActivityIndicator color="#EBEBF5" size="small" />
                ) : (
                  <>
                    <GoogleIcon size={18} />
                    <Text style={styles.googleBtnText}>{t('profile_continue_google')}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.divider} />
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>{t('profile_apple_id')}</Text>
              <Text style={hasApple ? styles.cardValue : styles.cardValueDim} numberOfLines={1}>{appleIdentity}</Text>
            </View>
            {!hasApple && Platform.OS === 'ios' && (
              <>
                <Text style={styles.buyerHint}>{t('profile_link_apple_hint')}</Text>
                <AppleButton
                  buttonStyle={AppleButton.Style.BLACK}
                  buttonType={AppleButton.Type.SIGN_IN}
                  style={styles.appleBtn}
                  onPress={handleLinkWithApple}
                />
              </>
            )}
          </View>
        </>

        {/* ── Subscription ── */}
        <Text style={styles.sectionHeader}>{t('profile_subscription_section')}</Text>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>{t('profile_current_plan')}</Text>
            <PremiumBadge tier={isPremium ? 'pro' : 'free'} />
          </View>
          {isPremium ? (
            <TouchableOpacity
              style={styles.manageBtn}
              onPress={() => void openSubscriptionManagement()}
            >
              <Text style={styles.manageBtnText}>{t('profile_manage_subscription')}</Text>
              <Text style={styles.manageBtnChevron}>›</Text>
            </TouchableOpacity>
          ) : !authLoading ? (
            <TouchableOpacity
              style={styles.upgradeBtn}
              onPress={() => navigation.navigate('Upgrade')}
            >
              <Text style={styles.upgradeBtnText}>{t('profile_upgrade_premium')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Sign out ── */}
        {isLinked && (
          <>
            <Text style={styles.sectionHeader}>{t('profile_account_section')}</Text>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Text style={styles.signOutBtnText}>{t('profile_sign_out_action')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Guest hint */}
        {!isLinked && (
          <Text style={styles.guestHint}>
            {t('profile_guest_hint')}
          </Text>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headerSpacer: { width: 36 },

  // ── Avatar section ──────────────────────────────────────────────────────
  avatarSection: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 8,
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 229, 255, 0.40)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0, 229, 255, 0.10)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#00E5FF',
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: 1,
  },
  avatarDot: {
    color: 'rgba(0, 229, 255, 0.40)',
    fontSize: 20,
  },
  displayName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 6,
  },
  displayNameAnon: {
    color: '#636366',
    fontSize: 18,
    fontWeight: '400',
    marginBottom: 6,
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.22)',
    backgroundColor: 'rgba(0, 229, 255, 0.06)',
    marginBottom: 8,
  },
  providerBadgeIcon: {
    color: '#00E5FF',
    fontSize: 11,
    fontWeight: '700',
  },
  providerBadgeText: {
    color: 'rgba(129, 236, 255, 0.80)',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  premiumRow: {
    marginTop: 4,
  },

  // ── Sections ────────────────────────────────────────────────────────────
  content: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    gap: 8,
  },
  sectionHeader: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 28,
    marginBottom: 8,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 229, 255, 0.14)',
    backgroundColor: 'rgba(7, 20, 32, 0.60)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  cardLabel: {
    color: '#8E8E93',
    fontSize: 13,
    flexShrink: 0,
    marginRight: 12,
  },
  cardValue: {
    color: '#EBEBF5',
    fontSize: 13,
    flexShrink: 1,
    textAlign: 'right',
  },
  cardValueDim: {
    color: '#48484A',
    fontSize: 13,
    textAlign: 'right',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0, 229, 255, 0.10)',
    marginVertical: 4,
  },
  buyerHint: {
    color: '#636366',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
    paddingTop: 2,
  },

  // ── Sign-in ────────────────────────────────────────────────────────────
  signInIntro: {
    color: '#8E8E93',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  appleBtn: {
    height: 48,
    borderRadius: 8,
    marginBottom: 10,
  },
  googleBtn: {
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(7, 20, 32, 0.56)',
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.10)',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  btnDisabled: { opacity: 0.4 },
  googleBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },

  // ── Subscription ──────────────────────────────────────────────────────
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: 4,
  },
  manageBtnText: {
    color: '#4A90E2',
    fontSize: 14,
  },
  manageBtnChevron: {
    color: '#4A90E2',
    fontSize: 18,
  },
  upgradeBtn: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.32)',
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  upgradeBtnText: {
    color: 'rgba(129, 236, 255, 0.95)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
  },

  // ── Sign out ──────────────────────────────────────────────────────────
  signOutBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 59, 48, 0.30)',
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signOutBtnText: {
    color: '#FF3B30',
    fontSize: 15,
    fontWeight: '500',
  },

  // ── Guest hint ────────────────────────────────────────────────────────
  guestHint: {
    color: '#48484A',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 12,
  },
});
