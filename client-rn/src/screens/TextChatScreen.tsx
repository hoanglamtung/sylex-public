/**
 * TextChatScreen — text-based chat interface.
 *
 * Wired to the "CHAT" icon in the bottom nav of HomeScreen.
 * Uses the same orchestration service as the voice push-to-talk flow
 * (LLM + TTS pipeline), but takes typed input instead of voice.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Image,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { orchestrate } from '../services/orchestrationService';
import { appendConversationEntry } from '../services/syncService';
import { useAuth } from '../hooks/useAuth';
import i18n from '../i18n';
import { useTranslation } from 'react-i18next';
import { useImageAttachment } from '../hooks/useImageAttachment';

const SERVER_ENDPOINT = 'https://api.car-assistant-pro.silverleaf.studio';
const API_VERSION = 'v1';
const REQUEST_TIMEOUT_MS = 30_000;

type Props = NativeStackScreenProps<RootStackParamList, 'TextChat'>;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}

function generateSessionId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function TextChatScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { isPremium, uid } = useAuth();
  const { image: attachedImage, isLoading: imageLoading, pick: pickImage, clear: clearImage } =
    useImageAttachment(isPremium, () => navigation.navigate('Upgrade'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sessionIdRef = useRef(generateSessionId());
  const flatListRef = useRef<FlatList<Message>>(null);
  const activeRequestIdRef = useRef<string | null>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pendingId = `${requestId}-pending`;
    activeRequestIdRef.current = requestId;

    setInput('');
    setSending(true);

    const userMsg: Message = {
      id: `${Date.now()}-u`,
      role: 'user',
      text,
    };
    const pendingAssistantMsg: Message = {
      id: pendingId,
      role: 'assistant',
      text: '...',
      pending: true,
    };
    setMessages(prev => [...prev, userMsg, pendingAssistantMsg]);

    try {
      const result = await orchestrate({
        userText: text,
        sessionId: sessionIdRef.current,
        language: i18n.language,
        serverEndpoint: SERVER_ENDPOINT,
        apiVersion: API_VERSION,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        imageBase64: attachedImage?.base64 ?? null,
        imageMimeType: attachedImage?.mimeType,
      });
      if (activeRequestIdRef.current !== requestId) return;
      const assistantMsg: Message = {
        id: `${Date.now()}-a`,
        role: 'assistant',
        text: result.replyText,
      };
      setMessages(prev => [...prev.filter(m => m.id !== pendingId), assistantMsg]);
      clearImage();
      if (isPremium && uid) {
        void appendConversationEntry(uid, { role: 'user', text });
        void appendConversationEntry(uid, { role: 'assistant', text: result.replyText });
      }
    } catch (e: any) {
      if (activeRequestIdRef.current !== requestId) return;
      const errMsg: Message = {
        id: `${Date.now()}-e`,
        role: 'assistant',
        text: e?.message ?? t('chat_error_fallback'),
      };
      setMessages(prev => [...prev.filter(m => m.id !== pendingId), errMsg]);
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
        setSending(false);
      }
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [attachedImage?.base64, attachedImage?.mimeType, clearImage, input, isPremium, sending, t, uid]);

  const cancelPending = useCallback(() => {
    const activeRequestId = activeRequestIdRef.current;
    if (!activeRequestId) return;
    activeRequestIdRef.current = null;
    setSending(false);
    setMessages(prev => prev.filter(m => m.id !== `${activeRequestId}-pending`));
  }, []);

  const openAttachmentChooser = useCallback(() => {
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

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{t('chat_title')}</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Message list */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>◉</Text>
              <Text style={styles.emptyTitle}>{t('chat_empty_title')}</Text>
              <Text style={styles.emptySubtitle}>{t('chat_empty_subtitle')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                item.pending && styles.bubblePending,
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  item.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant,
                  item.pending && styles.bubbleTextPending,
                ]}
              >
                {item.text}
              </Text>
            </View>
          )}
        />

        {/* Input row */}
        {attachedImage && (
          <View style={styles.attachmentPreviewCard}>
            <Image source={{ uri: attachedImage.uri }} style={styles.attachmentPreviewImage} />
            <View style={styles.attachmentPreviewCopy}>
              <Text style={styles.attachmentPreviewTitle}>Image attached</Text>
              <Text style={styles.attachmentPreviewMeta}>{Math.max(1, Math.round(attachedImage.sizeBytes / 1024))} KB</Text>
            </View>
            <Pressable style={styles.attachmentPreviewClearBtn} onPress={clearImage}>
              <Text style={styles.attachmentPreviewClearText}>✕</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.inputRow}>
          <Pressable style={styles.addBtn} onPress={openAttachmentChooser}>
            {imageLoading ? <ActivityIndicator size="small" color="#DFF3FF" /> : <Text style={styles.addBtnIcon}>+</Text>}
          </Pressable>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('chat_placeholder')}
            placeholderTextColor="rgba(237,244,255,0.35)"
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={send}
            blurOnSubmit
          />
          <Pressable
            style={[
              styles.sendBtn,
              sending && styles.sendBtnCancel,
              (!input.trim() && !sending) && styles.sendBtnDisabled,
            ]}
            onPress={sending ? cancelPending : send}
            disabled={!input.trim() && !sending}
          >
            {sending ? <Text style={styles.sendCancelText}>STOP</Text> : <Text style={styles.sendText}>SEND</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 229, 255, 0.15)',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: {
    color: '#00E5FF',
    fontSize: 30,
    lineHeight: 34,
  },
  title: {
    color: '#81ECFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  headerSide: {
    width: 36,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyIcon: {
    color: 'rgba(129, 236, 255, 0.5)',
    fontSize: 36,
  },
  emptyTitle: {
    color: 'rgba(237,244,255,0.8)',
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: 'rgba(237,244,255,0.4)',
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 240,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0, 229, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.3)',
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(237, 244, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(237, 244, 255, 0.12)',
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: '#00E5FF',
  },
  bubbleTextAssistant: {
    color: 'rgba(237,244,255,0.9)',
  },
  bubblePending: {
    opacity: 0.75,
  },
  bubbleTextPending: {
    letterSpacing: 2,
  },
  attachmentPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.2)',
    backgroundColor: 'rgba(8, 20, 30, 0.94)',
  },
  attachmentPreviewImage: {
    width: 52,
    height: 52,
    borderRadius: 10,
  },
  attachmentPreviewCopy: {
    flex: 1,
    gap: 4,
  },
  attachmentPreviewTitle: {
    color: 'rgba(237,244,255,0.92)',
    fontSize: 14,
    fontWeight: '600',
  },
  attachmentPreviewMeta: {
    color: 'rgba(237,244,255,0.5)',
    fontSize: 12,
  },
  attachmentPreviewClearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  attachmentPreviewClearText: {
    color: '#DFF3FF',
    fontSize: 13,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 229, 255, 0.2)',
    backgroundColor: 'rgba(4, 15, 25, 0.92)',
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(237, 244, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(237, 244, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  addBtnIcon: {
    color: '#DFF3FF',
    fontSize: 26,
    lineHeight: 28,
    marginTop: -2,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: 'rgba(237, 244, 255, 0.07)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.25)',
    color: '#EBEBF5',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 229, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnCancel: {
    backgroundColor: 'rgba(255, 107, 129, 0.2)',
    borderColor: 'rgba(255, 107, 129, 0.4)',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: '#00E5FF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sendCancelText: {
    color: '#FFB3C0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
