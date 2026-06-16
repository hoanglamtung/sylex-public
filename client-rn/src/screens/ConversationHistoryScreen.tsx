import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAuth } from '../hooks/useAuth';
import {
  ConversationEntry,
  clearConversationHistory,
  getRecentConversation,
  subscribeConversation,
} from '../services/syncService';
import { useTranslation } from 'react-i18next';

type Props = NativeStackScreenProps<RootStackParamList, 'ConversationHistory'>;

const HISTORY_LIMIT = 50;

function formatTimestamp(entry: ConversationEntry, justNow: string): string {
  try {
    const date = entry.createdAt.toDate();
    const now = new Date();
    const diffMins = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (diffMins < 1) return justNow;
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ConversationHistoryScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { isPremium, uid } = useAuth();
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isPremium || !uid) {
      setLoading(false);
      return;
    }
    const unsubscribe = subscribeConversation(uid, HISTORY_LIMIT, (data) => {
      setEntries(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [isPremium, uid]);

  const onRefresh = useCallback(async () => {
    if (!uid || !isPremium) return;
    setRefreshing(true);
    try {
      const data = await getRecentConversation(uid, HISTORY_LIMIT);
      setEntries(data);
    } finally {
      setRefreshing(false);
    }
  }, [uid, isPremium]);

  const handleClearHistory = useCallback(() => {
    Alert.alert(
      t('history_clear_title'),
      t('history_clear_msg'),
      [
        { text: t('history_cancel'), style: 'cancel' },
        {
          text: t('history_clear_all'),
          style: 'destructive',
          onPress: async () => {
            if (!uid) return;
            try {
              await clearConversationHistory(uid);
              setEntries([]);
            } catch {
              Alert.alert(t('history_clear_title'), t('history_clear_error'));
            }
          },
        },
      ],
    );
  }, [uid]);

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{t('history_title')}</Text>
        {isPremium && entries.length > 0 ? (
          <Pressable onPress={handleClearHistory} style={styles.actionBtn}>
            <Text style={styles.clearText}>{t('history_clear')}</Text>
          </Pressable>
        ) : (
          <View style={styles.actionBtn} />
        )}
      </View>

      {/* Non-premium gate */}
      {!isPremium ? (
        <View style={styles.gateContainer}>
          <Text style={styles.gateIcon}>🔒</Text>
          <Text style={styles.gateTitle}>{t('history_premium_only')}</Text>
          <Text style={styles.gateSubtitle}>
            {t('history_premium_subtitle')}
          </Text>
          <Pressable style={styles.upgradeBtn} onPress={() => navigation.navigate('Upgrade')}>
            <Text style={styles.upgradeBtnText}>{t('history_upgrade_btn')}</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#00E5FF" size="large" />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={
            entries.length === 0 ? styles.emptyContainer : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#00E5FF"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>{t('history_empty_title')}</Text>
              <Text style={styles.emptySubtitle}>
                {t('history_empty_subtitle')}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.entryCard,
                item.role === 'user' ? styles.entryCardUser : styles.entryCardAssistant,
              ]}
            >
              <View style={styles.entryHeader}>
                <Text
                  style={[
                    styles.entryRole,
                    item.role === 'user' ? styles.entryRoleUser : styles.entryRoleAssistant,
                  ]}
                >
                  {item.role === 'user' ? t('history_role_you') : t('history_role_assistant')}
                </Text>
                <Text style={styles.entryTime}>{formatTimestamp(item, t('history_just_now'))}</Text>
              </View>
              <Text style={styles.entryText}>{item.text}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0, 229, 255, 0.2)',
  },
  backBtn: { width: 44, alignItems: 'flex-start', justifyContent: 'center' },
  backText: { color: '#00E5FF', fontSize: 28, lineHeight: 32 },
  title: { color: '#81ECFF', fontSize: 15, fontWeight: '700', letterSpacing: 1.6 },
  actionBtn: { width: 44, alignItems: 'flex-end', justifyContent: 'center' },
  clearText: { color: '#FF453A', fontSize: 14, fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Premium gate
  gateContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  gateIcon: { fontSize: 48, marginBottom: 8 },
  gateTitle: { color: '#81ECFF', fontSize: 14, fontWeight: '700', letterSpacing: 1.8 },
  gateSubtitle: {
    color: 'rgba(237, 244, 255, 0.55)', fontSize: 14,
    textAlign: 'center', lineHeight: 20,
  },
  upgradeBtn: {
    marginTop: 16, height: 46, paddingHorizontal: 28, borderRadius: 12,
    backgroundColor: 'rgba(0, 229, 255, 0.12)', borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.3)', justifyContent: 'center', alignItems: 'center',
  },
  upgradeBtnText: { color: '#00E5FF', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },

  // List
  listContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: 10, paddingTop: 80,
  },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { color: 'rgba(237, 244, 255, 0.8)', fontSize: 17, fontWeight: '600' },
  emptySubtitle: {
    color: 'rgba(237, 244, 255, 0.4)', fontSize: 14,
    textAlign: 'center', lineHeight: 20,
  },

  // History entry cards
  entryCard: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 6 },
  entryCardUser: {
    backgroundColor: 'rgba(74, 144, 226, 0.08)',
    borderColor: 'rgba(74, 144, 226, 0.2)',
  },
  entryCardAssistant: {
    backgroundColor: 'rgba(0, 229, 255, 0.05)',
    borderColor: 'rgba(0, 229, 255, 0.15)',
  },
  entryHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  entryRole: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  entryRoleUser: { color: 'rgba(74, 144, 226, 0.9)' },
  entryRoleAssistant: { color: 'rgba(0, 229, 255, 0.9)' },
  entryTime: { color: 'rgba(237, 244, 255, 0.35)', fontSize: 11 },
  entryText: { color: 'rgba(237, 244, 255, 0.9)', fontSize: 15, lineHeight: 22 },
});
