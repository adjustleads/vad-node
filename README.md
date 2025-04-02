# Voice Activity Detection (VAD) for Node.js

A Node.js library for Voice Activity Detection (VAD) using the Silero VAD model, designed for easy integration into Node.js applications. This package includes pre-built distribution files for straightforward usage directly from GitHub.

## Installation

You can install this package directly from the `main` branch on GitHub. Since the compiled JavaScript files (`dist/` directory) are included in the repository, no build step is required after installation.

```bash
# Installs from the main branch (includes pre-built files)
npm install adjustleads/vad-node

# Or specify a specific commit hash or tag if needed
# npm install adjustleads/vad-node#<commit-hash-or-tag>
```

**Note:** Installing directly from `main` gives you the latest code, which might not always correspond to a stable, tagged release.

Alternatively, for development purposes, clone the repository (see Development section).

## Dependencies

- **[onnxruntime-node](https://www.npmjs.com/package/onnxruntime-node):** Required for running the Silero VAD ONNX model. This is listed as a peer dependency and needs to be installed alongside this package.
- **[lame](http://lame.sourceforge.net/):** (Optional) Required _only_ if you use the `processMP3File` function. It must be installed system-wide (e.g., via `apt install lame`, `brew install lame`).

Ensure you install the peer dependency:

```bash
npm install onnxruntime-node
```

## Basic Usage

```javascript
const { VAD } = require('adjustleads-vad-node') // Use the package name as defined in package.json
const fs = require('fs') // Example for loading audio data

async function detectSpeech() {
  try {
    // Create a VAD instance with default or custom options
    const vad = await VAD.create({
      modelPath: 'node_modules/adjustleads-vad-node/silero_vad.onnx', // Default path relative to execution
      // Optional overrides:
      // positiveSpeechThreshold: 0.6,
      // negativeSpeechThreshold: 0.4,
      // minSpeechFrames: 4,
      // preSpeechPadFrames: 2,
      // redemptionFrames: 8
    })

    // --- Placeholder: Load your audio data ---
    // Audio must be a Float32Array.
    // The VAD processor expects 16kHz mono audio internally.
    // Provide the original sample rate; the library handles resampling.
    const originalSampleRate = 44100 // Your audio's sample rate
    // Example: 5 seconds of dummy 44.1kHz audio data
    const audioDurationSeconds = 5
    const audioData = new Float32Array(originalSampleRate * audioDurationSeconds)
    // In a real scenario, load from a file or stream:
    // const audioBuffer = fs.readFileSync('path/to/your/audio.wav');
    // const audioData = /* Decode audioBuffer to Float32Array */;
    // --- End Placeholder ---

    console.log(`Processing ${audioData.length} samples at ${originalSampleRate} Hz...`)

    // Process audio data asynchronously to get speech segments
    let segmentCount = 0
    for await (const { audio, start, end } of vad.run(audioData, originalSampleRate)) {
      segmentCount++
      console.log(`
Speech Segment ${segmentCount}:`)
      console.log(` - Start Time: ${start.toFixed(0)} ms`)
      console.log(` - End Time: ${end.toFixed(0)} ms`)
      console.log(` - Segment Length: ${audio.length} samples (at 16kHz)`)

      // 'audio' contains the Float32Array data for the detected speech segment (at 16kHz)
      // You can now process, analyze, or save this segment.
      // Example: saveSegmentToFile(audio, segmentCount);
    }

    if (segmentCount === 0) {
      console.log('No speech segments detected.')
    }
  } catch (error) {
    console.error('An error occurred during VAD processing:', error)
  }
}

detectSpeech()
```

_Note:_ Adjust the `modelPath` in `VAD.create` if `silero_vad.onnx` is not located at the default path relative to where your script is run. It's included in the package, so referencing it within `node_modules` is often reliable.

## MP3 Processing (Optional)

The library includes a utility function to process MP3 files directly, provided `lame` is installed on your system.

```javascript
const { processMP3File, checkLameInstallation } = require('adjustleads-vad-node');
const path = require('path');

async function processSpeechInMP3() {
  const mp3FilePath = 'path/to/your/audio.mp3'; // Specify the path to your MP3 file
  const outputDirectory = './segments'; // Directory to save detected segments

  try {
    // 1. Check if lame is installed (optional but recommended)
    await checkLameInstallation();
    console.log("LAME installation confirmed.");

    // Ensure output directory exists
    // await fs.promises.mkdir(outputDirectory, { recursive: true }); // Requires Node.js v10+

    // 2. Process the MP3 file
    console.log(`Processing MP3 file: ${mp3FilePath}`);
    const result = await processMP3File(mp3FilePath, {
      // VAD options (can override defaults)
      // positiveSpeechThreshold: 0.6,

      // MP3 processing options
      saveFiles: true,           // Save detected segments as separate MP3 files
      outputDir: outputDirectory, // Directory to save the files
      filePrefix: 'speech_segment', // Prefix for the output filenames
    });

    // 3. Display results
    console.log(`
Processing complete. Found ${result.segments.length} speech segments.`);
    console.log(`Total processing time: ${result.processingTime} ms`);

    result.segments.forEach((segment, i) => {
      console.log(` - Segment ${i + 1}: ${segment.start.toFixed(0)}ms - ${segment.end.toFixed(0)}ms`);
      // 'segment.audio' contains the Float32Array data (16kHz mono)
    });

    if (result.outputFiles && result.outputFiles.length > 0) {
      console.log(`
Segments saved to: ${outputDirectory}`);
      result.outputFiles.forEach((filePath, i) => {
        console.log(` - ${path.basename(filePath)}`);
      });
    }

  } catch (error) {
    console.error('
Error during MP3 processing:', error.message);
    if (error.message.includes('lame command failed')) {
        console.error("Ensure 'lame' is installed and accessible in your system's PATH.");
    }
  }
}

processSpeechInMP3();
```

## Architecture Overview

The library uses the following main components:

1.  **`VAD` Class:** Main entry point. Manages configuration and orchestrates the processing pipeline.
2.  **`SileroVad` Class:** Wraps the ONNX runtime session, loads the `silero_vad.onnx` model, and performs inference on audio frames.
3.  **`FrameProcessor` Class:** Takes audio chunks, manages resampling (if necessary) to the required 16kHz, frames the audio, sends frames to `SileroVad`, and applies the core VAD logic (thresholding, silence detection, segment buffering).
4.  **`Resampler` Class:** Handles downsampling audio to 16kHz if the input sample rate differs.
5.  **`MP3Processor` (`processMP3File` function):** Utility using the external `lame` tool to decode MP3s, process the audio with `VAD`, and optionally re-encode segments back to MP3.

**Data Flow (`VAD.run`):** Audio Chunk -> Resampler (if needed) -> Frame Processor -> SileroVad (for inference) -> Frame Processor (segment detection logic) -> Output Speech Segments (async generator).

## Configuration Options (`VAD.create` options)

| Option                    | Description                                                             | Default             |
| :------------------------ | :---------------------------------------------------------------------- | :------------------ |
| `modelPath`               | Path to the `silero_vad.onnx` model file.                               | `./silero_vad.onnx` |
| `frameSamples`            | Samples per frame for VAD processing (model-specific).                  | `1536`              |
| `positiveSpeechThreshold` | Confidence threshold above which a frame is considered speech.          | `0.5`               |
| `negativeSpeechThreshold` | Confidence threshold below which a frame is considered silence.         | `0.35`              |
| `redemptionFrames`        | How many consecutive silent frames trigger the end of a speech segment. | `8`                 |
| `minSpeechFrames`         | Minimum consecutive speech frames to form a valid segment.              | `3`                 |
| `preSpeechPadFrames`      | How many frames _before_ speech onset to include in the segment.        | `1`                 |

## Performance Considerations

- The Silero VAD model operates on 16kHz mono audio. The library handles resampling from other sample rates.
- Processing occurs in chunks, making it memory-efficient for large inputs.
- The ONNX Runtime performs the core neural network inference.
- MP3 processing involves external calls to `lame`, adding overhead for decoding/encoding.

## Development / Building Locally

This package includes pre-built JavaScript files in the `dist` directory, which are kept up-to-date automatically via a pre-commit hook using Husky. Consumers installing from GitHub get these files directly.

If you want to clone the repository and make changes to the source code (`src/`):

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/adjustleads/vad-node.git
    cd vad-node
    ```
2.  **Install dependencies (including devDependencies):**
    ```bash
    npm install # or bun install / yarn install
    ```
3.  **Make your changes** to the TypeScript source code in the `src/` directory.
4.  **Commit your changes:** When you run `git commit`, the pre-commit hook configured in `.husky/pre-commit` will automatically:
    - Run the build script (`npm run build` or `bun run build`) using `tsup` to update the `dist` directory with compiled JS and type definitions.
    - Stage the updated `dist` directory (`git add dist`).

This workflow ensures the committed `dist` files always reflect the latest source code changes in `src`.
