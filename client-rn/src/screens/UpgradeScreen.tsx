import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { DAILY_LIMIT, getDailyCount } from '../services/usageService';
import {
  PRODUCT_IDS,
  type ProductId,
  attachPurchaseListeners,
  purchaseSubscription,
  validateReceipt,
  finishPurchase,
  restorePurchases,
} from '../services/iapService';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';

type Props = NativeStackScreenProps<RootStackParamList, 'Upgrade'>;

const COMPARE_ROWS = [  
  { feature: 'Daily requests', free: '30', pro: 'Unlimited' },
  { feature: 'Session limit', free: '10 min', pro: '30 min' },
  { feature: 'Context memory', free: 'None', pro: 'Session-scoped' },
  { feature: 'Multimodal', free: '✕', pro: '✓' },
  { feature: 'Routines', free: '✕', pro: '✓' },
  { feature: 'Hands-Free ("Hey Sylex")', free: '✕', pro: '✓' },
  { feature: 'Summaries', free: '✕', pro: '✓' },
  { feature: 'Long-form tasks', free: '✕', pro: '✓' },
  { feature: 'Cross-device sync', free: '✕', pro: '✓' },
  { feature: 'Ads', free: 'Yes', pro: 'No' },
  { feature: 'Personal Assistant', free: 'No', pro: 'v1.2' },
  { feature: 'Business Assistant', free: 'No', pro: 'v1.3' },
  { feature: 'Kid Assistant', free: 'No', pro: 'v1.4' },
  { feature: 'Car Assistant', free: 'No', pro: 'v1.5' },
];

const TARGET_RADIUS = 110;
const TARGET_RING_SIZE = 260;
const SCREEN_WIDTH = Dimensions.get('window').width;
const RING_SIZE = Math.min(TARGET_RING_SIZE, SCREEN_WIDTH - 24);
const R = Math.max(0, (RING_SIZE - 40) / 2);
const RING_CENTER = RING_SIZE / 2;
const CIRC = 2 * Math.PI * R;

type Plan = 'monthly' | 'yearly';

