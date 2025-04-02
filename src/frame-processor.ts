/**
 * Frame processor for Voice Activity Detection (VAD)
 *
 * Some of this code, together with the default options, is based on the
 * implementation approach from https://github.com/snakers4/silero-vad
 */

import type { SpeechProbabilities } from './models'
import { Message } from './messages'

/** Recommended frame sizes for optimal model performance */
const RECOMMENDED_FRAME_SAMPLES = [512, 1024, 1536]

/**
 * Configuration options for the frame processor
 */
export interface FrameProcessorOptions {
  /**
   * Threshold over which values returned by the Silero VAD model will be considered as positively indicating speech.
   * The Silero VAD model is run on each frame. This number should be between 0 and 1.
   */
  positiveSpeechThreshold: number

  /**
   * Threshold under which values returned by the Silero VAD model will be considered as indicating an absence of speech.
   * Note that the creators of the Silero VAD have historically set this number at 0.15 less than `positiveSpeechThreshold`.
   */
  negativeSpeechThreshold: number

  /**
   * After a VAD value under the `negativeSpeechThreshold` is observed, the algorithm will wait `redemptionFrames` frames
   * before running `onSpeechEnd`. If the model returns a value over `positiveSpeechThreshold` during this grace period, then
   * the algorithm will consider the previously-detected "speech end" as having been a false negative.
   */
  redemptionFrames: number

  /**
   * Number of audio samples (under a sample rate of 16000) to comprise one "frame" to feed to the Silero VAD model.
   * The `frame` serves as a unit of measurement of lengths of audio segments and many other parameters are defined in terms of
   * frames. The authors of the Silero VAD model offer the following warning:
   * > WARNING! Silero VAD models were trained using 512, 1024, 1536 samples for 16000 sample rate and
   * > 256, 512, 768 samples for 8000 sample rate. Values other than these may affect model performance!
   * In this context, audio fed to the VAD model always has sample rate 16000. It is recommended to leave this at 1536.
   */
  frameSamples: number

  /**
   * Number of frames to prepend to the audio segment that will be passed to `onSpeechEnd`.
   */
  preSpeechPadFrames: number

  /**
   * If an audio segment is detected as a speech segment according to initial algorithm but it has fewer than `minSpeechFrames`,
   * it will be discarded and considered a misfire.
   */
  minSpeechFrames: number

  /**
   * If true, when the user pauses the VAD, it may trigger a speech end event.
   */
  submitUserSpeechOnPause: boolean
}

/**
 * Default configuration values for the frame processor
 */
export const defaultFrameProcessorOptions: FrameProcessorOptions = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.5 - 0.15,
  preSpeechPadFrames: 1,
  redemptionFrames: 8,
  frameSamples: 1536,
  minSpeechFrames: 3,
  submitUserSpeechOnPause: false,
}

/**
 * Validates the frame processor options for common issues
 * Logs warnings or errors if problematic values are detected
 */
export function validateOptions(options: FrameProcessorOptions): void {
  if (!RECOMMENDED_FRAME_SAMPLES.includes(options.frameSamples)) {
    console.warn('Using an unusual frame size that may affect model performance.')
    console.warn(`Recommended values for 16kHz audio: ${RECOMMENDED_FRAME_SAMPLES.join(', ')}`)
  }

  if (options.positiveSpeechThreshold < 0 || options.positiveSpeechThreshold > 1) {
    console.error('positiveSpeechThreshold should be a number between 0 and 1')
  }

  if (options.negativeSpeechThreshold < 0 || options.negativeSpeechThreshold > options.positiveSpeechThreshold) {
    console.error('negativeSpeechThreshold should be between 0 and positiveSpeechThreshold')
  }

  if (options.preSpeechPadFrames < 0) {
    console.error('preSpeechPadFrames should be positive')
  }

  if (options.redemptionFrames < 0) {
    console.error('redemptionFrames should be positive')
  }
}

/**
 * Result of processing an audio frame
 */
export interface FrameProcessResult {
  /** Speech probability values from the model */
  probs?: SpeechProbabilities
  /** Message indicating what event occurred (if any) */
  msg?: Message
  /** Audio data for the detected segment */
  audio?: Float32Array
}

/**
 * Concatenates multiple Float32Arrays into a single array
 */
const concatArrays = (arrays: Float32Array[]): Float32Array => {
  const sizes = arrays.reduce(
    (out, next) => {
      out.push((out.at(-1) as number) + next.length)
      return out
    },
    [0],
  )

  const outArray = new Float32Array(sizes.at(-1) as number)
  arrays.forEach((arr, index) => {
    const place = sizes[index]
    outArray.set(arr, place)
  })

  return outArray
}

