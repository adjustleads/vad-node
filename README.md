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
- **[lame](http://lame.sourceforge.net/):** Required if you use the MP3 processing functions (`processMP3File` or `processMP3Segments`). It must be installed system-wide (e.g., via `apt install lame`, `brew install lame`).

Ensure you install the peer dependency:

```bash
npm install onnxruntime-node
```

## Basic Usage (VAD Only)

This example shows how to use the core VAD functionality to detect speech segments in audio data (represented as a `Float32Array`).

```javascript
const { VAD } = require('adjustleads-vad-node') // Use the package name as defined in package.json
const fs = require('fs') // Example for loading audio data

async function detectSpeech() {
  try {
    // Create a VAD instance with default or custom options
    const vad = await VAD.create({
      modelPath: 'node_modules/adjustleads-vad-node/silero_vad.onnx', // Default path relative to execution
      // Optional VAD parameter overrides:
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
    for await (const { start, end } of vad.run(audioData, originalSampleRate)) {
      segmentCount++
      console.log(`
Speech Segment ${segmentCount}:`)
      console.log(` - Start Time: ${start.toFixed(0)} ms`)
      console.log(` - End Time: ${end.toFixed(0)} ms`)
      // 'start' and 'end' provide the timestamps for the detected speech segment.
      // The raw audio for the segment is not included here.
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

## MP3 Processing Utilities

The library includes utility functions to process MP3 files directly, provided `lame` is installed on your system.

### 1. Detecting Speech Segments in MP3 (`processMP3File`)

This function decodes an MP3, runs VAD, and returns the detected speech segment _timestamps_ along with the original audio data and sample rate. It **does not** save any files itself.

```javascript
const { processMP3File, checkLameInstallation } = require('adjustleads-vad-node')

async function findSpeechInMP3() {
  const mp3FilePath = 'path/to/your/audio.mp3' // Specify the path to your MP3 file

  try {
    // 1. Check if lame is installed (recommended)
    await checkLameInstallation()
    console.log('LAME installation confirmed.')

    // 2. Process the MP3 file to find speech segments
    console.log(`Processing MP3 for VAD: ${mp3FilePath}`)
    const result = await processMP3File(mp3FilePath, {
      // Optional: Override VAD parameters if needed
      // positiveSpeechThreshold: 0.6,
    })

    // 3. Display results
    console.log(`
Processing complete. Found ${result.segments.length} speech segments.`)
    console.log(`Total VAD processing time: ${result.processingTime} ms`)
    console.log(`Original Sample Rate: ${result.sampleRate} Hz`)

    result.segments.forEach((segment, i) => {
      console.log(` - Segment ${i + 1}: ${segment.start.toFixed(0)}ms - ${segment.end.toFixed(0)}ms`)
      // The VAD process only returns start/end timestamps now.
      // The full audio data is available in result.audioData if needed.
    })

    // The full decoded audio is available if needed:
    // console.log('Full audio data length:', result.audioData.length);
  } catch (error) {
    console.error('\nError during MP3 VAD processing:', error.message)
    if (error.message.includes('lame')) {
      console.error("Ensure 'lame' is installed and accessible in your system's PATH.")
    }
  }
}

findSpeechInMP3()
```

### 2. Extracting, Padding, and Saving MP3 Segments (`processMP3Segments`)

This function takes an input MP3, a list of start/end timestamps (in **milliseconds**), extracts those segments, adds padding, concatenates them, and saves the result as a new MP3 file using the **original sample rate**.

```javascript
const { processMP3Segments, checkLameInstallation } = require('adjustleads-vad-node')
const path = require('path')

async function extractAndSaveSegments() {
  const inputMp3Path = 'path/to/your/input.mp3'
  const outputMp3Path = 'path/to/your/output_segments.mp3'

  // Define the segments you want to extract (start and end times in **milliseconds**)
  const segmentsToExtract = [
    { start: 10500, end: 15200 }, // Example: 10500ms to 15200ms
    { start: 22000, end: 25800 }, // Example: 22000ms to 25800ms
    // Add more segments as needed
  ]

  // Optional: Specify padding in milliseconds (default is 500ms)
  const paddingMs = 500

  try {
    // 1. Check if lame is installed (required)
    await checkLameInstallation()
    console.log('LAME installation confirmed.')

    // 2. Process the segments
    console.log(`Extracting segments from ${inputMp3Path}...`)
    await processMP3Segments(inputMp3Path, outputMp3Path, segmentsToExtract, paddingMs)

    console.log(`\nSegments extracted, padded, and saved to: ${outputMp3Path}`)
  } catch (error) {
    console.error('\nError processing MP3 segments:', error.message)
    if (error.message.includes('lame')) {
      console.error("Ensure 'lame' is installed and accessible in your system's PATH.")
    }
  }
}

extractAndSaveSegments()
```

**Combining VAD and Segment Extraction:**

You can combine these two functions. First, use `processMP3File` to get the speech segment timestamps (in milliseconds). Then, pass these timestamps **directly** to `processMP3Segments` to create the final padded MP3 file.

```javascript
// (Inside an async function after running processMP3File as in the first MP3 example)

// ... assume 'vadResult' contains the output from processMP3File

if (vadResult.segments.length > 0) {
  const outputFilePath = 'path/to/final_speech.mp3'
  // Timestamps from vadResult.segments are already in milliseconds
  const segmentsInMilliseconds = vadResult.segments // No conversion needed

  console.log('\nSaving detected speech segments with padding...')
  try {
    await processMP3Segments(
      mp3FilePath, // Original input path used for VAD
      outputFilePath,
      segmentsInMilliseconds, // Pass timestamps in ms
    )
    console.log(`Combined speech saved to ${outputFilePath}`)
  } catch (saveError) {
    console.error('Error saving segments:', saveError.message)
  }
}
```

## Architecture Overview

The library uses the following main components:

1.  **`VAD` Class:** Main entry point for VAD. Manages configuration and orchestrates the processing pipeline.
2.  **`Silero` Class:** Wraps the ONNX runtime session, loads the `silero_vad.onnx` model, and performs inference on audio frames.
3.  **`FrameProcessor` Class:** Takes audio chunks, applies the core VAD logic (thresholding, silence detection, segment buffering) based on model output.
4.  **`Resampler` Class:** Handles downsampling audio to 16kHz (required by the model) if the input sample rate differs.
5.  **MP3 Utilities (`src/mp3.ts`):**
    - `decodeMP3`: Uses external `lame` tool to decode MP3 to raw PCM (`Float32Array`).
    - `saveMP3File`: Uses external `lame` to encode raw PCM (`Float32Array`) to MP3.
    - `processMP3File`: Combines `decodeMP3` and `VAD.run` to find speech segment _timestamps_ in an MP3.
    - `processMP3Segments`: Combines `decodeMP3`, segment slicing/padding (using the original audio data), and `saveMP3File` to create a new MP3 from specified time segments.

**Data Flow (`VAD.run`):** Audio Chunk -> Resampler (if needed) -> Frame Processor -> Silero (for inference) -> Frame Processor (segment detection logic) -> Output Speech Segment Timestamps (`{start, end}`) (async generator).

**Data Flow (`processMP3Segments`):** Input MP3 Path -> `decodeMP3` -> Slice/Pad Audio Data -> `saveMP3File` -> Output MP3 Path.

## Configuration Options (`VAD.create` options)

These options apply to the core VAD logic used by both `VAD.run` and `processMP3File`.

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

- The Silero VAD model operates on 16kHz mono audio. The library handles resampling from other sample rates for VAD.
- MP3 processing (`decodeMP3`, `saveMP3File`, `processMP3Segments`) involves external calls to `lame`, adding overhead.
- `processMP3Segments` saves the output MP3 using the _original sample rate_ of the input file.
- VAD processing occurs in chunks, making it memory-efficient for large inputs.
- The ONNX Runtime performs the core neural network inference for VAD.

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
