// bun test/mp3-testing.ts test/data/test.mp3

import * as path from 'path'
import { processMP3File, checkLameInstallation, processMP3Segments } from '../src'

/**
 * Process an MP3 file with the VAD function and then extract/save segments.
 * @param mp3Path Path to the input MP3 file
 */
async function processAndSaveSegments(mp3Path: string): Promise<void> {
  try {
    console.log('\n--- VAD + Segment Extraction Approach ---')
    console.log('Processing MP3 file for VAD...')

    // 1. Run VAD to get speech segments
    const vadResult = await processMP3File(mp3Path, {
      // VAD options (can be adjusted)
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35, // Example: use default or adjust
    })

    // Display VAD results
    console.log(`Found ${vadResult.segments.length} speech segments (VAD only)`) // Updated log
    console.log(`VAD processing time: ${vadResult.processingTime}ms`) // Updated log

    // Show information about each detected segment
    vadResult.segments.forEach((segment, i) => {
      const durationMs = segment.end - segment.start
      console.log(
        `Speech segment ${i + 1}: Start=${segment.start.toFixed(0)}ms, End=${segment.end.toFixed(0)}ms, Duration=${durationMs.toFixed(0)}ms`,
      )
    })

    if (vadResult.segments.length === 0) {
      console.log('No speech segments detected, skipping segment extraction.')
      return
    }

    // 2. Extract segments, add padding, and save to a new file
    const outputPath = path.join(process.cwd(), 'output', 'processed_speech.mp3')
    console.log(`\nExtracting segments and saving to: ${outputPath}`) // Log output path

    // Prepare segments in milliseconds for processMP3Segments (already in ms from VAD)
    const segmentsToExtract = vadResult.segments.map((seg) => ({
      start: seg.start, // Already in milliseconds
      end: seg.end, // Already in milliseconds
    }))

    await processMP3Segments(
      mp3Path, // Input file
      outputPath, // Output file
      segmentsToExtract, // Segments to extract (start/end in ms)
      500, // Padding in milliseconds (default)
    )

    console.log('Segments extracted, padded, and saved successfully.')
  } catch (error) {
    console.error('Error processing MP3:', error)
  }
}

// Main function to run the test
async function main(mp3Path: string) {
  try {
    // Check if lame is installed
    await checkLameInstallation()

    // Run the combined VAD + extraction test
    await processAndSaveSegments(mp3Path)

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
