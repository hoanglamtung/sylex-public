import { useState, useCallback, useRef } from 'react';
import Tts from 'react-native-tts';

export interface TTSState {
  isPlaying: boolean;
  caption: string;
  error: string | null;
  play: (text: string, language?: string) => Promise<void>;
  pause: () => void;
  stop: () => void;
}

export function useTTS(): TTSState {
  const [isPlaying, setIsPlaying] = useState(false);
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currentTextRef = useRef('');

  const stop = useCallback(() => {
    Tts.stop();
    setIsPlaying(false);
  }, []);

  const pause = useCallback(() => {
    // react-native-tts does not expose pause — stop is the closest equivalent
    Tts.stop();
    setIsPlaying(false);
  }, []);

  const play = useCallback(async (text: string, language = 'en-US') => {
    if (!text.trim()) return;
    stop();
    setError(null);
    currentTextRef.current = text;
    setCaption(text);

    try {
      await Tts.setDefaultLanguage(language);
    } catch {
      // Language may not be available on device — fall back gracefully
    }

    Tts.removeAllListeners('tts-start');
    Tts.removeAllListeners('tts-finish');
    Tts.removeAllListeners('tts-cancel');
    Tts.removeAllListeners('tts-error');

    Tts.addEventListener('tts-start', () => setIsPlaying(true));
    Tts.addEventListener('tts-finish', () => setIsPlaying(false));
    Tts.addEventListener('tts-cancel', () => setIsPlaying(false));
    Tts.addEventListener('tts-error', () => {
      setIsPlaying(false);
      setError('tts_failed');
    });

    Tts.speak(text);
  }, [stop]);

  return { isPlaying, caption, error, play, pause, stop };
}
