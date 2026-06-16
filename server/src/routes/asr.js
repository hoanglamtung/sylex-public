import express from 'express';
import multer from 'multer';
import { extname } from 'path';
import rateLimit from 'express-rate-limit';
import AsrService from '../services/asrService.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { metricsCollector } from '../utils/metrics.js';
import { SUPPORTED_LANGUAGES } from '../config/supportedLanguages.js';

const router = express.Router();

// Configure multer for audio upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (process.env.MAX_AUDIO_SIZE_MB || 10) * 1024 * 1024, // Default 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'audio/wav',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/flac',
      'audio/ogg',
      'audio/webm',
    ];
    
    // Accept by mimetype or by file extension when mimetype is missing (test environment)
    const fileExt = extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.wav', '.mp3', '.flac', '.ogg', '.webm'];
    if (allowedMimeTypes.includes(file.mimetype) || allowedExts.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new AppError('INVALID_AUDIO_FORMAT', 
        'Unsupported audio format. Supported formats: WAV, MP3, FLAC, OGG', 400));
    }
  },
});

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_ASR || 100),
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('asr');
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        requestId: req.id,
      },
    });
  },
});

// Initialize ASR service
const asrService = new AsrService();

/**
 * POST /asr
 * Convert speech to text
 */
router.post('/', limiter, upload.single('audio'), async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    // Validate audio file
    if (!req.file) {
      throw new AppError('INVALID_REQUEST', 'Audio file is required', 400);
    }

    // Extract parameters
    const {
      language = 'en-US',
      enableProfanityFilter = true,
      enableAutomaticPunctuation = true,
      model = 'default',
    } = req.body;

    if (language && !SUPPORTED_LANGUAGES.includes(language)) {
      throw new AppError('UNSUPPORTED_LANGUAGE', `Unsupported language code. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`, 400);
    }

    logger.info('ASR request received', {
      requestId: req.id,
      language,
      audioSize: req.file.size,
      mimeType: req.file.mimetype,
      model,
    });

    // Process audio
    const result = await asrService.transcribe({
      audio: req.file.buffer,
      mimeType: req.file.mimetype,
      language,
      enableProfanityFilter: enableProfanityFilter === 'true' || enableProfanityFilter === true,
      enableAutomaticPunctuation: enableAutomaticPunctuation === 'true' || enableAutomaticPunctuation === true,
      model,
    });

    const processingTimeMs = Math.max(1, Date.now() - startTime);

    // If Azure returned no speech, treat it as a recognizable error so the
    // client shows a "couldn't hear you" state instead of calling chat with
    // a fallback placeholder like "Start voice interaction".
    if (!result.transcript) {
      metricsCollector.recordError('asr', 'NO_SPEECH_DETECTED');
      return next(new AppError('NO_SPEECH_DETECTED', 'No speech detected. Please try again.', 422));
    }

    // Record metrics
    metricsCollector.recordLatency('asr', processingTimeMs);
    metricsCollector.recordRequest('asr', 200);

    // Set response headers
    res.setHeader('X-Processing-Time-Ms', processingTimeMs);

    // Send response
    res.json({
      requestId: req.id,
      transcript: result.transcript,
      confidence: result.confidence,
      language: result.language || language,
      alternatives: result.alternatives || [],
      processingTimeMs,
    });

    logger.info('ASR request completed', {
      requestId: req.id,
      processingTimeMs,
      transcriptLength: result.transcript.length,
      confidence: result.confidence,
    });

  } catch (error) {
    metricsCollector.recordError('asr', error.code || 'UNKNOWN');
    next(error);
  }
});

/**
 * POST /asr/stream
 * WebSocket endpoint for streaming ASR
 * Note: This is a placeholder. WebSocket implementation requires express-ws or socket.io
 */
router.post('/stream', limiter, (req, res) => {
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Streaming ASR not yet implemented. Use POST /asr for file-based transcription.',
      requestId: req.id,
    },
  });
});

export default router;
