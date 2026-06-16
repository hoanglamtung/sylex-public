import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '../hooks/useErrorRecovery';

interface ErrorBannerProps {
  error: ErrorState;
  onRetry: () => void;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onRetry, onDismiss }: ErrorBannerProps) {
  const { t } = useTranslation();

  if (!error.visible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('error_banner_title')}</Text>
      <Text style={styles.message}>{error.message}</Text>
      <View style={styles.actions}>
        {error.type !== 'error_daily_limit' && error.type !== 'error_session_ended' && (
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
            <Text style={styles.retryText}>{t('error_banner_retry')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.closeBtn} onPress={onDismiss}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FF3B30',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    color: '#FF3B30',
    fontWeight: '600',
    fontSize: 13,
    marginBottom: 4,
  },
  message: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 12,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#2C2C2E',
    borderRadius: 8,
  },
  retryText: {
    color: '#4A90E2',
    fontWeight: '600',
    fontSize: 14,
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeText: {
    color: '#8E8E93',
    fontSize: 16,
  },
});
