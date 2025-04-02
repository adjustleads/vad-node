import * as fs from 'fs/promises'
import { spawn } from 'child_process'
import * as path from 'path'
import { VAD, processMP3File, checkLameInstallation } from '../src'

/**
 * Process an MP3 file with direct VAD usage
 * Demonstrates low-level control over the VAD process
 * @param mp3Path Path to the MP3 file
 */
async function processWithDirectVAD(mp3Path: string): Promise<void> {
  try {
    // Initialize the VAD
    console.log('--- Direct VAD approach ---')
    console.log('Initializing VAD...')
    const vad = await VAD.create({
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
 * Process an MP3 file with the simplified helper function
 * Demonstrates the easier high-level approach
 * @param mp3Path Path to the MP3 file
 */
async function processWithHelper(mp3Path: string): Promise<void> {
  try {
    console.log('\n--- Helper function approach ---')
    console.log('Processing MP3 file...')

    // Process the MP3 file with our helper function
    const result = await processMP3File(mp3Path, {
      // VAD options
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.3,

      // MP3 processing options
      saveWavFiles: true,
      outputDir: path.join(process.cwd(), 'output'),
      filePrefix: 'speech',
    })

    // Display results
    console.log(`Found ${result.segments.length} speech segments`)
    console.log(`Processing time: ${result.processingTime}ms`)

    // Show information about each segment
    result.segments.forEach((segment, i) => {
      const durationMs = segment.end - segment.start
      console.log(
        `Speech segment ${i + 1}: Start=${segment.start.toFixed(0)}ms, End=${segment.end.toFixed(0)}ms, Duration=${durationMs.toFixed(0)}ms, Samples=${segment.audio.length}`,
      )

      if (result.wavFiles) {
        console.log(`  Saved as: ${result.wavFiles[i]}`)
      }
    })
  } catch (error) {
    console.error('Error processing MP3:', error)
  }
}

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

// Main function to run both approaches
async function main(mp3Path: string) {
  try {
    // Check if lame is installed
    await checkLameInstallation()

    // Run both approaches
    // await processWithDirectVAD(mp3Path)
    await processWithHelper(mp3Path)

    console.log('\nAll tests completed successfully')
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Run the test if this file is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  // Make sure to provide a path to an MP3 file
  const mp3Path = process.argv[2]
  if (!mp3Path) {
    console.error('Please provide a path to an MP3 file')
    console.error('Usage: node test/mp3-testing.js path/to/audio.mp3')
    process.exit(1)
  }

  main(mp3Path).catch((error) => {
    console.error('Uncaught error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
