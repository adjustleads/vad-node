/**
 * Options for configuring the audio resampler
 */
interface ResamplerOptions {
  /** Original sample rate of the audio in Hz */
  nativeSampleRate: number
  /** Target sample rate for resampling in Hz */
  targetSampleRate: number
  /** Number of samples in each output frame */
  targetFrameSize: number
}

/**
 * Audio resampler for converting audio between different sample rates
 *
 * This implementation uses a simple averaging approach to downsample
 * audio from a higher sample rate to a lower one, primarily designed
 * for converting audio to the 16kHz format required by the Silero VAD model.
 */
export class Resampler {
  /** Buffer for storing input audio samples during processing */
  private inputBuffer: number[]

  /**
   * Creates a new resampler
   * @param options Configuration options for resampling
   */
  constructor(public options: ResamplerOptions) {
    if (options.nativeSampleRate < options.targetSampleRate) {
      console.warn(
        `Upsampling not supported: nativeSampleRate (${options.nativeSampleRate}) ` +
          `should be >= targetSampleRate (${options.targetSampleRate})`,
      )
    }
    this.inputBuffer = []
  }

  /**
   * Process a block of audio, returning resampled frames
   *
   * @param audioFrame Audio data to process
   * @returns Array of resampled audio frames
   */
  process = (audioFrame: Float32Array): Float32Array[] => {
    const outputFrames: Float32Array[] = []

    for (const sample of audioFrame) {
      this.inputBuffer.push(sample)

      while (this.hasEnoughDataForFrame()) {
        const outputFrame = this.generateOutputFrame()
        outputFrames.push(outputFrame)
      }
    }

    return outputFrames
  }

  /**
   * Stream audio through the resampler as an async generator
   *
   * @param audioInput Audio data to process
   * @yields Resampled audio frames
   */
  async *stream(audioInput: Float32Array): AsyncGenerator<Float32Array> {
    for (const sample of audioInput) {
      this.inputBuffer.push(sample)

      while (this.hasEnoughDataForFrame()) {
        const outputFrame = this.generateOutputFrame()
        yield outputFrame
      }
    }
  }

  /**
   * Check if there's enough data in the buffer to generate a complete frame
   */
  private hasEnoughDataForFrame(): boolean {
    const requiredSamples =
      this.options.targetFrameSize * (this.options.nativeSampleRate / this.options.targetSampleRate)

    return this.inputBuffer.length >= requiredSamples
  }

  /**
   * Generate a resampled output frame from the input buffer
   *
   * This method implements a simple averaging algorithm for downsampling
   */
  private generateOutputFrame(): Float32Array {
    const outputFrame = new Float32Array(this.options.targetFrameSize)
    let outputIndex = 0
    let inputIndex = 0

    while (outputIndex < this.options.targetFrameSize) {
      let sum = 0
      let count = 0

      const nextInputIndex = Math.min(
        this.inputBuffer.length,
        Math.ceil(((outputIndex + 1) * this.options.nativeSampleRate) / this.options.targetSampleRate),
      )

      while (inputIndex < nextInputIndex) {
        const value = this.inputBuffer[inputIndex]
        if (value !== undefined) {
          sum += value
          count++
        }
        inputIndex++
      }

      outputFrame[outputIndex] = count > 0 ? sum / count : 0
      outputIndex++
    }

    this.inputBuffer = this.inputBuffer.slice(inputIndex)

    return outputFrame
  }
}
