/**
 * UpgradeBottomSheet — #133
 *
 * Modal bottom sheet that appears when a free user taps a premium-gated feature.
 * Brief explanation + "Upgrade" CTA that navigates to UpgradeScreen.
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';

interface Props {
  visible: boolean;
  featureName: string;
  onClose: () => void;
  onUpgrade: () => void;
}

export function UpgradeBottomSheet({ visible, featureName, onClose, onUpgrade }: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.icon}>✦</Text>
        <Text style={styles.title}>{t('sheet_premium_title')}</Text>
        <Text style={styles.body}>
          {t('sheet_premium_body', { featureName })}
        </Text>

        <Pressable
          style={({ pressed }: { pressed: boolean }) => [styles.upgradeBtn, pressed && styles.upgradeBtnPressed]}
          onPress={onUpgrade}
        >
          <Text style={styles.upgradeBtnText}>{t('sheet_upgrade_btn')}</Text>
        </Pressable>

        <Pressable onPress={onClose} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>{t('sheet_maybe_later')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#0C1A27',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,229,255,0.18)',
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 44,
    alignItems: 'center',
    gap: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(237,244,255,0.25)',
    marginBottom: 8,
  },
  icon: {
    color: '#00E5FF',
    fontSize: 28,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  body: {
    color: 'rgba(237,244,255,0.65)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  featureName: {
    color: '#81ECFF',
    fontWeight: '600',
  },
  upgradeBtn: {
    marginTop: 8,
    width: '100%',
    height: 52,
    borderRadius: 14,
    backgroundColor: '#00C8E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  upgradeBtnPressed: {
    opacity: 0.85,
  },
  upgradeBtnText: {
    color: '#030A12',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  cancelBtn: {
    paddingVertical: 8,
  },
  cancelBtnText: {
    color: 'rgba(237,244,255,0.45)',
    fontSize: 15,
  },
});