/**
 * Frame processor for voice activity detection
 *
 * Handles the logic of detecting speech segments from a stream of audio frames
 * by applying a voice activity detection model to each frame and tracking state.
 */
export class FrameProcessor {
  /** Whether speech is currently being detected */
  private speaking: boolean = false

  /** Buffer to store audio frames during processing */
  private audioBuffer: { frame: Float32Array; isSpeech: boolean }[]

  /** Counter for redemption period after potential speech end */
  private redemptionCounter = 0

  /** Whether the processor is active and processing frames */
  private active = false

  /**
   * Creates a new frame processor
   *
   * @param modelProcessFunc Function that processes a frame through the VAD model
   * @param modelResetFunc Function that resets the VAD model state
   * @param options Configuration options
   */
  constructor(
    private modelProcessFunc: (frame: Float32Array) => Promise<SpeechProbabilities>,
    private modelResetFunc: () => void,
    private options: FrameProcessorOptions,
  ) {
    this.audioBuffer = []
    this.reset()
  }

  /**
   * Resets the internal state of the processor
   */
  reset(): void {
    this.speaking = false
    this.audioBuffer = []
    this.modelResetFunc()
    this.redemptionCounter = 0
  }

  /**
   * Pauses the processor
   * May trigger a speech end event based on configuration
   */
  pause(): FrameProcessResult {
    this.active = false

    if (this.options.submitUserSpeechOnPause) {
      return this.endSegment()
    } else {
      this.reset()
      return {}
    }
  }

  /**
   * Resumes the processor
   */
  resume(): void {
    this.active = true
  }

  /**
   * Ends the current speech segment and returns it if valid
   */
  endSegment(): FrameProcessResult {
    const audioBuffer = this.audioBuffer
    this.audioBuffer = []
    const speaking = this.speaking
    this.reset()

    // Count frames marked as speech
    const speechFrameCount = audioBuffer.reduce((acc, item) => {
      return acc + +item.isSpeech
    }, 0)

    if (speaking) {
      if (speechFrameCount >= this.options.minSpeechFrames) {
        // Valid speech segment detected
        const audio = concatArrays(audioBuffer.map((item) => item.frame))
        return { msg: Message.SpeechEnd, audio }
      } else {
        // Too short to be considered speech
        return { msg: Message.VADMisfire }
      }
    }

    return {}
  }

  /**
   * Processes a single audio frame
   *
   * @param frame Audio frame to process
   * @returns Processing result, including any detected speech events
   */
  async process(frame: Float32Array): Promise<FrameProcessResult> {
    if (!this.active) {
      return {}
    }

    // Run the model on the current frame
    const probs = await this.modelProcessFunc(frame)

    // Store the frame in the buffer
    this.audioBuffer.push({
      frame,
      isSpeech: probs.isSpeech >= this.options.positiveSpeechThreshold,
    })

    // Reset redemption counter if speech is detected
    if (probs.isSpeech >= this.options.positiveSpeechThreshold && this.redemptionCounter) {
      this.redemptionCounter = 0
    }

    // Speech start detection
    if (probs.isSpeech >= this.options.positiveSpeechThreshold && !this.speaking) {
      this.speaking = true
      return { probs, msg: Message.SpeechStart }
    }

    // Speech end detection with redemption period
    if (
      probs.isSpeech < this.options.negativeSpeechThreshold &&
      this.speaking &&
      ++this.redemptionCounter >= this.options.redemptionFrames
    ) {
      this.redemptionCounter = 0
      this.speaking = false

      const audioBuffer = this.audioBuffer
      this.audioBuffer = []

      // Count frames marked as speech
      const speechFrameCount = audioBuffer.reduce((acc, item) => {
        return acc + +item.isSpeech
      }, 0)

      if (speechFrameCount >= this.options.minSpeechFrames) {
        // Valid speech segment detected
        const audio = concatArrays(audioBuffer.map((item) => item.frame))
        return { probs, msg: Message.SpeechEnd, audio }
      } else {
        // Too short to be considered speech
        return { probs, msg: Message.VADMisfire }
      }
    }

    // If not currently speaking, maintain a limited buffer for pre-speech padding
    if (!this.speaking) {
      while (this.audioBuffer.length > this.options.preSpeechPadFrames) {
        this.audioBuffer.shift()
      }
    }

    return { probs }
  }
}
