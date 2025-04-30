import * as path from 'path'
import { processMP3File, checkLameInstallation } from '../src'

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
      modelPath: path.join(process.cwd(), 'pyannote.onnx'),
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.3,
      // MP3 processing options
      saveFiles: true,
      mergeOutputChunks: true,
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

      if (result.outputFiles) {
        console.log(`  Saved as: ${result.outputFiles[i]}`)
      }
    })
  } catch (error) {
    console.error('Error processing MP3:', error)
  }
}

// Main function to run both approaches
async function main(mp3Path: string) {
  try {
    // Check if lame is installed
    await checkLameInstallation()

    // run helper function
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
