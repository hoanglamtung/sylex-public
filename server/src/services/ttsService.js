import textToSpeech from '@google-cloud/text-to-speech';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const { TextToSpeechClient } = textToSpeech;

// Map Azure Neural voice names to Google WaveNet equivalents
const AZURE_TO_GOOGLE_VOICE = {
  'en-US-JennyNeural':  'en-US-Wavenet-F',
  'en-US-GuyNeural':    'en-US-Wavenet-D',
  'de-DE-AmalaNeural':  'de-DE-Wavenet-A',
  'de-DE-KlausNeural':  'de-DE-Wavenet-B',
  'fr-FR-DeniseNeural': 'fr-FR-Wavenet-A',
  'es-ES-ElviraNeural': 'es-ES-Wavenet-B',
  'it-IT-ElsaNeural':   'it-IT-Wavenet-A',
  'tr-TR-EmelNeural':   'tr-TR-Standard-B',
  'pl-PL-ZofiaNeural':  'pl-PL-Wavenet-A',
};

// Default Google voices per language
// de-DE uses Neural2 (higher quality, trained on more data than WaveNet)
const DEFAULT_VOICE = {
  'en-US': 'en-US-Wavenet-F',
  'de-DE': 'de-DE-Neural2-F',
  'fr-FR': 'fr-FR-Wavenet-A',
  'es-ES': 'es-ES-Wavenet-B',
  'it-IT': 'it-IT-Wavenet-A',
  'tr-TR': 'tr-TR-Standard-B',
  'pl-PL': 'pl-PL-Wavenet-A',
};

/**
 * TTS Service
 * Handles text-to-speech synthesis with multiple provider support
 * Supports SSML for prosody control
 */
class TTSService {
  constructor() {
    this.ttsProvider = process.env.NODE_ENV === 'test' ? 'test' : 'google';
    this._client = null; // singleton — created once on first real request
    if (this.ttsProvider !== 'test') {
      this.initializeProvider();
    } else {
      logger.info('TTS Service initialized in test mode');
    }
  }

  initializeProvider() {
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    // On Cloud Run the attached service account provides ADC — no key file needed.
    // On VPS the key file is required.
    this._client = keyFile
      ? new TextToSpeechClient({ keyFilename: keyFile })
      : new TextToSpeechClient();
    logger.info('TTS Service initialized with provider: google', { usingKeyFile: !!keyFile });
  }

  _getClient() {
    if (!this._client) {
      const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      this._client = keyFile
        ? new TextToSpeechClient({ keyFilename: keyFile })
        : new TextToSpeechClient();
    }
    return this._client;
  }

  /**
   * Synthesize text to speech
   * @param {Object} options - Synthesis options
   * @param {string} options.text - Text to synthesize
   * @param {string} options.language - BCP-47 language code
   * @param {string} options.voice - Voice identifier
   * @param {string} options.audioFormat - Output format (mp3, wav, ogg)
   * @param {number} options.speakingRate - Speech rate (0.5-2.0)
   * @param {number} options.pitch - Voice pitch (-20.0 to 20.0)
   * @returns {Promise<Object>} Audio data and metadata
   */
  async synthesize(options) {
    let { text, language = 'en-US', voice, audioFormat = 'mp3', speakingRate = 1.0, pitch = 0 } = options;
    // Guard: if text is an object (e.g. chat response object), extract its .text field
    if (text !== null && text !== undefined && typeof text !== 'string') {
      text = text.text || text.response || JSON.stringify(text);
    }

    // Resolve voice: map Azure name → Google, or use default for language
    const resolvedVoice = AZURE_TO_GOOGLE_VOICE[voice] || DEFAULT_VOICE[language] || 'en-US-Wavenet-F';

    // Map audio format to Google encoding
    let audioEncoding, contentType;
    if (audioFormat === 'mp3') {
      audioEncoding = 'MP3';      contentType = 'audio/mpeg';
    } else if (audioFormat === 'wav') {
      audioEncoding = 'LINEAR16'; contentType = 'audio/wav';
    } else if (audioFormat === 'ogg') {
      audioEncoding = 'OGG_OPUS'; contentType = 'audio/ogg';
    } else {
      audioEncoding = 'MP3';      contentType = 'audio/mpeg';
    }

    if (!text) {
      throw new AppError('INVALID_REQUEST', 'Text is required for TTS synthesis', 400);
    }
    const ssml = this.buildSSML(text, language, resolvedVoice, speakingRate, pitch);
    logger.info('Generated SSML for Google TTS', { ssml });
    if (!ssml || ssml.trim().length === 0 || ssml.includes('<speak></speak>')) {
      logger.error('SSML is empty or invalid', { ssml });
      throw new AppError('INVALID_REQUEST', 'SSML is empty or invalid', 400);
    }

    // Short-circuit in test mode to avoid external GCP dependency
    if (process.env.NODE_ENV === 'test') {
      const dummy = Buffer.from('TEST-PCM-AUDIO');
      return {
        audioData: dummy,
        audioFormat,
        contentType,
        provider: 'test',
        language,
        voice: resolvedVoice,
        duration: this.estimateDuration(text),
      };
    }

    try {
      logger.info('Synthesizing speech with Google TTS', { textLength: text.length, language, voice: resolvedVoice });
      const [response] = await this._getClient().synthesizeSpeech({
        input: { ssml },
        voice: { languageCode: language, name: resolvedVoice },
        audioConfig: { audioEncoding, speakingRate, pitch },
      });
      return {
        audioData: Buffer.from(response.audioContent),
        audioFormat,
        contentType,
        provider: 'google',
        language,
        voice: resolvedVoice,
      };
    } catch (error) {
      logger.error('TTS synthesis error', { error: error.message });
      throw new AppError('PROVIDER_ERROR', `TTS provider error: ${error.message}`, 503);
    }
  }
  /**
   * Convert text to SSML for prosody control
   */
  buildSSML(text, _language = 'de-DE', _voice = null, speakingRate = 1.0, pitch = 0) {
    const pitchStr = pitch >= 0 ? `+${pitch}%` : `${pitch}%`;
    const rateStr = `${Math.round(speakingRate * 100)}%`;
    // Google TTS: voice is specified in the API request; use plain <speak> + <prosody>
    return `<speak><prosody rate="${rateStr}" pitch="${pitchStr}">${this.escapeSSML(text)}</prosody></speak>`;
  }

  /**
   * Escape special characters for SSML.
   *
   * Preserves all Unicode letters and numbers (including German umlauts, French
   * accents, Cyrillic, etc.) so multilingual TTS works correctly.
   */
  escapeSSML(text) {
    return text
      .replace(/<[^>]+>/g, '')       // strip HTML tags
      .replace(/\n/g, '. ')           // line breaks → pause
      .replace(/\t/g, ' ')            // tabs → space
      .replace(/\p{Emoji_Presentation}/gu, '') // strip visual emoji only — \p{Emoji} would also match digits 0-9
      .replace(/&/g, '&amp;')         // must be first of the XML escapes
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Estimate audio duration in seconds based on text length
   * Rough estimation: 150 words per minute = 2.5 words per second
   */
  estimateDuration(text) {
    const wordCount = text.trim().split(/\s+/).length;
    const wordsPerSecond = 2.5;
    return Math.ceil((wordCount / wordsPerSecond) * 10) / 10;
  }
}

export default TTSService;
