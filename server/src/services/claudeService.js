// claudeService.js — #148
// Claude Haiku backend for kids mode, accessed via Vertex AI Anthropic partner models.
// Uses the Vertex AI Anthropic Messages API endpoint — same GCP service account as Gemini,
// no separate Anthropic API key needed.
//
// Vertex AI Anthropic endpoint:
//   https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/
//     publishers/anthropic/models/{MODEL}:rawPredict
//
// PLACEHOLDER: Set ANTHROPIC_MODEL in .env once the model is enabled in your GCP project.
// Until configured, kids mode falls back to Gemini automatically.

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
const MAX_TOKENS = 1024; // Kids responses should be concise

class ClaudeService {
  constructor() {
    this.project  = process.env.GOOGLE_CLOUD_PROJECT;
    this.location = process.env.VERTEX_AI_LOCATION || 'us-central1';
    // PLACEHOLDER — set ANTHROPIC_MODEL in .env once enabled in Vertex AI Model Garden.
    // Example value: claude-haiku-4-5
    this.model    = process.env.ANTHROPIC_MODEL || null;

    if (process.env.NODE_ENV === 'test') {
      logger.info('ClaudeService initialized in test mode');
      return;
    }

    if (!this.model) {
      logger.warn('ClaudeService: ANTHROPIC_MODEL not set — kids mode will fall back to Gemini');
    } else if (!this.project) {
      logger.warn('ClaudeService: GOOGLE_CLOUD_PROJECT not set — kids mode will fall back to Gemini');
    } else {
      // Vertex AI Anthropic rawPredict endpoint
      this.endpointUrl = `https://${this.location}-aiplatform.googleapis.com/v1` +
        `/projects/${this.project}/locations/${this.location}` +
        `/publishers/anthropic/models/${this.model}:rawPredict`;

      this._vertexAI = new VertexAI({ project: this.project, location: this.location });

      logger.info('ClaudeService initialized via Vertex AI', {
        project: this.project,
        location: this.location,
        model: this.model,
      });
    }
  }

  get isConfigured() {
    return Boolean(this.model && this.project && this.endpointUrl);
  }

  /** @private */
  async _getAccessToken() {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return auth.getAccessToken();
  }

  /**
   * Convert OpenAI-style messages to Anthropic Messages API format.
   * @private
   */
  _convertMessages(messages) {
    let systemPrompt = '';
    const anthropicMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
      } else if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        anthropicMessages.push({ role: 'assistant', content: msg.content });
      }
    }

    return { systemPrompt, anthropicMessages };
  }

  /**
   * Chat completion via Vertex AI Anthropic endpoint.
   *
   * @param {Array}   messages  - OpenAI-style messages array (role + content)
   * @param {string}  language  - BCP-47 code
   * @param {boolean} isPremium - Not required for kids mode (parental subscription model)
   * @returns {Promise<{ content: string, usage: object }>}
   */
  async chat(messages, language, isPremium) {
    if (!this.isConfigured) {
      throw new AppError('PROVIDER_ERROR', 'Claude (Vertex AI) not configured', 503);
    }

    const token = await this._getAccessToken();
    const { systemPrompt, anthropicMessages } = this._convertMessages(messages);

    const body = {
      anthropic_version: 'vertex-2023-10-16',
      messages: anthropicMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.5, // Lower temp for more deterministic, safe kids responses
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

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
        logger.error('Vertex AI Claude error', { status: response.status, body: errorText.substring(0, 200) });
        throw new AppError('PROVIDER_ERROR', `Vertex AI Claude returned ${response.status}`, 503);
      }

      const data = await response.json();
      const block = data.content?.[0];

      if (!block) {
        throw new AppError('PROVIDER_ERROR', 'Vertex AI Claude returned no content', 503);
      }

      return {
        content: block.text ?? '',
        usage: data.usage ?? {},
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new AppError('PROVIDER_ERROR', 'Vertex AI Claude request timed out', 503);
      }
      if (err instanceof AppError) throw err;
      logger.error('Vertex AI Claude fetch error', { error: err.message });
      throw new AppError('PROVIDER_ERROR', 'Vertex AI Claude request failed', 503);
    }
  }
}

export default ClaudeService;
