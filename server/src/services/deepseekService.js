// deepseekService.js — #145
// DeepSeek-V3.1 backend for business mode, accessed via Vertex AI Model Garden.
// Uses the Vertex AI OpenAI-compatible endpoint — no separate DeepSeek account or
// API key needed. Auth reuses the same GCP service account already configured for
// Gemini (GOOGLE_APPLICATION_CREDENTIALS / Application Default Credentials).
//
// Endpoint:
//   https://{REGION}-aiplatform.googleapis.com/v1beta1/projects/{PROJECT}/
//     locations/{REGION}/endpoints/openapi/chat/completions
//
// PLACEHOLDER: Set DEEPSEEK_MODEL in .env to the Vertex AI Model Garden model ID
// (e.g. deepseek-ai/deepseek-v3). Until the model is deployed / enabled in your
// GCP project the service falls back to Gemini automatically.

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { VertexAI } from '@google-cloud/vertexai';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const REQUEST_TIMEOUT_MS = 30_000;

class DeepSeekService {
  constructor() {
    this.project  = process.env.GOOGLE_CLOUD_PROJECT;
    this.location = process.env.VERTEX_AI_LOCATION || 'us-central1';
    // Vertex AI Model Garden model ID for DeepSeek-V3.
    // PLACEHOLDER — set DEEPSEEK_MODEL in .env once the model is enabled in your project.
    this.model    = process.env.DEEPSEEK_MODEL || null;

    if (process.env.NODE_ENV === 'test') {
      logger.info('DeepSeekService initialized in test mode');
      return;
    }

    if (!this.model) {
      // Model not yet configured — ChatService will fall back to Gemini.
      logger.warn('DeepSeekService: DEEPSEEK_MODEL not set — business mode will fall back to Gemini');
    } else if (!this.project) {
      logger.warn('DeepSeekService: GOOGLE_CLOUD_PROJECT not set — business mode will fall back to Gemini');
    } else {
      // Build the Vertex AI OpenAI-compatible base URL.
      this.endpointUrl = `https://${this.location}-aiplatform.googleapis.com/v1beta1` +
        `/projects/${this.project}/locations/${this.location}/endpoints/openapi/chat/completions`;

      // Reuse the VertexAI client solely to obtain a GCP access token.
      this._vertexAI = new VertexAI({ project: this.project, location: this.location });

      logger.info('DeepSeekService initialized via Vertex AI', {
        project: this.project,
        location: this.location,
        model: this.model,
      });
    }
  }

  get isConfigured() {
    return Boolean(this.model && this.project && this.endpointUrl);
  }

  /**
   * Obtain a short-lived GCP Bearer token via Application Default Credentials.
   * @private
   */
  async _getAccessToken() {
    // GoogleAuth is available as a transitive dep of @google-cloud/vertexai.
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return auth.getAccessToken();
  }

  /**
   * Chat completion via Vertex AI OpenAI-compatible endpoint.
   *
   * @param {Array}   messages  - OpenAI-style messages array (role + content)
   * @param {string}  language  - BCP-47 code (passed for context; not used in REST call)
   * @param {boolean} isPremium - Must be true — business mode is premium-only
   * @returns {Promise<{ content: string, usage: object }>}
   */
  async chat(messages, language, isPremium) {
    if (!this.isConfigured) {
      throw new AppError('PROVIDER_ERROR', 'DeepSeek (Vertex AI) not configured', 503);
    }
    if (!isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Business mode requires a premium subscription', 403);
    }

    const token = await this._getAccessToken();

    const body = {
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error('Vertex AI DeepSeek error', { status: response.status, body: errorText.substring(0, 200) });
        throw new AppError('PROVIDER_ERROR', `Vertex AI DeepSeek returned ${response.status}`, 503);
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      if (!choice) {
        throw new AppError('PROVIDER_ERROR', 'Vertex AI DeepSeek returned no choices', 503);
      }

      return {
        content: choice.message?.content ?? '',
        usage: data.usage ?? {},
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new AppError('PROVIDER_ERROR', 'Vertex AI DeepSeek request timed out', 503);
      }
      if (err instanceof AppError) throw err;
      logger.error('Vertex AI DeepSeek fetch error', { error: err.message });
      throw new AppError('PROVIDER_ERROR', 'Vertex AI DeepSeek request failed', 503);
    }
  }
}

export default DeepSeekService;
