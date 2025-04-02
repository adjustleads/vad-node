# Voice Activity Detection (VAD) for Node.js

A Node.js library for Voice Activity Detection using the Silero VAD model.

## Installation

**Note:** This installs directly from the `main` branch on GitHub. This means you get the latest code, but it might not be a stable release.

```bash
# Installs from the main branch and automatically builds the package
npm install adjustleads/vad-node

# Or specify a specific commit or tag if needed
# npm install adjustleads/vad-node#<commit-hash-or-tag>
```

Alternatively, clone the repository and build it yourself (see Development).

## Dependencies

- [onnxruntime-node](https://www.npmjs.com/package/onnxruntime-node): For running the ONNX model
- [lame](http://lame.sourceforge.net/): Required for MP3 processing (must be installed system-wide)

## Basic Usage

```javascript
const fs = require('fs')
const { VAD } = require('@adjustleads/vad-node')

async function detectSpeech() {
  // Create a VAD instance
  const vad = await VAD.create({
    // Optional: Override default options
    positiveSpeechThreshold: 0.6,
    modelPath: 'path/to/silero_vad.onnx', // Default: './silero_vad.onnx'
  })

  // Load audio data (Float32Array)
  // This is a placeholder - you would load your audio data here
  const audioData = new Float32Array(16000 * 5) // 5 seconds of 16kHz audio
  const sampleRate = 44100 // Original sample rate

  // Process audio to detect speech segments
  let segmentCount = 0
  for await (const { audio, start, end } of vad.run(audioData, sampleRate)) {
    segmentCount++
    console.log(`Speech segment ${segmentCount}:`)
    console.log(`- Start: ${start.toFixed(0)}ms`)
    console.log(`- End: ${end.toFixed(0)}ms`)
    console.log(`- Length: ${audio.length} samples`)

    // You can process or save the speech segments here
  }
}

detectSpeech().catch(console.error)
```

## MP3 Processing

The library includes built-in support for processing MP3 files:

```javascript
const { processMP3File, checkLameInstallation } = require('@adjustleads/vad-node')

async function processSpeechInMP3() {
  try {
    // Check if lame is installed (optional)
    await checkLameInstallation()

    // Process an MP3 file and get speech segments
    const result = await processMP3File('path/to/audio.mp3', {
      // VAD options
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.4,

      // MP3 processing options
      saveFiles: true, // Save segments as MP3 files
      outputDir: './segments', // Directory to save MP3 files
      filePrefix: 'speech', // Prefix for MP3 filenames
    })

    // Display results
    console.log(`Found ${result.segments.length} speech segments`)
    console.log(`Processing time: ${result.processingTime}ms`)

    // Each segment has audio data, start and end times
    result.segments.forEach((segment, i) => {
      console.log(`Segment ${i + 1}: ${segment.start.toFixed(0)}ms - ${segment.end.toFixed(0)}ms`)

      // If saveFiles was true, you can access the saved file paths
      if (result.outputFiles) {
        console.log(`  Saved as: ${result.outputFiles[i]}`)
      }
    })
  } catch (error) {
    console.error('Error:', error.message)
  }
}

processSpeechInMP3()
```

## Architecture and Data Flow

The library is designed around a pipeline that processes audio data to detect speech segments. Here's how the components work together:

### 1. VAD

The main entry point that orchestrates the process. It:

- Loads the ONNX model
- Creates a frame processor for speech detection
- Provides a simple API for processing audio

### 2. Silero Model

Handles the Voice Activity Detection using the Silero VAD ONNX model:

- Loads and manages the model
- Processes audio frames to determine speech probabilities
- Maintains internal state for continuous processing

### 3. Frame Processor

The core speech detection logic:

- Accepts audio frames from the resampler
- Runs each frame through the Silero model to get speech probabilities
- Implements the algorithm to detect speech segments using thresholds
- Handles edge cases such as very short speech segments

### 4. Resampler

Converts audio from its native sample rate to the 16kHz required by the Silero model:

- Implements a simple averaging-based downsampling algorithm
- Provides both batch processing and streaming interfaces
- Generates frames of the correct size for model processing

### 5. MP3 Processor

Provides functionality for working with MP3 files:

- Decodes MP3 files using the lame library
- Processes the decoded audio with VAD
- Can save detected speech segments as MP3 files

### Data Flow

1. Audio data flows into the `VAD.run()` method
2. The resampler converts the audio to 16kHz and splits it into frames
3. Each frame is processed by the frame processor, which:
   - Passes the frame to the Silero model
   - Gets speech probabilities back from the model
   - Tracks speech state (speaking/not speaking)
   - Buffers audio during speech detection
4. When speech is detected:
   - A "speech start" event is triggered
   - Frames are accumulated until speech ends
   - When speech ends, a complete segment is returned
5. The caller receives speech segments as they're detected via the async generator

## Configuration Options

### VAD Options

| Option                    | Description                                                 | Default             |
| ------------------------- | ----------------------------------------------------------- | ------------------- |
| `modelPath`               | Path to the Silero VAD ONNX model file                      | `./silero_vad.onnx` |
| `frameSamples`            | Number of audio samples in each frame                       | `1536`              |
| `positiveSpeechThreshold` | Threshold above which a frame is considered speech          | `0.5`               |
| `negativeSpeechThreshold` | Threshold below which a frame is considered not speech      | `0.35`              |
| `redemptionFrames`        | Number of frames to wait before ending speech               | `8`                 |
| `minSpeechFrames`         | Minimum number of speech frames to consider a valid segment | `3`                 |
| `preSpeechPadFrames`      | Number of frames to include before speech start             | `1`                 |
| `submitUserSpeechOnPause` | Whether to submit speech when paused                        | `false`             |

### MP3 Processing Options

| Option       | Description                                  | Default                   |
| ------------ | -------------------------------------------- | ------------------------- |
| `saveFiles`  | Whether to save speech segments as MP3 files | `false`                   |
| `outputDir`  | Directory to save MP3 files                  | Current working directory |
| `filePrefix` | Prefix for MP3 filenames                     | `"segment"`               |

## Performance Considerations

- The Silero VAD model works best with 16kHz mono audio
- Processing is done in chunks, so memory usage is efficient even for large files
- For optimal model performance, use the recommended frame size of 1536 samples
- MP3 processing requires the lame command-line tool to be installed on the system

## Development / Building Locally

This package uses `tsup` for bundling and TypeScript for type checking and declaration generation. To use the latest code or make local changes:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/adjustleads/vad-node.git
    cd vad-node
    ```
2.  **Install dependencies:**
    ```bash
    npm install # or bun install
    ```
3.  **Run the build script:**
    ```bash
    npm run build # or bun run build
    ```

This will generate the `dist` folder containing the CommonJS (`.js`), ES Module (`.mjs`), and TypeScript declaration (`.d.ts`) files, ready for local use or for consumers who clone the repository.