export function UpgradeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { isPremium, loading: authLoading, refreshPremium } = useAuth();
  const [used, setUsed] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<Plan>('yearly');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    getDailyCount().then(count => {
      setUsed(Math.min(count, DAILY_LIMIT));
    });
  }, []);


  // Attach purchase listeners scoped to this screen so the user sees
  // immediate feedback even if the global App.tsx listener fires first.
  useEffect(() => {
    detachRef.current = attachPurchaseListeners(
      async (purchase) => {
        try {
          await validateReceipt(purchase);
          await finishPurchase(purchase);
          // Force-refresh Firebase token so isPremium claim is picked up immediately
          await refreshPremium();
          navigation.goBack();
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Purchase could not be verified.';
          // On server errors (5xx) leave the transaction in the queue so StoreKit
          // re-delivers it on next app launch and the server gets another chance.
          // On permanent client errors finish the transaction to clear the queue.
          const isServerError = e instanceof Error && /\b5\d{2}\b/.test(e.message);
          if (!isServerError) {
            await finishPurchase(purchase).catch(() => {});
          }
          Alert.alert(t('upgrade_error_purchase'), msg);
        } finally {
          setPurchasing(false);
        }
      },
      (err) => {
        const code = (err as { code?: string }).code;
        if (code === 'already-owned' || code === 'E_ALREADY_OWNED') {
          // The item is already owned at the App Store / Play Store level.
          // 1st attempt: restore via receipt.
          // 2nd attempt: check server status directly — the background App.tsx listener
          //   may have already validated and finished the transaction silently.
          restorePurchases()
            .then(async (restored) => {
              if (restored) {
                await refreshPremium();
                navigation.goBack();
                return;
              }
              // Receipt restore found nothing — the background App.tsx listener may have
              // already validated + finished the transaction. Force-refresh the Firebase
              // token and read the isPremium custom claim directly.
              console.warn('[IAP] restorePurchases returned false, checking token claim');
              await refreshPremium();
              // isPremium useEffect guard will navigate back if claim is now true
              Alert.alert(
                t('upgrade_error_purchase'),
                'Your purchase is being processed. Please close and reopen the app.',
              );
            })
            .catch((e) => {
              console.warn('[IAP] already-owned restore error', e);
              Alert.alert(t('upgrade_error_purchase'), (e instanceof Error ? e.message : null) ?? t('upgrade_error_restore_failed'));
            })
            .finally(() => setPurchasing(false));
          return;
        }
        if (code !== 'E_USER_CANCELLED') {
          Alert.alert(t('upgrade_error_purchase'), err.message ?? t('upgrade_error_restore_failed'));
        }
        setPurchasing(false);
      },
    );
    return () => { detachRef.current?.(); };
  }, [navigation]);

  const handlePurchase = async () => {
    if (purchasing) { return; }
    setPurchasing(true);
    const productId: ProductId = PRODUCT_IDS[selectedPlan];
    try {
      await purchaseSubscription(productId);
      // Result arrives asynchronously via purchaseUpdatedListener above
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not start purchase.';
      Alert.alert(t('upgrade_error_purchase'), msg);
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (restoring) { return; }
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      if (restored) {
        await refreshPremium();
        navigation.goBack();
      } else {
        Alert.alert(t('upgrade_error_no_sub'), t('upgrade_error_no_sub_msg'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('upgrade_error_restore_failed');
      Alert.alert(t('upgrade_error_restore_failed'), msg);
    } finally {
      setRestoring(false);
    }
  };

  const usedPercent = Math.round((used / DAILY_LIMIT) * 100);
  const offset = CIRC * (1 - usedPercent / 100);

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>ASSISTANT PRO</Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Usage ring + headline — only shown for free users (#211) */}
        {!isPremium && (
        <>
        <View style={styles.ringWrap}>
          <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <Circle
              cx={RING_CENTER} cy={RING_CENTER} r={R}
              fill="transparent"
              stroke="rgba(23,39,54,0.8)"
              strokeWidth={5}
            />
            <Circle
              cx={RING_CENTER} cy={RING_CENTER} r={R}
              fill="transparent"
              stroke="#81ecff"
              strokeWidth={5}
              strokeDasharray={`${CIRC}`}
              strokeDashoffset={`${offset}`}
              strokeLinecap="round"
              rotation={-90}
              origin={`${RING_CENTER}, ${RING_CENTER}`}
            />
          </Svg>
          <View style={styles.ringLabelWrap}>
            <Text style={styles.ringCount}>{used}/{DAILY_LIMIT}</Text>
            <Text style={styles.ringSub}>{t('upgrade_commands')}</Text>
          </View>
        </View>

        <Text style={styles.usageCaption}>
          {t('upgrade_usage_caption', { pct: usedPercent })}
        </Text>

        {/* Headline */}
        <View style={styles.headlineBlock}>
          <Text style={styles.headline}>
            {t('upgrade_headline')}
          </Text>
          <Text style={styles.subtext}>
            {t('upgrade_subtext')}
          </Text>
        </View>
        </>
        )}

        {/* Comparison table */}
        <View style={styles.tableSection}>
          <Text style={styles.tableHeading}>{t('upgrade_table_heading')}</Text>
          <View style={styles.tableWrap}>
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={[styles.tableCell, styles.tableCellFeature, styles.tableHeadCell]}>{t('upgrade_col_feature')}</Text>
              <Text style={[styles.tableCell, styles.tableCellFree, styles.tableHeadCell, styles.textCenter]}>{t('upgrade_col_free')}</Text>
              <Text style={[styles.tableCell, styles.tableCellPro, styles.tableHeadCell, styles.tableHeadPro, styles.textCenter]}>{t('upgrade_col_premium')}</Text>
            </View>
            {COMPARE_ROWS.map(({ feature, free, pro }, idx) => (
              <View
                key={feature}
                style={[styles.tableRow, idx === COMPARE_ROWS.length - 1 ? styles.tableRowLast : undefined]}
              >
                <Text style={[styles.tableCell, styles.tableCellFeature]}>{feature}</Text>
                <Text style={[styles.tableCell, styles.tableCellFree, styles.textCenter, styles.tdFreeColor]}>{free}</Text>
                <Text style={[styles.tableCell, styles.tableCellPro, styles.textCenter, styles.tdProColor]}>{pro}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Plans */}
        <View style={styles.plans}>
          <Pressable
            style={[styles.planCard, selectedPlan === 'monthly' && styles.planSelected]}
            onPress={() => setSelectedPlan('monthly')}
          >
            <Text style={styles.planPeriod}>{t('upgrade_plan_monthly')}</Text>
            <Text style={styles.planPrice}>$7.99</Text>
            <Text style={styles.planNote}>{t('upgrade_plan_monthly_note')}</Text>
          </Pressable>
          <Pressable
            style={[styles.planCard, styles.planFeatured, selectedPlan === 'yearly' && styles.planSelected]}
            onPress={() => setSelectedPlan('yearly')}
          >
            <View style={styles.planBestBadge}>
              <Text style={styles.planBestText}>{t('upgrade_plan_best_value')}</Text>
            </View>
            <Text style={[styles.planPeriod, styles.planPeriodPro]}>{t('upgrade_plan_yearly')}</Text>
            <Text style={styles.planPrice}>$69.99</Text>
            <Text style={styles.planNote}>{t('upgrade_plan_yearly_note')}</Text>
          </Pressable>
        </View>

        <View style={{ height: 140 }} />
      </ScrollView>

      {/* Sticky CTA — only show purchase UI for non-premium users */}
      {!isPremium && (
      <View style={styles.ctaBar}>
        <Pressable
          style={[styles.ctaBtn, purchasing && styles.ctaBtnDisabled]}
          onPress={handlePurchase}
          disabled={purchasing}
        >
          {purchasing
            ? <ActivityIndicator color="#003840" size="small" />
            : <Text style={styles.ctaBtnText}>{t('upgrade_cta')}</Text>
          }
        </Pressable>
        <Pressable onPress={handleRestore} disabled={restoring} style={styles.restoreBtn}>
          <Text style={styles.restoreBtnText}>
            {restoring ? t('upgrade_restoring') : t('upgrade_restore')}
          </Text>
        </Pressable>
        <View style={styles.ctaLegalRow}>
          <Text style={styles.ctaLegal}>{t('upgrade_cancel_anytime')} </Text>
          <Pressable onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}>
            <Text style={[styles.ctaLegal, styles.ctaLegalLink]}>{t('upgrade_terms')}</Text>
          </Pressable>
          <Text style={styles.ctaLegal}> · </Text>
          <Pressable onPress={() => Linking.openURL('https://silverleaf.studio/#privacy')}>
            <Text style={[styles.ctaLegal, styles.ctaLegalLink]}>{t('upgrade_privacy_policy')}</Text>
          </Pressable>
        </View>
      </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#030d17',
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(23,39,54,0.9)',
    backgroundColor: 'rgba(4,15,25,0.9)',
  },
  headerTitle: {
    color: 'rgba(129,236,255,0.95)',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.4,
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
  headerSide: {
    width: 36,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingTop: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 32,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLabelWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  ringCount: {
    color: 'rgba(237,244,255,0.95)',
    fontSize: 34,
    fontWeight: '700',
  },
  ringSub: {
    color: 'rgba(237,244,255,0.55)',
    fontSize: 12,
    letterSpacing: 1,
  },
  usageCaption: {
    color: 'rgba(237,244,255,0.6)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  usagePct: {
    color: '#00e5ff',
    fontWeight: '600',
  },
  headlineBlock: {
    alignItems: 'center',
    gap: 12,
    maxWidth: 340,
  },
  headline: {
    color: 'rgba(237,244,255,0.96)',
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  headlineAccent: {
    color: '#81ecff',
  },
  subtext: {
    color: 'rgba(237,244,255,0.6)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  tableSection: {
    width: '100%',
    gap: 14,
  },
  tableHeading: {
    color: 'rgba(237,244,255,0.92)',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  tableWrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.12)',
    backgroundColor: 'rgba(23,39,54,0.4)',
    overflow: 'hidden',
  },
  tableHead: {
    backgroundColor: 'rgba(18,33,46,0.5)',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(62,73,85,0.2)',
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableHeadCell: {
    fontSize: 9,
    letterSpacing: 1,
    color: 'rgba(237,244,255,0.55)',
    fontWeight: '700',
  },
  tableHeadPro: {
    color: 'rgba(129,236,255,0.95)',
  },
  tableCell: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    fontSize: 11,
    color: 'rgba(237,244,255,0.88)',
  },
  tableCellFeature: {
    flex: 2,
    fontWeight: '500',
  },
  tableCellFree: {
    flex: 1.5,
  },
  tableCellPro: {
    flex: 2,
  },
  textCenter: {
    textAlign: 'center',
  },
  tdFreeColor: {
    color: 'rgba(237,244,255,0.5)',
  },
  tdProColor: {
    color: '#81ecff',
    fontWeight: '700',
  },
  plans: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    justifyContent: 'center',
  },
  planCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(62,73,85,0.3)',
    backgroundColor: 'rgba(7,20,32,0.6)',
    paddingVertical: 20,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },
  planFeatured: {
    borderColor: 'rgba(0,229,255,0.4)',
    backgroundColor: 'rgba(18,33,46,0.7)',
  },
  planSelected: {
    borderColor: '#00e5ff',
    borderWidth: 2,
  },
  planBestBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#00e5ff',
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  planBestText: {
    color: '#003840',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  planPeriod: {
    color: 'rgba(237,244,255,0.55)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginTop: 8,
  },
  planPeriodPro: {
    color: 'rgba(129,236,255,0.95)',
    marginTop: 18,
  },
  planPrice: {
    color: 'rgba(237,244,255,0.96)',
    fontSize: 22,
    fontWeight: '900',
  },
  planNote: {
    color: 'rgba(237,244,255,0.45)',
    fontSize: 9,
    marginTop: 2,
  },
  ctaBar: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,229,255,0.12)',
    backgroundColor: 'rgba(4,15,25,0.97)',
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
  },
  ctaBtn: {
    width: '100%',
    maxWidth: 440,
    height: 58,
    borderRadius: 999,
    backgroundColor: '#00e3fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaBtnDisabled: {
    opacity: 0.6,
  },
  ctaBtnText: {
    color: '#003840',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  restoreBtn: {
    paddingVertical: 4,
  },
  restoreBtnText: {
    color: 'rgba(129,236,255,0.7)',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  ctaLegalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  ctaLegal: {
    color: 'rgba(237,244,255,0.4)',
    fontSize: 9,
    letterSpacing: 1.2,
  },
  ctaLegalLink: {
    color: 'rgba(129,236,255,0.65)',
    textDecorationLine: 'underline',
  },
});
