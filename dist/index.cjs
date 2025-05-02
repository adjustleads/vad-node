"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Message: () => Message,
  VAD: () => VAD,
  checkLameInstallation: () => checkLameInstallation,
  processMP3File: () => processMP3File
});
module.exports = __toCommonJS(index_exports);

// src/vad.ts
var fs = __toESM(require("fs/promises"), 1);

// src/models.ts
var Silero = class _Silero {
  _session;
  _h;
  _c;
  _sr;
  ort;
  modelBuffer;
  /**
   * Creates a new instance of the Silero VAD model
   * @param modelBuffer ArrayBuffer containing the ONNX model data
   */
  constructor(modelBuffer) {
    this.ort = require("onnxruntime-node");
    this.modelBuffer = modelBuffer;
  }
  /**
   * Factory method to create and initialize a new Silero VAD model
   * @param modelBuffer ArrayBuffer containing the ONNX model data
   * @returns Initialized Silero model instance
   */
  static async create(modelBuffer) {
    const model = new _Silero(modelBuffer);
    await model.init();
    return model;
  }
  /**
   * Initialize the ONNX runtime session with the model
   */
  async init() {
    console.debug("Initializing Silero VAD model");
    this._session = await this.ort.InferenceSession.create(this.modelBuffer);
    this._sr = new this.ort.Tensor("int64", [16000n]);
    this.reset_state();
    console.debug("Silero VAD model initialized");
  }
  /**
   * Reset the internal LSTM state of the model
   */
  reset_state = () => {
    const zeroes = Array(2 * 64).fill(0);
    this._h = new this.ort.Tensor("float32", zeroes, [2, 1, 64]);
    this._c = new this.ort.Tensor("float32", zeroes, [2, 1, 64]);
  };
  /**
   * Process an audio frame and determine speech probability
   * @param audioFrame Float32Array containing audio samples
   * @returns Speech probability scores
   */
  process = async (audioFrame) => {
    const t = new this.ort.Tensor("float32", audioFrame, [1, audioFrame.length]);
    const inputs = {
      input: t,
      h: this._h,
      c: this._c,
      sr: this._sr
    };
    try {
      const out = await this._session.run(inputs);
      this._h = out.hn;
      this._c = out.cn;
      const [isSpeech] = out.output.data;
      const notSpeech = 1 - isSpeech;
      return { notSpeech, isSpeech };
    } catch (error) {
      console.error("Error running Silero VAD model:", error);
      throw error;
    }
  };
};

// src/messages.ts
var Message = /* @__PURE__ */ ((Message2) => {
  Message2["AudioFrame"] = "AUDIO_FRAME";
  Message2["SpeechStart"] = "SPEECH_START";
  Message2["VADMisfire"] = "VAD_MISFIRE";
  Message2["SpeechEnd"] = "SPEECH_END";
  Message2["SpeechStop"] = "SPEECH_STOP";
  return Message2;
})(Message || {});

