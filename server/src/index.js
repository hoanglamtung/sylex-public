import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import logger from './utils/logger.js';
import errorHandler from './middleware/errorHandler.js';
import asrRoutes from './routes/asr.js';
import chatRoutes from './routes/chat.js';
import ttsRoutes from './routes/tts.js';
import healthRoutes from './routes/health.js';
import metricsRoutes from './routes/metrics.js';
import premiumRoutes from './routes/premium.js';
import subscriptionRoutes from './routes/subscription.js';
import routinesRoutes from './routes/routines.js';
import remindersRoutes from './routes/reminders.js';
import documentRoutes from './routes/document.js';
import voiceRoutes from './routes/voice.js';
import emailRoutes from './routes/email.js';
import meetingRoutes from './routes/meeting.js';
import parentalControlsRoutes from './routes/parentalControls.js';
import navigationRoutes from './routes/navigation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from the server directory
dotenv.config({ path: join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

// Trust the reverse proxy (nginx) so express-rate-limit reads the real client IP
// from X-Forwarded-For instead of the loopback address.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Body parsing
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
});
app.use(express.json({ limit: '1mb' }));
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason: reason instanceof Error ? reason.message : reason, stack: reason instanceof Error ? reason.stack : undefined });
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Invalid JSON handler (must be before routes)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Invalid JSON payload',
        requestId: req.id || (req.headers['x-request-id'] || 'unknown'),
      },
    });
  } else {
    next(err);
  }
});

// Request ID middleware
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// API Routes
app.use(`/${API_VERSION}/health`, healthRoutes);
app.use(`/${API_VERSION}/asr`, asrRoutes);
app.use(`/${API_VERSION}/chat`, chatRoutes);
app.use(`/${API_VERSION}/tts`, ttsRoutes);
app.use(`/${API_VERSION}/metrics`, metricsRoutes);
app.use(`/${API_VERSION}/premium`, premiumRoutes);
app.use(`/${API_VERSION}/subscription`, subscriptionRoutes);
app.use(`/${API_VERSION}/routines`, routinesRoutes);
app.use(`/${API_VERSION}/reminders`, remindersRoutes);
app.use(`/${API_VERSION}/document`, documentRoutes);
app.use(`/${API_VERSION}/voice`, voiceRoutes);
app.use(`/${API_VERSION}/email`, emailRoutes);
app.use(`/${API_VERSION}/meeting`, meetingRoutes);
app.use(`/${API_VERSION}/parental-controls`, parentalControlsRoutes);
app.use(`/${API_VERSION}/navigation`, navigationRoutes);


// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Assistant Pro API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: `/${API_VERSION}/health`,
      asr: `/${API_VERSION}/asr`,
      chat: `/${API_VERSION}/chat`,
      tts: `/${API_VERSION}/tts`,
      metrics: `/${API_VERSION}/metrics`,
      openapi: '/openapi.yaml',
    },
  });
});

// Serve OpenAPI spec
app.get('/openapi.yaml', (req, res) => {
  res.sendFile(join(__dirname, '../openapi.yaml'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
      requestId: req.id,
    },
  });
});

// Error handling
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  logger.info(`🚀 Car Assistant Pro API server running on port ${PORT}`);
  logger.info(`📚 API version: ${API_VERSION}`);
  logger.info(`📖 OpenAPI spec available at: http://localhost:${PORT}/openapi.yaml`);
  logger.info(`🏥 Health check: http://localhost:${PORT}/${API_VERSION}/health`);
  logger.info(`📊 Metrics: http://localhost:${PORT}/${API_VERSION}/metrics`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;
