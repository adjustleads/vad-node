import * as fs from 'fs/promises'
import { spawn } from 'child_process'
import * as path from 'path'
import { VAD, type SpeechSegment, type VADOptions, TARGET_SAMPLE_RATE } from './vad'
import { logger } from './logger'

/**
 * Options for VAD processing of MP3s (no file saving)
 */
export interface ProcessMP3Options extends Partial<VADOptions> {
  /** Optional pre-initialized VAD instance */
  vadInstance?: VAD
}

/**
 * Result of processing an MP3 file for VAD (no file saving)
 */
export interface ProcessMP3Result {
  /** Detected speech segments (only start and end times) */
  segments: SpeechSegment[]
  /** Total VAD processing time in milliseconds */
  processingTime: number
  /** Original audio data */
  audioData: Float32Array
  /** Original sample rate */
  sampleRate: number
}

/**
 * Decode an MP3 file to PCM audio using lame
 * @param mp3Path Path to the MP3 file
 * @returns Promise containing [audioData, sampleRate]
 */
export async function decodeMP3(mp3Path: string): Promise<[Float32Array, number]> {
  logger.log(`Decoding MP3 file: ${mp3Path}`)

  // First check if the file exists
  try {
    await fs.access(mp3Path)
  } catch (err) {
    throw new Error(`MP3 file not found: ${mp3Path}`)
  }

  return new Promise((resolve, reject) => {
    // Use lame to decode MP3 to 16-bit signed little-endian PCM
    const lame = spawn('lame', [
      '--decode', // Decode mode
      '-t', // Don't output progress (silent)
      mp3Path, // Input file
      '-', // Output to stdout
      '--little-endian', // Output as little-endian
      '--signed', // Output as signed
      '--bitwidth',
      '16', // 16-bit PCM
    ])

    const chunks: Buffer[] = []
    let sampleRate = 44100 // Default, will be detected later
    let stderrOutput = ''

    lame.stdout.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
    })

    lame.stderr.on('data', (data) => {
      const output = data.toString()
      stderrOutput += output

      // Try to extract sample rate from lame output, e.g., "(44.1 kHz,..." or "(22.05 kHz,..."
      const match = output.match(/\((\d+(?:\.\d+)?)\s+kHz/)
      if (match && match[1]) {
        const kHzValue = parseFloat(match[1])
        sampleRate = Math.round(kHzValue * 1000) // Convert kHz to Hz
      }
    })

    lame.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`lame exited with code ${code}. stderr: ${stderrOutput}`))
      }

      // Check if we have any data
      if (chunks.length === 0) {
        return reject(new Error('No audio data received from lame'))
      }

      // Combine all chunks into a single buffer
      const buffer = Buffer.concat(chunks)

      // Convert 16-bit PCM to Float32Array
      const floatArray = new Float32Array(buffer.length / 2)
      for (let i = 0; i < floatArray.length; i++) {
        // Read 16-bit value and normalize to [-1.0, 1.0]
        floatArray[i] = buffer.readInt16LE(i * 2) / 32768.0
      }

      logger.log(`Decoded ${mp3Path}: ${floatArray.length} samples, ${sampleRate}Hz`)
      resolve([floatArray, sampleRate])
    })

    lame.on('error', (err) => {
      reject(new Error(`Failed to spawn lame: ${err.message}`))
    })
  })
}

/**
 * Save audio segment to an MP3 file using lame
 * @param audio Audio data as Float32Array
 * @param sampleRate Sample rate in Hz
 * @param outputPath Full path for the output MP3 file
 * @returns Path to the saved MP3 file
 */
export async function saveMP3File(audio: Float32Array, sampleRate: number, outputPath: string): Promise<string> {
  // Ensure output directory exists
  const outputDir = path.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })

  // Create temporary PCM file path based on the final filename to avoid collisions
  const tempPcmPath = path.join(outputDir, `temp_${path.parse(outputPath).name}.pcm`)

  // Convert Float32Array to 16-bit PCM buffer
  const buffer = Buffer.alloc(audio.length * 2)
  for (let i = 0; i < audio.length; i++) {
    // Clamp to [-1.0, 1.0] and convert to 16-bit
    const sample = Math.max(-1.0, Math.min(1.0, audio[i]!))
    buffer.writeInt16LE(Math.floor(sample * 32767), i * 2)
  }

  // Write PCM to temporary file
  await fs.writeFile(tempPcmPath, buffer)

  // Use lame to convert PCM to MP3
  return new Promise((resolve, reject) => {
    const lame = spawn('lame', [
      '-r', // Input is raw PCM
      '--little-endian', // Input is little-endian
      '--signed', // Input is signed
      '--bitwidth',
      '16', // Input is 16-bit
      '-s',
      sampleRate.toString(), // Input sample rate
      '-m',
      'm', // Mono mode
      '-q',
      '4', // Quality setting
      tempPcmPath, // Input file
      outputPath, // Output file (using the full path)
    ])

    lame.on('close', async (code) => {
      try {
        // Clean up temporary PCM file
        await fs.unlink(tempPcmPath)

        if (code === 0) {
          resolve(outputPath)
        } else {
          reject(new Error(`lame encoder exited with code ${code}`))
        }
      } catch (err) {
        reject(err)
      }
    })

    lame.on('error', (err) => {
      reject(new Error(`Failed to encode MP3: ${err.message}`))
    })
  })
}

