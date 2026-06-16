/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(code, message, statusCode = 500, details = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error codes enum
 */
export const ErrorCodes = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_AUDIO_FORMAT: 'INVALID_AUDIO_FORMAT',
  AUDIO_TOO_LARGE: 'AUDIO_TOO_LARGE',
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};