// src/frame-processor.ts
var RECOMMENDED_FRAME_SAMPLES = [512, 1024, 1536];
var defaultFrameProcessorOptions = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.5 - 0.15,
  preSpeechPadFrames: 1,
  redemptionFrames: 8,
  frameSamples: 1536,
  minSpeechFrames: 3,
  submitUserSpeechOnPause: false
};
function validateOptions(options) {
  if (!RECOMMENDED_FRAME_SAMPLES.includes(options.frameSamples)) {
    console.warn("Using an unusual frame size that may affect model performance.");
    console.warn(`Recommended values for 16kHz audio: ${RECOMMENDED_FRAME_SAMPLES.join(", ")}`);
  }
  if (options.positiveSpeechThreshold < 0 || options.positiveSpeechThreshold > 1) {
    console.error("positiveSpeechThreshold should be a number between 0 and 1");
  }
  if (options.negativeSpeechThreshold < 0 || options.negativeSpeechThreshold > options.positiveSpeechThreshold) {
    console.error("negativeSpeechThreshold should be between 0 and positiveSpeechThreshold");
  }
  if (options.preSpeechPadFrames < 0) {
    console.error("preSpeechPadFrames should be positive");
  }
  if (options.redemptionFrames < 0) {
    console.error("redemptionFrames should be positive");
  }
}
var concatArrays = (arrays) => {
  const sizes = arrays.reduce(
    (out, next) => {
      out.push(out.at(-1) + next.length);
      return out;
    },
    [0]
  );
  const outArray = new Float32Array(sizes.at(-1));
  arrays.forEach((arr, index) => {
    const place = sizes[index];
    outArray.set(arr, place);
  });
  return outArray;
};
var FrameProcessor = class {
  /**
   * Creates a new frame processor
   *
   * @param modelProcessFunc Function that processes a frame through the VAD model
   * @param modelResetFunc Function that resets the VAD model state
   * @param options Configuration options
   */
  constructor(modelProcessFunc, modelResetFunc, options) {
    this.modelProcessFunc = modelProcessFunc;
    this.modelResetFunc = modelResetFunc;
    this.options = options;
    this.audioBuffer = [];
    this.reset();
  }
  /** Whether speech is currently being detected */
  speaking = false;
  /** Buffer to store audio frames during processing */
  audioBuffer;
  /** Counter for redemption period after potential speech end */
  redemptionCounter = 0;
  /** Whether the processor is active and processing frames */
  active = false;
  /**
   * Resets the internal state of the processor
   */
  reset() {
    this.speaking = false;
    this.audioBuffer = [];
    this.modelResetFunc();
    this.redemptionCounter = 0;
  }
  /**
   * Pauses the processor
   * May trigger a speech end event based on configuration
   */
  pause() {
    this.active = false;
    if (this.options.submitUserSpeechOnPause) {
      return this.endSegment();
    } else {
      this.reset();
      return {};
    }
  }
  /**
   * Resumes the processor
   */
  resume() {
    this.active = true;
  }
  /**
   * Ends the current speech segment and returns it if valid
   */
  endSegment() {
    const audioBuffer = this.audioBuffer;
    this.audioBuffer = [];
    const speaking = this.speaking;
    this.reset();
    const speechFrameCount = audioBuffer.reduce((acc, item) => {
      return acc + +item.isSpeech;
    }, 0);
    if (speaking) {
      if (speechFrameCount >= this.options.minSpeechFrames) {
        const audio = concatArrays(audioBuffer.map((item) => item.frame));
        return { msg: "SPEECH_END" /* SpeechEnd */, audio };
      } else {
        return { msg: "VAD_MISFIRE" /* VADMisfire */ };
      }
    }
    return {};
  }
  /**
   * Processes a single audio frame
   *
   * @param frame Audio frame to process
   * @returns Processing result, including any detected speech events
   */
  async process(frame) {
    if (!this.active) {
      return {};
    }
    const probs = await this.modelProcessFunc(frame);
    this.audioBuffer.push({
      frame,
      isSpeech: probs.isSpeech >= this.options.positiveSpeechThreshold
    });
    if (probs.isSpeech >= this.options.positiveSpeechThreshold && this.redemptionCounter) {
      this.redemptionCounter = 0;
    }
    if (probs.isSpeech >= this.options.positiveSpeechThreshold && !this.speaking) {
      this.speaking = true;
      return { probs, msg: "SPEECH_START" /* SpeechStart */ };
    }
    if (probs.isSpeech < this.options.negativeSpeechThreshold && this.speaking && ++this.redemptionCounter >= this.options.redemptionFrames) {
      this.redemptionCounter = 0;
      this.speaking = false;
      const audioBuffer = this.audioBuffer;
      this.audioBuffer = [];
      const speechFrameCount = audioBuffer.reduce((acc, item) => {
        return acc + +item.isSpeech;
      }, 0);
      if (speechFrameCount >= this.options.minSpeechFrames) {
        const audio = concatArrays(audioBuffer.map((item) => item.frame));
        return { probs, msg: "SPEECH_END" /* SpeechEnd */, audio };
      } else {
        return { probs, msg: "VAD_MISFIRE" /* VADMisfire */ };
      }
    }
    if (!this.speaking) {
      while (this.audioBuffer.length > this.options.preSpeechPadFrames) {
        this.audioBuffer.shift();
      }
    }
    return { probs };
  }
};

