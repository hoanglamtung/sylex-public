/**
 * DocumentService — #143 (sub-task of #119)
 *
 * Parses uploaded PDF or TXT files for AI question-answering via Gemini.
 * Files are processed entirely in-memory — nothing is persisted server-side.
 *
 * Constraints:
 *   - File types: PDF, TXT only
 *   - Max file size: 5MB (enforced by multer in the route)
 *   - Max tokens sent to Gemini: 5000 (~4 chars/token estimate)
 *   - Premium only
 */

import { createRequire } from 'module';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import GeminiService from './geminiService.js';

const require = createRequire(import.meta.url);

// Rough token estimate: 1 token ≈ 4 characters
const CHARS_PER_TOKEN = 4;
const MAX_TOKENS      = 5000;
const MAX_CHARS       = MAX_TOKENS * CHARS_PER_TOKEN;

class DocumentService {
  constructor() {
    this.geminiService = process.env.NODE_ENV === 'test' ? null : new GeminiService();
  }

  // ─── Extract text ─────────────────────────────────────────────────────────

  /**
   * Extract plain text from a file buffer.
   * @param {Buffer} buffer
   * @param {string} mimeType  — 'application/pdf' | 'text/plain'
   * @returns {string} extracted text
   */
  async extractText(buffer, mimeType) {
    if (mimeType === 'text/plain' || mimeType === 'text/txt') {
      return buffer.toString('utf-8');
    }

    if (mimeType === 'application/pdf') {
      let pdfParse;
      try {
        pdfParse = require('pdf-parse');
      } catch {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'PDF parsing is not available. Install pdf-parse: npm install pdf-parse',
          503,
        );
      }
      try {
        const result = await pdfParse(buffer);
        return result.text;
      } catch (err) {
        logger.error('PDF parse error', { error: err.message });
        throw new AppError('PARSE_ERROR', 'Could not extract text from the PDF. The file may be scanned or corrupted.', 422);
      }
    }

    throw new AppError('INVALID_REQUEST', 'Unsupported file type. Only PDF and TXT files are accepted.', 400);
  }

  // ─── Trim to token budget ─────────────────────────────────────────────────

  trimToTokenBudget(text) {
    if (text.length <= MAX_CHARS) {
      return { text, truncated: false, estimatedTokens: Math.ceil(text.length / CHARS_PER_TOKEN) };
    }
    return {
      text: text.slice(0, MAX_CHARS),
      truncated: true,
      estimatedTokens: MAX_TOKENS,
    };
  }

  // ─── Analyse ──────────────────────────────────────────────────────────────

  /**
   * Analyse a document against a user question via Gemini (premium only).
   *
   * @param {string}  uid
   * @param {Buffer}  fileBuffer
   * @param {string}  mimeType
   * @param {string}  originalName
   * @param {string}  question
   * @param {boolean} isPremium
   * @returns {{ answer, documentTitle, tokenCount, truncated }}
   */
  async analyse(uid, fileBuffer, mimeType, originalName, question, isPremium) {
    if (!isPremium) {
      throw new AppError('PREMIUM_REQUIRED', 'Document analysis requires a premium subscription.', 403);
    }
    if (!question || question.trim().length === 0) {
      throw new AppError('INVALID_REQUEST', 'A question is required.', 400);
    }
    if (question.length > 500) {
      throw new AppError('INVALID_REQUEST', 'Question must be 500 characters or fewer.', 400);
    }

    const rawText = await this.extractText(fileBuffer, mimeType);
    const { text: contextText, truncated, estimatedTokens } = this.trimToTokenBudget(rawText);

    logger.info('Document analysis started', {
      uid,
      mimeType,
      originalName,
      rawChars: rawText.length,
      estimatedTokens,
      truncated,
    });

    // Test mode short-circuit
    if (process.env.NODE_ENV === 'test' || !this.geminiService) {
      return {
        answer: `[test] Answer to "${question}" based on document "${originalName}".`,
        documentTitle: originalName,
        tokenCount: estimatedTokens,
        truncated,
      };
    }

    const systemPrompt = `You are a helpful assistant that answers questions about documents.
You have been given the text content of a document. Answer the user's question based solely on the document content.
If the answer is not found in the document, say so clearly.
${truncated ? 'Note: The document was truncated due to length limits. Your answer covers the first portion of the document.' : ''}

Document title: ${originalName}
Document content:
---
${contextText}
---`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: question.trim() },
    ];

    const response = await this.geminiService.chat(messages, isPremium);

    return {
      answer: response.content,
      documentTitle: originalName,
      tokenCount: estimatedTokens,
      truncated,
    };
  }
}

export default DocumentService;
