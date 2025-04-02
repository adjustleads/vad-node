/**
 * Voice Activity Detection (VAD) for Node.js
 *
 * This package provides Voice Activity Detection implementation
 * based on the Silero VAD model for identifying speech segments in audio files.
 */

// Core VAD functionality
export { VAD, type VADOptions, type SpeechSegment } from './vad'
export { Message } from './messages'
export { type FrameProcessorOptions } from './frame-processor'

// MP3 processing functionality
export { processMP3File, decodeMP3, saveWavFile, checkLameInstallation, type ProcessMP3Options } from './mp3'
