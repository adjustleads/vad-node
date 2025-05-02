declare enum Message {
    AudioFrame = "AUDIO_FRAME",
    SpeechStart = "SPEECH_START",
    VADMisfire = "VAD_MISFIRE",
    SpeechEnd = "SPEECH_END",
    SpeechStop = "SPEECH_STOP"
}

/**
 * Frame processor for Voice Activity Detection (VAD)
 *
 * Some of this code, together with the default options, is based on the
 * implementation approach from https://github.com/snakers4/silero-vad
 */

/**
 * Configuration options for the frame processor
 */
interface FrameProcessorOptions {
    /**
     * Threshold over which values returned by the Silero VAD model will be considered as positively indicating speech.
     * The Silero VAD model is run on each frame. This number should be between 0 and 1.
     */
    positiveSpeechThreshold: number;
    /**
     * Threshold under which values returned by the Silero VAD model will be considered as indicating an absence of speech.
     * Note that the creators of the Silero VAD have historically set this number at 0.15 less than `positiveSpeechThreshold`.
     */
    negativeSpeechThreshold: number;
    /**
     * After a VAD value under the `negativeSpeechThreshold` is observed, the algorithm will wait `redemptionFrames` frames
     * before running `onSpeechEnd`. If the model returns a value over `positiveSpeechThreshold` during this grace period, then
     * the algorithm will consider the previously-detected "speech end" as having been a false negative.
     */
    redemptionFrames: number;
    /**
     * Number of audio samples (under a sample rate of 16000) to comprise one "frame" to feed to the Silero VAD model.
     * The `frame` serves as a unit of measurement of lengths of audio segments and many other parameters are defined in terms of
     * frames. The authors of the Silero VAD model offer the following warning:
     * > WARNING! Silero VAD models were trained using 512, 1024, 1536 samples for 16000 sample rate and
     * > 256, 512, 768 samples for 8000 sample rate. Values other than these may affect model performance!
     * In this context, audio fed to the VAD model always has sample rate 16000. It is recommended to leave this at 1536.
     */
    frameSamples: number;
    /**
     * Number of frames to prepend to the audio segment that will be passed to `onSpeechEnd`.
     */
    preSpeechPadFrames: number;
    /**
     * If an audio segment is detected as a speech segment according to initial algorithm but it has fewer than `minSpeechFrames`,
     * it will be discarded and considered a misfire.
     */
    minSpeechFrames: number;
    /**
     * If true, when the user pauses the VAD, it may trigger a speech end event.
     */
    submitUserSpeechOnPause: boolean;
}

/**
 * Represents a segment of speech detected by the VAD
 */
interface SpeechSegment {
    /** Start time of the speech segment in milliseconds */
    start: number;
    /** End time of the speech segment in milliseconds */
    end: number;
}
/**
 * Configuration options for the VAD
 */
interface VADOptions extends FrameProcessorOptions {
    /** Path to the ONNX model file (defaults to 'silero_vad.onnx' in the current working directory) */
    modelPath?: string;
}
/**
 * Voice Activity Detection (VAD) implementation
 * Processes audio files to detect speech segments
 */
declare class VAD {
    private frameProcessor;
    private options;
    /**
     * Creates a new VAD instance
     * @param options Configuration options
     */
    private constructor();
    /**
     * Create and initialize a new VAD instance
     * @param options Configuration options
     * @returns Initialized VAD instance
     */
    static create(options?: Partial<VADOptions>): Promise<VAD>;
    /**
     * Initialize the VAD by loading the model and setting up the frame processor
     */
    private init;
    /**
     * Process audio data to detect speech segments
     * @param inputAudio Audio data as Float32Array
     * @param sampleRate Sample rate of the input audio in Hz
     * @returns AsyncGenerator yielding speech segments
     */
    run(inputAudio: Float32Array, sampleRate: number): AsyncGenerator<SpeechSegment>;
}

/**
 * Options for VAD processing of MP3s (no file saving)
 */
interface ProcessMP3Options extends Partial<VADOptions> {
    /** Optional pre-initialized VAD instance */
    vadInstance?: VAD;
}
/**
 * Result of processing an MP3 file for VAD (no file saving)
 */
interface ProcessMP3Result {
    /** Detected speech segments (only start and end times) */
    segments: SpeechSegment[];
    /** Total VAD processing time in milliseconds */
    processingTime: number;
    /** Original audio data */
    audioData: Float32Array;
    /** Original sample rate */
    sampleRate: number;
}
/**
 * Process an MP3 file with the VAD (does not save files)
 *
 * @param mp3Path Path to the MP3 file
 * @param options Processing options
 * @returns Promise with processing results (segments, times, audio data, sample rate)
 */
declare function processMP3File(mp3Path: string, options?: ProcessMP3Options): Promise<ProcessMP3Result>;
/**
 * Extracts specific segments from an MP3, adds padding, and saves as a new MP3.
 * @param inputPath Path to the input MP3 file.
 * @param outputPath Path to save the resulting MP3 file.
 * @param segments Array of { start: number, end: number } timestamps in seconds.
 * @param paddingMs Padding duration in milliseconds to add at the start, end, and between segments. Default is 500ms.
 * @returns Promise that resolves when the file is saved.
 */
declare function processMP3Segments(inputPath: string, outputPath: string, segments: {
    start: number;
    end: number;
}[], paddingMs?: number): Promise<void>;
/**
 * Checks if lame is installed and available
 * @returns Promise that resolves if lame is available, rejects otherwise
 */
declare function checkLameInstallation(): Promise<void>;

export { type FrameProcessorOptions, Message, type ProcessMP3Options, type SpeechSegment, VAD, type VADOptions, checkLameInstallation, processMP3File, processMP3Segments };
