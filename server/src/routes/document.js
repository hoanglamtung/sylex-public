/**
 * Document routes — #143 (sub-task of #119)
 *
 * POST /v1/document/analyze — upload PDF/TXT + question → AI answer (premium only)
 *
 * Accepts multipart/form-data:
 *   file     — PDF or TXT, max 5MB
 *   question — string, max 500 chars
 *
 * Returns: { answer, documentTitle, tokenCount, truncated }
 * Files are never persisted — processed in-memory only.
 */

import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import DocumentService from '../services/documentService.js';
import authMiddleware from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { metricsCollector } from '../utils/metrics.js';

const router = express.Router();
const documentService = new DocumentService();

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_DOCUMENT_SIZE_MB || 5);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain', 'text/txt'];
    // Also accept by extension when mime is generic
    const ext = file.originalname?.split('.').pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ext === 'pdf' || ext === 'txt') {
      cb(null, true);
    } else {
      cb(new AppError('INVALID_REQUEST', 'Only PDF and TXT files are supported.', 400));
    }
  },
});

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_DOCUMENT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    metricsCollector.recordRateLimitExceeded('document');
    res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.', requestId: req.id } });
  },
});

// POST /v1/document/analyze
router.post('/analyze', limiter, authMiddleware, upload.single('file'), async (req, res, next) => {
  const startTime = Date.now();
  try {
    if (!req.file) {
      throw new AppError('INVALID_REQUEST', 'A file is required (field name: file).', 400);
    }

    const { question } = req.body;

    // Resolve mime type — fall back to extension-based detection
    let mimeType = req.file.mimetype;
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = req.file.originalname?.split('.').pop()?.toLowerCase();
      mimeType = ext === 'pdf' ? 'application/pdf' : 'text/plain';
    }

    logger.info('Document analysis request', {
      uid: req.user.uid,
      requestId: req.id,
      filename: req.file.originalname,
      size: req.file.size,
      mimeType,
    });

    const result = await documentService.analyse(
      req.user.uid,
      req.file.buffer,
      mimeType,
      req.file.originalname,
      question,
      req.user.isPremium ?? false,
    );

    const processingTimeMs = Date.now() - startTime;
    metricsCollector.recordLatency('document', processingTimeMs);
    metricsCollector.recordRequest('document', 200);

    res.json({ ...result, processingTimeMs });
  } catch (err) {
    metricsCollector.recordError('document', err.code || 'UNKNOWN');
    next(err);
  }
});

export default router;
