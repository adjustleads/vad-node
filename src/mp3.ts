import * as fs from 'fs/promises'
import { spawn } from 'child_process'
import * as path from 'path'
import { VAD, type SpeechSegment, type VADOptions, TARGET_SAMPLE_RATE } from './vad'

/**
 * Options for MP3 processing
 */
export interface ProcessMP3Options extends Partial<VADOptions> {
  /** Whether to save audio segments as files */
  saveFiles?: boolean
  /** Format for saving audio files (default: 'wav') */
  saveFormat?: 'wav' | 'mp3'
  /** Directory to save audio files (defaults to current working directory) */
  outputDir?: string
  /** Prefix for output filenames */
  filePrefix?: string
}

/**
 * Result of processing an MP3 file
 */
export interface ProcessMP3Result {
  /** Detected speech segments */
  segments: SpeechSegment[]
  /** Paths to saved audio files (if saveFiles is true) */
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
  console.log(`Decoding MP3 file: ${mp3Path}`)

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

      // Try to extract sample rate from lame output
      const match = output.match(/(\d+) Hz/)
      if (match && match[1]) {
        sampleRate = parseInt(match[1], 10)
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

      console.log(`Decoded ${mp3Path}: ${floatArray.length} samples, ${sampleRate}Hz`)
      resolve([floatArray, sampleRate])
    })

    lame.on('error', (err) => {
      reject(new Error(`Failed to spawn lame: ${err.message}`))
    })
  })
}

/**
 * Save audio segment to a WAV file
 * @param audio Audio data as Float32Array
 * @param index Segment index
 * @param sampleRate Sample rate in Hz
 * @param options Output options
 * @returns Path to the saved WAV file
 */
export async function saveWavFile(
  audio: Float32Array,
  index: number,
  sampleRate: number,
  options: { outputDir?: string; filePrefix?: string } = {},
): Promise<string> {
  // Convert Float32Array to 16-bit PCM
  const buffer = Buffer.alloc(audio.length * 2)
  for (let i = 0; i < audio.length; i++) {
    // Clamp to [-1.0, 1.0] and convert to 16-bit
    const sample = Math.max(-1.0, Math.min(1.0, audio[i]!))
    buffer.writeInt16LE(Math.floor(sample * 32767), i * 2)
  }

  // Create a simple WAV header
  const header = Buffer.alloc(44)

  // RIFF chunk descriptor
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + buffer.length, 4) // Chunk size
  header.write('WAVE', 8)

  // "fmt " sub-chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // Subchunk1 size (16 for PCM)
  header.writeUInt16LE(1, 20) // Audio format (1 for PCM)
  header.writeUInt16LE(1, 22) // Num channels (1 for mono)
  header.writeUInt32LE(sampleRate, 24) // Sample rate
  header.writeUInt32LE(sampleRate * 2, 28) // Byte rate (SampleRate * NumChannels * BitsPerSample/8)
  header.writeUInt16LE(2, 32) // Block align (NumChannels * BitsPerSample/8)
  header.writeUInt16LE(16, 34) // Bits per sample

  // "data" sub-chunk
  header.write('data', 36)
  header.writeUInt32LE(buffer.length, 40) // Subchunk2 size

  // Combine header and data
  const wavData = Buffer.concat([header, buffer])

  // Determine output directory
  const outputDir = options.outputDir || process.cwd()
  const prefix = options.filePrefix || 'segment'

  // Ensure the output directory exists
  await fs.mkdir(outputDir, { recursive: true })

  // Save to file
  const filename = `${prefix}_${index}.wav`
  const outputPath = path.join(outputDir, filename)
  await fs.writeFile(outputPath, wavData)

  return outputPath
}

/**
 * Save audio segment to an MP3 file using lame
 * @param audio Audio data as Float32Array
 * @param index Segment index
 * @param sampleRate Sample rate in Hz
 * @param options Output options
 * @returns Path to the saved MP3 file
 */
export async function saveMP3File(
  audio: Float32Array,
  index: number,
  sampleRate: number,
  options: { outputDir?: string; filePrefix?: string } = {},
): Promise<string> {
  // Create temporary PCM file
  const tempPcmPath = path.join(
    options.outputDir || process.cwd(),
    `temp_${options.filePrefix || 'segment'}_${index}.pcm`,
  )

  // Determine output directory
  const outputDir = options.outputDir || process.cwd()
  const prefix = options.filePrefix || 'segment'

  // Ensure the output directory exists
  await fs.mkdir(outputDir, { recursive: true })

  // Convert Float32Array to 16-bit PCM buffer
  const buffer = Buffer.alloc(audio.length * 2)
  for (let i = 0; i < audio.length; i++) {
    // Clamp to [-1.0, 1.0] and convert to 16-bit
    const sample = Math.max(-1.0, Math.min(1.0, audio[i]!))
    buffer.writeInt16LE(Math.floor(sample * 32767), i * 2)
  }

  // Write PCM to temporary file
  await fs.writeFile(tempPcmPath, buffer)

  // Prepare MP3 output path
  const outputPath = path.join(outputDir, `${prefix}_${index}.mp3`)

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
      outputPath, // Output file
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
    // Initialize the VAD with provided options
    const vad = await VAD.create(options)

    // Decode the MP3 file
    const [audioData, sampleRate] = await decodeMP3(mp3Path)

    // Process the audio with the VAD
    const startTime = Date.now()
    const segments: SpeechSegment[] = []
    const outputFiles: string[] = []

    // Default to WAV format if not specified
    const saveFormat = options.saveFormat || 'wav'

    // Collect all segments
    for await (const segment of vad.run(audioData, sampleRate)) {
      segments.push(segment)

      // Save audio file if requested
      if (options.saveFiles) {
        let outputPath: string

        // Save file based on selected format
        if (saveFormat === 'mp3') {
          outputPath = await saveMP3File(segment.audio, segments.length, TARGET_SAMPLE_RATE, {
            outputDir: options.outputDir,
            filePrefix: options.filePrefix,
          })
        } else {
          outputPath = await saveWavFile(segment.audio, segments.length, TARGET_SAMPLE_RATE, {
            outputDir: options.outputDir,
            filePrefix: options.filePrefix,
          })
        }

        outputFiles.push(outputPath)
      }
    }

    const processingTime = Date.now() - startTime

    // Return the results
    return {
      segments,
      outputFiles: options.saveFiles ? outputFiles : undefined,
      processingTime,
      audioData,
      sampleRate,
    }
  } catch (error) {
    console.error('Error processing MP3:', error)
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