/**
 * Process an MP3 file with the VAD (does not save files)
 *
 * @param mp3Path Path to the MP3 file
 * @param options Processing options
 * @returns Promise with processing results (segments, times, audio data, sample rate)
 */
export async function processMP3File(mp3Path: string, options: ProcessMP3Options = {}): Promise<ProcessMP3Result> {
  try {
    // Use provided VAD instance or create a new one
    const vad = options.vadInstance || (await VAD.create(options))

    // Decode the MP3 file
    const [audioData, detectedSampleRate] = await decodeMP3(mp3Path)

    // Process the audio with the VAD
    const startTime = Date.now()
    const segments: SpeechSegment[] = []

    // Collect all segments (only start and end times)
    for await (const segment of vad.run(audioData, detectedSampleRate)) {
      segments.push(segment)
    }

    const processingTime = Date.now() - startTime

    // Return the results (without output file paths)
    return {
      segments,
      processingTime,
      audioData,
      sampleRate: detectedSampleRate,
    }
  } catch (error) {
    logger.error('Error processing MP3 for VAD:', error)
    throw error
  }
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
 * Extracts specific segments from an MP3, adds padding, and saves as a new MP3.
 * @param inputPath Path to the input MP3 file.
 * @param outputPath Path to save the resulting MP3 file.
 * @param segments Array of { start: number, end: number } timestamps in seconds.
 * @param paddingMs Padding duration in milliseconds to add at the start, end, and between segments. Default is 500ms.
 * @returns Promise that resolves when the file is saved.
 */
export async function processMP3Segments(
  inputPath: string,
  outputPath: string,
  segments: { start: number; end: number }[],
  paddingMs: number = 500,
): Promise<void> {
  try {
    // Decode the input MP3
    const [audioData, sampleRate] = await decodeMP3(inputPath)
    logger.log(`Input MP3 decoded: ${audioData.length} samples, ${sampleRate}Hz`)

    // Calculate padding samples based on the *original* sample rate
    const paddingDurationSeconds = paddingMs / 1000
    const paddingSamples = Math.floor(paddingDurationSeconds * sampleRate)
    const silencePadding = new Float32Array(paddingSamples).fill(0)

    const audioChunks: Float32Array[] = []

    // Add initial padding
    audioChunks.push(silencePadding)

    // Extract and add segments with intermediate padding
    segments.forEach((segment, index) => {
      const startSample = Math.floor(segment.start * sampleRate)
      const endSample = Math.floor(segment.end * sampleRate)

      if (startSample >= endSample || endSample > audioData.length || startSample < 0) {
        logger.error(
          `Invalid segment timestamp: start=${segment.start}s (${startSample}), end=${segment.end}s (${endSample}). Max samples: ${audioData.length}. Skipping segment.`,
        )
        return // Skip invalid segment
      }

      // Note: audioSegment is Float32Array, but SpeechSegment no longer holds audio data.
      // The VAD result provides start/end times, which we use here.
      const audioSegment = audioData.slice(startSample, endSample)
      audioChunks.push(audioSegment)

      // Add padding between segments (but not after the last one)
      if (index < segments.length - 1) {
        audioChunks.push(silencePadding)
      }
    })

    // Add final padding
    audioChunks.push(silencePadding)

    // Check if any valid chunks were added
    if (audioChunks.length <= 2) {
      // Only initial and final padding means no valid segments
      throw new Error('No valid audio segments found to process.')
    }

    // Concatenate all chunks (padding + segments + padding)
    const mergedAudio = concatArrays(audioChunks)
    logger.log(`Merged audio created: ${mergedAudio.length} samples`)

    // Save the final merged audio using the original sample rate
    await saveMP3File(mergedAudio, sampleRate, outputPath)
    logger.log(`Output MP3 saved to: ${outputPath}`)
  } catch (error) {
    logger.error(`Error processing MP3 segments for ${inputPath}:`, error)
    throw error // Re-throw the error for the caller
  }
}

/**
 * Checks if lame is installed and available
 * @returns Promise that resolves if lame is available, rejects otherwise
 */
export function checkLameInstallation(): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn('lame', ['--version'])

    process.on('error', () => {
      reject(
        new Error(
          'Error: lame is not installed or not in PATH. Please install lame for MP3 encoding/decoding (e.g., brew install lame on macOS)',
        ),
      )
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`lame command exited with code ${code}`))
      }
    })
  })
}