// src/resampler.ts
var Resampler = class {
  /**
   * Creates a new resampler
   * @param options Configuration options for resampling
   */
  constructor(options) {
    this.options = options;
    if (options.nativeSampleRate < options.targetSampleRate) {
      console.warn(
        `Upsampling not supported: nativeSampleRate (${options.nativeSampleRate}) should be >= targetSampleRate (${options.targetSampleRate})`
      );
    }
    this.inputBuffer = [];
  }
  /** Buffer for storing input audio samples during processing */
  inputBuffer;
  /**
   * Process a block of audio, returning resampled frames
   *
   * @param audioFrame Audio data to process
   * @returns Array of resampled audio frames
   */
  process = (audioFrame) => {
    const outputFrames = [];
    for (const sample of audioFrame) {
      this.inputBuffer.push(sample);
      while (this.hasEnoughDataForFrame()) {
        const outputFrame = this.generateOutputFrame();
        outputFrames.push(outputFrame);
      }
    }
    return outputFrames;
  };
  /**
   * Stream audio through the resampler as an async generator
   *
   * @param audioInput Audio data to process
   * @yields Resampled audio frames
   */
  async *stream(audioInput) {
    for (const sample of audioInput) {
      this.inputBuffer.push(sample);
      while (this.hasEnoughDataForFrame()) {
        const outputFrame = this.generateOutputFrame();
        yield outputFrame;
      }
    }
  }
  /**
   * Check if there's enough data in the buffer to generate a complete frame
   */
  hasEnoughDataForFrame() {
    const requiredSamples = this.options.targetFrameSize * (this.options.nativeSampleRate / this.options.targetSampleRate);
    return this.inputBuffer.length >= requiredSamples;
  }
  /**
   * Generate a resampled output frame from the input buffer
   *
   * This method implements a simple averaging algorithm for downsampling
   */
  generateOutputFrame() {
    const outputFrame = new Float32Array(this.options.targetFrameSize);
    let outputIndex = 0;
    let inputIndex = 0;
    while (outputIndex < this.options.targetFrameSize) {
      let sum = 0;
      let count = 0;
      const nextInputIndex = Math.min(
        this.inputBuffer.length,
        Math.ceil((outputIndex + 1) * this.options.nativeSampleRate / this.options.targetSampleRate)
      );
      while (inputIndex < nextInputIndex) {
        const value = this.inputBuffer[inputIndex];
        if (value !== void 0) {
          sum += value;
          count++;
        }
        inputIndex++;
      }
      outputFrame[outputIndex] = count > 0 ? sum / count : 0;
      outputIndex++;
    }
    this.inputBuffer = this.inputBuffer.slice(inputIndex);
    return outputFrame;
  }
};

// src/vad.ts
var TARGET_SAMPLE_RATE = 16e3;
var defaultVADOptions = {
  ...defaultFrameProcessorOptions,
  modelPath: `${process.cwd()}/silero_vad.onnx`
};
var VAD = class _VAD {
  frameProcessor;
  options;
  /**
   * Creates a new VAD instance
   * @param options Configuration options
   */
  constructor(options) {
    this.options = options;
    validateOptions(options);
  }
  /**
   * Create and initialize a new VAD instance
   * @param options Configuration options
   * @returns Initialized VAD instance
   */
  static async create(options = {}) {
    const fullOptions = {
      ...defaultVADOptions,
      ...options
    };
    const vad = new _VAD(fullOptions);
    await vad.init();
    return vad;
  }
  /**
   * Initialize the VAD by loading the model and setting up the frame processor
   */
  async init() {
    try {
      console.log(`Loading model from ${this.options.modelPath}`);
      const modelBuffer = await fs.readFile(this.options.modelPath);
      const buffer = new Uint8Array(modelBuffer).buffer;
      const model = await Silero.create(buffer);
      this.frameProcessor = new FrameProcessor(model.process, model.reset_state, {
        frameSamples: this.options.frameSamples,
        positiveSpeechThreshold: this.options.positiveSpeechThreshold,
        negativeSpeechThreshold: this.options.negativeSpeechThreshold,
        redemptionFrames: this.options.redemptionFrames,
        preSpeechPadFrames: this.options.preSpeechPadFrames,
        minSpeechFrames: this.options.minSpeechFrames,
        submitUserSpeechOnPause: this.options.submitUserSpeechOnPause
      });
      this.frameProcessor.resume();
    } catch (error) {
      console.error("Failed to initialize VAD:", error);
      throw error;
    }
  }
  /**
   * Process audio data to detect speech segments
   * @param inputAudio Audio data as Float32Array
   * @param sampleRate Sample rate of the input audio in Hz
   * @returns AsyncGenerator yielding speech segments
   */
  async *run(inputAudio, sampleRate) {
    if (!this.frameProcessor) {
      throw new Error("VAD not initialized. Wait for the create() method to complete.");
    }
    const resamplerOptions = {
      nativeSampleRate: sampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
      // Target for Silero VAD
      targetFrameSize: this.options.frameSamples
    };
    const resampler = new Resampler(resamplerOptions);
    let start = 0;
    let end = 0;
    let frameIndex = 0;
    for await (const frame of resampler.stream(inputAudio)) {
      const { msg: msg2, audio: audio2 } = await this.frameProcessor.process(frame);
      switch (msg2) {
        case "SPEECH_START" /* SpeechStart */:
          start = frameIndex * this.options.frameSamples / (TARGET_SAMPLE_RATE / 1e3);
          break;
        case "SPEECH_END" /* SpeechEnd */:
          end = (frameIndex + 1) * this.options.frameSamples / (TARGET_SAMPLE_RATE / 1e3);
          if (audio2) {
            yield { audio: audio2, start, end };
          }
          break;
      }
      frameIndex++;
    }
    const { msg, audio } = this.frameProcessor.endSegment();
    if (msg === "SPEECH_END" /* SpeechEnd */ && audio && audio.length > 0) {
      end = frameIndex * this.options.frameSamples / (TARGET_SAMPLE_RATE / 1e3);
      yield {
        audio,
        start,
        end
      };
    }
  }
};

