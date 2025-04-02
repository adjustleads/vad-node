import * as fs from 'fs/promises'
import * as ort from 'onnxruntime-node'
import { Silero, type ModelFetcher, type ONNXRuntimeAPI, type OrtOptions } from './models'
import {
  defaultFrameProcessorOptions,
  FrameProcessor,
  validateOptions,
  type FrameProcessorInterface,
  type FrameProcessorOptions,
} from './frame-processor'
import { Message } from './messages'
import { Resampler } from './resampler'

// Define the Node-specific model fetcher (as it was in packages/node/src/index.ts)
const modelPath = `${process.cwd()}/silero_vad_OLD.onnx` // Load from root folder instead of dirname
const modelFetcher: ModelFetcher = async (): Promise<ArrayBuffer> => {
  console.log('Loading model from', modelPath)
  const contents = await fs.readFile(modelPath) // contents is a Node.js Buffer
  // Create a Uint8Array view on the underlying ArrayBufferLike
  const view = new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength)
  // Create a new ArrayBuffer by copying the data from the view
  const arrayBuffer = view.slice().buffer as ArrayBuffer
  return arrayBuffer
}

export interface NonRealTimeVADSpeechData {
  audio: Float32Array
  start: number
  end: number
}

export interface NonRealTimeVADOptions extends FrameProcessorOptions, OrtOptions {}

export const defaultNonRealTimeVADOptions: NonRealTimeVADOptions = {
  ...defaultFrameProcessorOptions,
  ortConfig: undefined,
}

export class NonRealTimeVAD {
  frameProcessor: FrameProcessorInterface | undefined

  // --- Static methods ---

  // Original static method from PlatformAgnosticNonRealTimeVAD
  private static async _new<T extends NonRealTimeVAD>(
    modelFetcher: ModelFetcher,
    ort: ONNXRuntimeAPI,
    options: Partial<NonRealTimeVADOptions> = {},
  ): Promise<T> {
    const fullOptions = {
      ...defaultNonRealTimeVADOptions,
      ...options,
    }

    if (fullOptions.ortConfig !== undefined) {
      fullOptions.ortConfig(ort)
    }

    const vad = new this(modelFetcher, ort, fullOptions)
    await vad.init()
    return vad as T
  }

  // Node-specific static initializer from packages/node/src/index.ts
  static async new(options: Partial<NonRealTimeVADOptions> = {}): Promise<NonRealTimeVAD> {
    // Calls the private _new using the Node-specific modelFetcher and ort runtime
    return await this._new(modelFetcher, ort, options)
  }

  // --- Instance members (from PlatformAgnosticNonRealTimeVAD) ---

  constructor(
    public modelFetcher: ModelFetcher,
    public ort: ONNXRuntimeAPI,
    public options: NonRealTimeVADOptions,
  ) {
    validateOptions(options)
  }

  init = async (): Promise<void> => {
    // Assuming Silero class handles ONNX model loading and processing interface
    const model = await Silero.new(this.ort, this.modelFetcher)

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
  }

  run = async function* (
    this: NonRealTimeVAD,
    inputAudio: Float32Array,
    sampleRate: number,
  ): AsyncGenerator<NonRealTimeVADSpeechData> {
    if (!this.frameProcessor) {
      throw new Error('VAD not initialized. Call init() first or use the static new() method.')
    }
    const resamplerOptions = {
      nativeSampleRate: sampleRate,
      targetSampleRate: 16000, // Target for Silero VAD
      targetFrameSize: this.options.frameSamples,
    }
    const resampler = new Resampler(resamplerOptions)
    let start = 0
    let end = 0
    let frameIndex = 0

    // The actual processing loop using the resampler and frame processor
    for await (const frame of resampler.stream(inputAudio)) {
      const { msg, audio } = await this.frameProcessor.process(frame)
      switch (msg) {
        case Message.SpeechStart:
          // Calculate time based on frames processed so far at the target sample rate (16kHz)
          start = (frameIndex * this.options.frameSamples) / 16 // time in ms
          break

        case Message.SpeechEnd:
          // Calculate time based on frames processed so far at the target sample rate (16kHz)
          end = ((frameIndex + 1) * this.options.frameSamples) / 16 // time in ms
          // Ensure audio is defined before yielding
          if (audio) {
            yield { audio, start, end } // audio is the Float32Array segment
          }
          break

        default:
          // Handle other messages like silence if needed
          break
      }
      frameIndex++
    }

    // Check for any remaining audio segment after the loop
    const { msg, audio } = this.frameProcessor.endSegment()
    // The check audio?.length > 0 correctly handles undefined, but TS needs assurance for the yield
    if (msg == Message.SpeechEnd && audio && audio.length > 0) {
      // Calculate end time for the final segment
      end = (frameIndex * this.options.frameSamples) / 16 // time in ms
      yield {
        // 'audio' is confirmed to be non-undefined by the if condition above
        audio,
        start, // 'start' would be from the last SpeechStart event
        end,
      }
    }
  }
}

// Example Usage (similar to examples/node/index.js, but self-contained class)
// Needs an MP3 decoder function like 'loadMp3Audio'
/*
async function loadMp3Audio(filePath: string): Promise<[Float32Array, number]> {
    // Implementation using fluent-ffmpeg or node-lame
    // ... decode MP3 to Float32Array and get sampleRate
    console.log(`Loading MP3: ${filePath}`);
    // Placeholder: Replace with actual MP3 decoding
    const dummyAudio = new Float32Array(16000 * 5); // 5 seconds dummy audio
    const sampleRate = 44100; // Example original sample rate
    console.log(`Dummy audio loaded, sample rate: ${sampleRate}`);
    return [dummyAudio, sampleRate];
}

const main = async () => {
    try {
        // Assuming test.mp3 exists
        const [audioData, sampleRate] = await loadMp3Audio("test.mp3");
        console.log(`Audio loaded: ${audioData.length} samples, Sample rate: ${sampleRate}`);

        // Instantiate using the Node-specific static method
        const myvad = await NonRealTimeVAD.new({
            // Optional: Adjust VAD parameters here if needed
            // positiveSpeechThreshold: 0.6,
            // negativeSpeechThreshold: 0.4,
        });
        console.log("VAD initialized");

        console.log("Starting VAD processing...");
        let segmentCount = 0;
        for await (const { audio, start, end } of myvad.run(audioData, sampleRate)) {
            segmentCount++;
            console.log(`Speech segment ${segmentCount}: Start=${start.toFixed(0)}ms, End=${end.toFixed(0)}ms, Length=${audio.length} samples`);
            // You could save or process the 'audio' Float32Array segment here
        }
        console.log(`VAD processing finished. Found ${segmentCount} segments.`);

    } catch (error) {
        console.error("An error occurred:", error);
    }
};

// main(); // Uncomment to run
*/
