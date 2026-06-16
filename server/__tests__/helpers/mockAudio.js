/**
 * Mock audio data generators for testing
 */

import { Buffer } from 'buffer';

/**
 * Generate mock WAV audio buffer
 * @param {number} durationMs - Duration in milliseconds
 * @returns {Buffer} Mock WAV audio buffer
 */
export function generateMockWavBuffer(durationMs = 1000) {
  // Minimal WAV header (44 bytes) + some audio data
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = Math.floor((sampleRate * durationMs) / 1000) * numChannels * (bitsPerSample / 8);
  const fileSize = 36 + dataSize;

  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // byte rate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Fill with sine wave data (simple audio)
  for (let i = 0; i < dataSize / 2; i++) {
    const value = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 32767;
    buffer.writeInt16LE(Math.round(value), 44 + i * 2);
  }

  return buffer;
}

/**
 * Generate mock MP3 audio buffer
 * @returns {Buffer} Mock MP3 audio buffer
 */
export function generateMockMp3Buffer() {
  // Minimal MP3 frame (just enough to pass basic validation)
  const buffer = Buffer.alloc(256);
  
  // MP3 frame sync word (11 bits set)
  buffer[0] = 0xff;
  buffer[1] = 0xfb;
  
  // Fill rest with zeros (simplified)
  buffer.fill(0, 2);

  return buffer;
}

/**
 * Generate invalid audio buffer
 * @returns {Buffer} Invalid audio data
 */
export function generateInvalidAudioBuffer() {
  return Buffer.from('This is not audio data');
}

/**
 * Generate large audio buffer (for size limit testing)
 * @param {number} sizeMB - Size in megabytes
 * @returns {Buffer} Large buffer
 */
export function generateLargeBuffer(sizeMB) {
  return Buffer.alloc(sizeMB * 1024 * 1024);
}
