import express from 'express';
import rateLimit from 'express-rate-limit';
import TTSService from '../services/ttsService.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { metricsCollector } from '../utils/metrics.js';
import { SUPPORTED_LANGUAGES } from '../config/supportedLanguages.js';

const router = express.Router();

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_TTS || 100),
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('tts');
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        requestId: req.id,
      },
    });
  },
});

// Initialize TTS service
const ttsService = new TTSService();
/**
 * POST /tts
 * Convert text to speech
 */
router.post('/', limiter, async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    // Validate request
    const {
      text,
      language = 'en-US',
      voice = 'default',
      audioFormat = 'mp3',
      speakingRate = 1.0,
      pitch = 0,
    } = req.body;

    if (!text) {
      throw new AppError('INVALID_REQUEST', 'Text is required', 400);
    }

    if (text.length > 1000) {
      throw new AppError('TEXT_TOO_LONG', 'Text exceeds maximum length of 1000 characters', 400);
    }

    if (!['mp3', 'wav', 'ogg'].includes(audioFormat)) {
      throw new AppError('INVALID_REQUEST', 'Unsupported audio format. Use mp3, wav, or ogg.', 400);
    }

    if (language && !SUPPORTED_LANGUAGES.includes(language)) {
      throw new AppError('UNSUPPORTED_LANGUAGE', `Unsupported language code. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`, 400);
    }

    logger.info('TTS request received', {
      requestId: req.id,
      textLength: text.length,
      language,
      voice,
      audioFormat,
    });

    // Validate voice format
    const DEFAULT_VOICES = {
      'en-US': 'en-US-AriaNeural',
      'de-DE': 'de-DE-AmalaNeural',
      'fr-FR': 'fr-FR-DeniseNeural',
      'es-ES': 'es-ES-ElviraNeural',
      'it-IT': 'it-IT-ElsaNeural',
      'tr-TR': 'tr-TR-EmelNeural',
      'pl-PL': 'pl-PL-AgnieszkaNeural',
      'zh-CN': 'zh-CN-XiaoxiaoNeural',
      'ko-KR': 'ko-KR-SunHiNeural',
      'ja-JP': 'ja-JP-NanamiNeural',
      'vi-VN': 'vi-VN-HoaiMyNeural',
      'ru-RU': 'ru-RU-SvetlanaNeural',
    };
    let azureVoice = voice;
    if (voice === 'default') {
      azureVoice = DEFAULT_VOICES[language] || 'de-DE-AmalaNeural';
    }

    // Synthesize speech
    // TTS_SPEAKING_RATE env var overrides client-supplied rate (e.g. set to 1.0 to override client's 0.85)
    const effectiveSpeakingRate = process.env.TTS_SPEAKING_RATE
      ? parseFloat(process.env.TTS_SPEAKING_RATE)
      : speakingRate;
    const result = await ttsService.synthesize({
      text,
      language,
      voice: azureVoice,
      audioFormat,
      speakingRate: effectiveSpeakingRate,
      pitch,
    });

    const processingTimeMs = Date.now() - startTime;

    // Record metrics
    metricsCollector.recordLatency('tts', processingTimeMs);
    metricsCollector.recordRequest('tts', 200);

    // Set response headers
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', 'inline; filename="audio.mp3"');
    res.setHeader('X-Processing-Time-Ms', processingTimeMs);
    if (result.duration !== undefined) {
      res.setHeader('X-Audio-Duration', result.duration);
    }

    // Send audio data
    res.send(result.audioData);

    logger.info('TTS request completed', {
      requestId: req.id,
      processingTimeMs,
      provider: result.provider,
      audioSize: result.audioData.length,
    });

  } catch (error) {
    metricsCollector.recordError('tts', error.code || 'UNKNOWN');
    next(error);
  }
});

export default router;