// src/mp3.ts
var fs2 = __toESM(require("fs/promises"), 1);
var import_child_process = require("child_process");
var path = __toESM(require("path"), 1);

// src/logger.ts
var isProduction = process.env.NODE_ENV === "production";
var logger = {
  /**
   * Logs messages to the console if not in production.
   * @param {...any} args Arguments to log.
   */
  log: (...args) => {
    if (!isProduction) {
      console.log(...args);
    }
  },
  /**
   * Logs error messages to the console if not in production.
   * @param {...any} args Arguments to log as errors.
   */
  error: (...args) => {
    if (!isProduction) {
      console.error(...args);
    }
  }
};

// src/mp3.ts
async function decodeMP3(mp3Path) {
  logger.log(`Decoding MP3 file: ${mp3Path}`);
  try {
    await fs2.access(mp3Path);
  } catch (err) {
    throw new Error(`MP3 file not found: ${mp3Path}`);
  }
  return new Promise((resolve, reject) => {
    const lame = (0, import_child_process.spawn)("lame", [
      "--decode",
      // Decode mode
      "-t",
      // Don't output progress (silent)
      mp3Path,
      // Input file
      "-",
      // Output to stdout
      "--little-endian",
      // Output as little-endian
      "--signed",
      // Output as signed
      "--bitwidth",
      "16"
      // 16-bit PCM
    ]);
    const chunks = [];
    let sampleRate = 44100;
    let stderrOutput = "";
    lame.stdout.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    lame.stderr.on("data", (data) => {
      const output = data.toString();
      stderrOutput += output;
      const match = output.match(/\((\d+(?:\.\d+)?)\s+kHz/);
      if (match && match[1]) {
        const kHzValue = parseFloat(match[1]);
        sampleRate = Math.round(kHzValue * 1e3);
      }
    });
    lame.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`lame exited with code ${code}. stderr: ${stderrOutput}`));
      }
      if (chunks.length === 0) {
        return reject(new Error("No audio data received from lame"));
      }
      const buffer = Buffer.concat(chunks);
      const floatArray = new Float32Array(buffer.length / 2);
      for (let i = 0; i < floatArray.length; i++) {
        floatArray[i] = buffer.readInt16LE(i * 2) / 32768;
      }
      logger.log(`Decoded ${mp3Path}: ${floatArray.length} samples, ${sampleRate}Hz`);
      resolve([floatArray, sampleRate]);
    });
    lame.on("error", (err) => {
      reject(new Error(`Failed to spawn lame: ${err.message}`));
    });
  });
}
async function saveMP3File(audio, sampleRate, options = {}) {
  const outputDir = options.outputDir || process.cwd();
  await fs2.mkdir(outputDir, { recursive: true });
  const filename = options.outputFilename ? options.outputFilename : `${options.filePrefix || "segment"}_${options.index ?? 0}.mp3`;
  const outputPath = path.join(outputDir, filename);
  const tempPcmPath = path.join(outputDir, `temp_${path.parse(filename).name}.pcm`);
  const buffer = Buffer.alloc(audio.length * 2);
  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, audio[i]));
    buffer.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }
  await fs2.writeFile(tempPcmPath, buffer);
  return new Promise((resolve, reject) => {
    const lame = (0, import_child_process.spawn)("lame", [
      "-r",
      // Input is raw PCM
      "--little-endian",
      // Input is little-endian
      "--signed",
      // Input is signed
      "--bitwidth",
      "16",
      // Input is 16-bit
      "-s",
      sampleRate.toString(),
      // Input sample rate
      "-m",
      "m",
      // Mono mode
      "-q",
      "4",
      // Quality setting
      tempPcmPath,
      // Input file
      outputPath
      // Output file (using the determined filename)
    ]);
    lame.on("close", async (code) => {
      try {
        await fs2.unlink(tempPcmPath);
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`lame encoder exited with code ${code}`));
        }
      } catch (err) {
        reject(err);
      }
    });
    lame.on("error", (err) => {
      reject(new Error(`Failed to encode MP3: ${err.message}`));
    });
  });
}
async function processMP3File(mp3Path, options = {}) {
  try {
    const vad = options.vadInstance || await VAD.create(options);
    const [audioData, detectedSampleRate] = await decodeMP3(mp3Path);
    const startTime = Date.now();
    const segments = [];
    const outputFiles = [];
    const allAudioSegments = [];
    for await (const segment of vad.run(audioData, detectedSampleRate)) {
      segments.push(segment);
      if (options.saveFiles) {
        if (options.mergeOutputChunks) {
          allAudioSegments.push(segment.audio);
        } else {
          const outputPath = await saveMP3File(
            segment.audio,
            TARGET_SAMPLE_RATE,
            // VAD output is resampled
            {
              outputDir: options.outputDir,
              filePrefix: options.filePrefix,
              index: segments.length
              // Pass index for default naming
            }
          );
          outputFiles.push(outputPath);
        }
      }
    }
    if (options.saveFiles && options.mergeOutputChunks && allAudioSegments.length > 0) {
      const paddingDurationSeconds = 0.5;
      const paddingSamples = Math.floor(paddingDurationSeconds * TARGET_SAMPLE_RATE);
      const silencePadding = new Float32Array(paddingSamples).fill(0);
      let totalLength = 0;
      allAudioSegments.forEach((segment) => {
        totalLength += segment.length;
      });
      totalLength += Math.max(0, allAudioSegments.length - 1) * paddingSamples;
      const mergedAudio = new Float32Array(totalLength);
      let currentOffset = 0;
      allAudioSegments.forEach((segment, index) => {
        mergedAudio.set(segment, currentOffset);
        currentOffset += segment.length;
        if (index < allAudioSegments.length - 1) {
          mergedAudio.set(silencePadding, currentOffset);
          currentOffset += paddingSamples;
        }
      });
      const mergedFilename = `${options.filePrefix || "merged_output"}.mp3`;
      const mergedOutputPath = await saveMP3File(
        mergedAudio,
        TARGET_SAMPLE_RATE,
        // VAD output rate
        {
          outputDir: options.outputDir,
          outputFilename: mergedFilename
          // Use specific filename
        }
      );
      outputFiles.push(mergedOutputPath);
    }
    const processingTime = Date.now() - startTime;
    return {
      segments,
      outputFiles: options.saveFiles ? outputFiles : void 0,
      // Contains single or multiple paths
      processingTime,
      audioData,
      sampleRate: detectedSampleRate
    };
  } catch (error) {
    logger.error("Error processing MP3:", error);
    throw error;
  }
}
function checkLameInstallation() {
  return new Promise((resolve, reject) => {
    const process2 = (0, import_child_process.spawn)("lame", ["--version"]);
    process2.on("error", () => {
      reject(
        new Error(
          "Error: lame is not installed or not in PATH. Please install lame for MP3 encoding/decoding (e.g., brew install lame on macOS)"
        )
      );
    });
    process2.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`lame command exited with code ${code}`));
      }
    });
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Message,
  VAD,
  checkLameInstallation,
  processMP3File
});
