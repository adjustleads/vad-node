import * as fs from 'fs/promises'
import { Silero } from './models'
import {
  defaultFrameProcessorOptions,
  FrameProcessor,
  validateOptions,
  type FrameProcessorOptions,
} from './frame-processor'
import { Message } from './messages'
import { Resampler } from './resampler'

/**
 * Represents a segment of speech detected by the VAD
 */
export interface SpeechSegment {
  /** Audio samples containing the detected speech */
  audio: Float32Array
  /** Start time of the speech segment in milliseconds */
  start: number
  /** End time of the speech segment in milliseconds */
  end: number
}

/**
 * Configuration options for the VAD
 */
export interface VADOptions extends FrameProcessorOptions {
  /** Path to the ONNX model file (defaults to 'silero_vad.onnx' in the current working directory) */
  modelPath?: string
}

/**
 * Default configuration values for VAD
 */
export const defaultVADOptions: VADOptions = {
  ...defaultFrameProcessorOptions,
  modelPath: `${process.cwd()}/silero_vad.onnx`,
}

/**
 * Voice Activity Detection (VAD) implementation
 * Processes audio files to detect speech segments
 */
export class VAD {
  private frameProcessor: FrameProcessor | undefined
  private options: VADOptions

  /**
   * Creates a new VAD instance
   * @param options Configuration options
   */
  private constructor(options: VADOptions) {
    this.options = options
    validateOptions(options)
  }

  /**
   * Create and initialize a new VAD instance
   * @param options Configuration options
   * @returns Initialized VAD instance
   */
  static async create(options: Partial<VADOptions> = {}): Promise<VAD> {
    // Merge default options with provided options
    const fullOptions = {
      ...defaultVADOptions,
      ...options,
    }

    const vad = new VAD(fullOptions)
    await vad.init()
    return vad
  }

  /**
   * Initialize the VAD by loading the model and setting up the frame processor
   */
  private async init(): Promise<void> {
    try {
      // Load the ONNX model from file
      console.log(`Loading model from ${this.options.modelPath}`)
      const modelBuffer = await fs.readFile(this.options.modelPath as string)

      // Create and initialize the Silero model
      const buffer = new Uint8Array(modelBuffer).buffer
      const model = await Silero.create(buffer)

      // Create the frame processor
      this.frameProcessor = new FrameProcessor(model.process, model.reset_state, {
        frameSamples: this.options.frameSamples,
        positiveSpeechThreshold: this.options.positiveSpeechThreshold,
        negativeSpeechThreshold: this.options.negativeSpeechThreshold,
        redemptionFrames: this.options.redemptionFrames,
        preSpeechPadFrames: this.options.preSpeechPadFrames,
        minSpeechFrames: this.options.minSpeechFrames,
        submitUserSpeechOnPause: this.options.submitUserSpeechOnPause,
      })

      this.frameProcessor.resume()
    } catch (error) {
      console.error('Failed to initialize VAD:', error)
      throw error
    }
  }

  /**
   * Process audio data to detect speech segments
   * @param inputAudio Audio data as Float32Array
   * @param sampleRate Sample rate of the input audio in Hz
   * @returns AsyncGenerator yielding speech segments
   */
  async *run(inputAudio: Float32Array, sampleRate: number): AsyncGenerator<SpeechSegment> {
    if (!this.frameProcessor) {
      throw new Error('VAD not initialized. Wait for the create() method to complete.')
    }

    // Configure resampler to convert input audio to 16kHz (required by Silero VAD)
    const resamplerOptions = {
      nativeSampleRate: sampleRate,
      targetSampleRate: 16000, // Target for Silero VAD
      targetFrameSize: this.options.frameSamples,
    }

    const resampler = new Resampler(resamplerOptions)
    let start = 0
    let end = 0
    let frameIndex = 0

    // Process audio frames through resampler and frame processor
    for await (const frame of resampler.stream(inputAudio)) {
      const { msg, audio } = await this.frameProcessor.process(frame)

      switch (msg) {
        case Message.SpeechStart:
          // Calculate time in milliseconds based on frames processed so far at 16kHz
          start = (frameIndex * this.options.frameSamples) / 16
          break

        case Message.SpeechEnd:
          // Calculate end time in milliseconds
          end = ((frameIndex + 1) * this.options.frameSamples) / 16

          // Yield the detected speech segment
          if (audio) {
            yield { audio, start, end }
          }
          break
      }

      frameIndex++
    }

    // Check for any remaining audio segment after processing
    const { msg, audio } = this.frameProcessor.endSegment()

    if (msg === Message.SpeechEnd && audio && audio.length > 0) {
      // Calculate end time for the final segment
      end = (frameIndex * this.options.frameSamples) / 16

      yield {
        audio,
        start,
        end,
      }
    }
  }
}
