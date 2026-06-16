import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Global error handler middleware
 */
export default function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let errorCode = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let details = err.details || {};

  // Handle multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    errorCode = 'AUDIO_TOO_LARGE';
    message = `Audio file too large. Maximum size: ${process.env.MAX_AUDIO_SIZE_MB || 10}MB`;
  }

  // Handle multer file type errors
  if (err.message && err.message.includes('Unsupported audio format')) {
    statusCode = 400;
    errorCode = 'INVALID_AUDIO_FORMAT';
  }

  // Log error
  logger.error('Request error', {
    requestId: req.id,
    method: req.method,
    path: req.path,
    statusCode,
    errorCode,
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Send error response
  res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
      details: Object.keys(details).length > 0 ? details : undefined,
      requestId: req.id,
    },
  });
}
