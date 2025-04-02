import * as fs from 'fs/promises'
import { spawn } from 'child_process'
import * as path from 'path'
import { NonRealTimeVAD } from '../src'

/**
 * Decode an MP3 file to PCM audio using lame
 * @param mp3Path Path to the MP3 file
 * @returns Promise containing [audioData, sampleRate]
 */
async function decodeMP3(mp3Path: string): Promise<[Float32Array, number]> {
  console.log(`Decoding MP3 file: ${mp3Path}`)

  // First check if the file exists
  try {
    await fs.access(mp3Path)
  } catch (err) {
    throw new Error(`MP3 file not found: ${mp3Path}`)
  }

  return new Promise((resolve, reject) => {
    // Use lame to decode MP3 to 16-bit signed little-endian PCM
    console.log(`Spawning lame with file: ${mp3Path}`)
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
      console.log(`lame stderr: ${output}`)

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
 * Process an MP3 file with the VAD
 * @param mp3Path Path to the MP3 file
 */
async function processMP3WithVAD(mp3Path: string): Promise<void> {
  try {
    // Initialize the VAD
    console.log('Initializing VAD...')
    const vad = await NonRealTimeVAD.new({
      // Optional VAD parameters can be set here
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.3,
    })
    console.log('VAD initialized')

    // Decode the MP3 file
    const [audioData, sampleRate] = await decodeMP3(mp3Path)

    // Process the audio with the VAD
    console.log('Processing audio with VAD...')
    const startTime = Date.now()
    let segmentCount = 0

    for await (const { audio, start, end } of vad.run(audioData, sampleRate)) {
      segmentCount++
      const durationMs = end - start
      console.log(
        `Speech segment ${segmentCount}: Start=${start.toFixed(0)}ms, End=${end.toFixed(0)}ms, Duration=${durationMs.toFixed(0)}ms, Samples=${audio.length}`,
      )

      // Optionally save the audio segment to a file
      // await saveAudioSegment(audio, segmentCount, sampleRate)
    }

    const processingTime = Date.now() - startTime
    console.log(`VAD processing complete. Found ${segmentCount} speech segments in ${processingTime}ms`)
  } catch (error) {
    console.error('Error processing MP3:', error)
  }
}

/**
 * Optional: Save an audio segment to a WAV file
 */
async function saveAudioSegment(audio: Float32Array, index: number, sampleRate: number): Promise<void> {
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

  // Save to file
  const outputPath = path.join(process.cwd(), `segment_${index}.wav`)
  await fs.writeFile(outputPath, wavData)
  console.log(`Saved audio segment to ${outputPath}`)
}

// Run the test if this file is executed directly
// Use import.meta approach for ES modules
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  // Make sure to provide a path to an MP3 file
  const mp3Path = process.argv[2]
  if (!mp3Path) {
    console.error('Please provide a path to an MP3 file')
    console.error('Usage: node test/mp3.js path/to/audio.mp3')
    process.exit(1)
  }

  // Check if lame is installed
  spawn('lame', ['--version']).on('error', () => {
    console.error('Error: lame is not installed or not in PATH')
    console.error('Please install lame (e.g., brew install lame on macOS)')
    process.exit(1)
  })

  processMP3WithVAD(mp3Path).catch((error) => {
    console.error('Error processing MP3:', error)
    process.exit(1)
  })
}
