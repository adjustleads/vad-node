import * as fs from 'fs/promises'
import { spawn } from 'child_process'
import * as path from 'path'
import { VAD, type SpeechSegment, type VADOptions, TARGET_SAMPLE_RATE } from './vad'
import { logger } from './logger'

/**
 * Options for MP3 processing
 */
export interface ProcessMP3Options extends Partial<VADOptions> {
  /** Whether to save audio segments as MP3 files */
  saveFiles?: boolean
  /** Directory to save MP3 files (defaults to current working directory) */
  outputDir?: string
  /** Prefix for MP3 filenames */
  filePrefix?: string
  /** Optional pre-initialized VAD instance */
  vadInstance?: VAD
  /** Merge all output segments into a single file with padding (requires saveFiles=true) */
  mergeOutputChunks?: boolean
}

/**
 * Result of processing an MP3 file
 */
export interface ProcessMP3Result {
  /** Detected speech segments */
  segments: SpeechSegment[]
  /** Paths to saved MP3 files (if saveFiles is true) */
  outputFiles?: string[]
  /** Total processing time in milliseconds */
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
 * @param options Output options
 * @returns Path to the saved MP3 file
 */
export async function saveMP3File(
  audio: Float32Array,
  sampleRate: number,
  options: {
    outputDir?: string
    filePrefix?: string
    index?: number
    outputFilename?: string
  } = {},
): Promise<string> {
  // Determine output directory and ensure it exists
  const outputDir = options.outputDir || process.cwd()
  await fs.mkdir(outputDir, { recursive: true })

  // Determine output filename
  const filename = options.outputFilename
    ? options.outputFilename
    : `${options.filePrefix || 'segment'}_${options.index ?? 0}.mp3`
  const outputPath = path.join(outputDir, filename)

  // Create temporary PCM file path based on the final filename to avoid collisions
  const tempPcmPath = path.join(outputDir, `temp_${path.parse(filename).name}.pcm`)

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
      outputPath, // Output file (using the determined filename)
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
 * Process an MP3 file with the VAD
 *
 * @param mp3Path Path to the MP3 file
 * @param options Processing options
 * @returns Promise with processing results
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
    const outputFiles: string[] = []
    const allAudioSegments: Float32Array[] = [] // For merging

    // Collect all segments
    for await (const segment of vad.run(audioData, detectedSampleRate)) {
      segments.push(segment)

      // Handle saving files based on options
      if (options.saveFiles) {
        if (options.mergeOutputChunks) {
          allAudioSegments.push(segment.audio) // Collect audio for merging
        } else {
          // Save individually
          const outputPath = await saveMP3File(
            segment.audio,
            TARGET_SAMPLE_RATE, // VAD output is resampled
            {
              outputDir: options.outputDir,
              filePrefix: options.filePrefix,
              index: segments.length, // Pass index for default naming
            },
          )
          outputFiles.push(outputPath)
        }
      }
    }

    // Save merged file if requested and segments exist
    if (options.saveFiles && options.mergeOutputChunks && allAudioSegments.length > 0) {
      // Calculate padding samples (500ms at VAD target rate)
      const paddingDurationSeconds = 0.5
      const paddingSamples = Math.floor(paddingDurationSeconds * TARGET_SAMPLE_RATE)
      const silencePadding = new Float32Array(paddingSamples).fill(0)

      // Calculate total length including padding
      let totalLength = 0
      allAudioSegments.forEach((segment) => {
        totalLength += segment.length
      })
      totalLength += Math.max(0, allAudioSegments.length - 1) * paddingSamples

      // Concatenate segments with padding
      const mergedAudio = new Float32Array(totalLength)
      let currentOffset = 0
      allAudioSegments.forEach((segment, index) => {
        mergedAudio.set(segment, currentOffset)
        currentOffset += segment.length
        if (index < allAudioSegments.length - 1) {
          mergedAudio.set(silencePadding, currentOffset)
          currentOffset += paddingSamples
        }
      })

      // Save the merged file
      const mergedFilename = `${options.filePrefix || 'merged_output'}.mp3`
      const mergedOutputPath = await saveMP3File(
        mergedAudio,
        TARGET_SAMPLE_RATE, // VAD output rate
        {
          outputDir: options.outputDir,
          outputFilename: mergedFilename, // Use specific filename
        },
      )
      outputFiles.push(mergedOutputPath) // Add the single merged file path
    }

    const processingTime = Date.now() - startTime

    // Return the results
    return {
      segments,
      outputFiles: options.saveFiles ? outputFiles : undefined, // Contains single or multiple paths
      processingTime,
      audioData,
      sampleRate: detectedSampleRate,
    }
  } catch (error) {
    logger.error('Error processing MP3:', error)
    throw error
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
