export type ONNXRuntimeAPI = any
export type ModelFetcher = () => Promise<ArrayBuffer>
export type OrtOptions = {
  ortConfig?: (ort: ONNXRuntimeAPI) => any
}

export interface SpeechProbabilities {
  notSpeech: number
  isSpeech: number
}

export interface Model {
  reset_state: () => void
  process: (arr: Float32Array) => Promise<SpeechProbabilities>
}
// TODO: check type safety
export class Silero {
  _session: any
  _h: any
  _c: any
  _sr: any

  constructor(
    private ort: ONNXRuntimeAPI,
    private modelFetcher: ModelFetcher,
  ) {}

  static new = async (ort: ONNXRuntimeAPI, modelFetcher: ModelFetcher) => {
    const model = new Silero(ort, modelFetcher)
    await model.init()
    return model
  }

  init = async () => {
    console.debug('initializing vad')
    const modelArrayBuffer = await this.modelFetcher()
    this._session = await this.ort.InferenceSession.create(modelArrayBuffer)

    // Log the model's expected inputs
    console.log('Model inputs:', this._session.inputNames)
    console.log('Model outputs:', this._session.outputNames)

    this._sr = new this.ort.Tensor('int64', [16000n])
    this.reset_state()
    console.debug('vad is initialized')
  }

  reset_state = () => {
    const zeroes = Array(2 * 64).fill(0)
    this._h = new this.ort.Tensor('float32', zeroes, [2, 1, 64])
    this._c = new this.ort.Tensor('float32', zeroes, [2, 1, 64])
  }

  process = async (audioFrame: Float32Array): Promise<SpeechProbabilities> => {
    const t = new this.ort.Tensor('float32', audioFrame, [1, audioFrame.length])
    const inputs = {
      input: t,
      h: this._h,
      c: this._c,
      sr: this._sr,
    }

    // Log the inputs we're providing
    console.log('Running model with inputs:', Object.keys(inputs))

    try {
      const out = await this._session.run(inputs)
      this._h = out.hn
      this._c = out.cn
      const [isSpeech] = out.output.data
      const notSpeech = 1 - isSpeech
      return { notSpeech, isSpeech }
    } catch (error: any) {
      console.error('Error running model:', error)

      // Try again with modified inputs if there's a 'state' input missing error
      if (error.toString().includes("input 'state' is missing")) {
        console.log('Trying with state input...')
        const modifiedInputs = {
          input: t,
          h: this._h,
          c: this._c,
          sr: this._sr,
          state: this._h, // Try using h as state as a fallback
        }

        const out = await this._session.run(modifiedInputs)
        this._h = out.hn
        this._c = out.cn
        const [isSpeech] = out.output.data
        const notSpeech = 1 - isSpeech
        return { notSpeech, isSpeech }
      }

      throw error
    }
  }
}
