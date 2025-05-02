export type ONNXRuntimeAPI = any
export type ModelFetcher = () => Promise<ArrayBuffer>
export type OrtOptions = {
  ortConfig?: (ort: ONNXRuntimeAPI) => any
}

export interface SpeechProbabilities {
  notSpeech: number
  isSpeech: number
}

/**
 * Interface for the model's core functionality
 */
export interface Model {
  reset_state: () => void
  process: (arr: Float32Array) => Promise<SpeechProbabilities>
}

/**
 * Silero Voice Activity Detection (VAD) model implementation
 * Handles loading and running the ONNX model for speech detection
 */
export class Silero implements Model {
  private _session: any
  private _h: any
  private _c: any
  private _sr: any
  private ort: any
  private modelBuffer: ArrayBuffer

  /**
   * Creates a new instance of the Silero VAD model
   * @param modelBuffer ArrayBuffer containing the ONNX model data
   */
  constructor(modelBuffer: ArrayBuffer) {
    // Import ONNX runtime dynamically to avoid issues esbuild .node imports - in a Node.js environment this is safe
    this.ort = require('onnxruntime-node')
    this.modelBuffer = modelBuffer
  }

  /**
   * Factory method to create and initialize a new Silero VAD model
   * @param modelBuffer ArrayBuffer containing the ONNX model data
   * @returns Initialized Silero model instance
   */
  static async create(modelBuffer: ArrayBuffer): Promise<Silero> {
    const model = new Silero(modelBuffer)
    await model.init()
    return model
  }

  /**
   * Initialize the ONNX runtime session with the model
   */
  private async init(): Promise<void> {
    console.debug('Initializing Silero VAD model')
    this._session = await this.ort.InferenceSession.create(this.modelBuffer)

    // Set constant sample rate tensor (16kHz)
    this._sr = new this.ort.Tensor('int64', [16000n])
    this.reset_state()
    console.debug('Silero VAD model initialized')
  }

  /**
   * Reset the internal LSTM state of the model
   */
  reset_state = (): void => {
    const zeroes = Array(2 * 64).fill(0)
    this._h = new this.ort.Tensor('float32', zeroes, [2, 1, 64])
    this._c = new this.ort.Tensor('float32', zeroes, [2, 1, 64])
  }

  /**
   * Process an audio frame and determine speech probability
   * @param audioFrame Float32Array containing audio samples
   * @returns Speech probability scores
   */
  process = async (audioFrame: Float32Array): Promise<SpeechProbabilities> => {
    // Create tensor from audio frame
    const t = new this.ort.Tensor('float32', audioFrame, [1, audioFrame.length])

    // Prepare inputs for the model
    const inputs = {
      input: t,
      h: this._h,
      c: this._c,
      sr: this._sr,
    }

    try {
      // Run the model
      const out = await this._session.run(inputs)

      // Update internal state
      this._h = out.hn
      this._c = out.cn

      // Get speech probability from output
      const [isSpeech] = out.output.data
      const notSpeech = 1 - isSpeech

      return { notSpeech, isSpeech }
    } catch (error: any) {
      console.error('Error running Silero VAD model:', error)
      throw error
    }
  }
}
