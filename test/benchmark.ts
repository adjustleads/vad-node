import * as path from 'path'
import { VAD } from '../src/vad'
import { decodeMP3 } from '../src/mp3'
import { logger } from '../src/logger'

// Configuration
const mp3Path = path.join(process.cwd(), 'test/data/test_disturbed.mp3')
const modelPath = path.join(process.cwd(), 'silero_vad.onnx')
const numberOfRuns = 10

/**
 * Runs the VAD benchmark
 */
async function runBenchmark() {
  logger.log('--- VAD Benchmark ---')
  logger.log(`Model: ${modelPath}`)
  logger.log(`Audio File: ${mp3Path}`)
  logger.log(`Number of Runs: ${numberOfRuns}`)

  try {
    // 1. Load MP3 file
    logger.log('Loading MP3 file...')
    const [audioData, sampleRate] = await decodeMP3(mp3Path)
    logger.log(`MP3 loaded: ${audioData.length} samples, ${sampleRate}Hz`)

    // 2. Load VAD model
    logger.log('Loading VAD model...')
    // Use default VAD options, but ensure the model path is correct
    const vad = await VAD.create({ modelPath: modelPath })
    logger.log('VAD model loaded.')

    // 3. Run benchmark
    const timings: number[] = []
    logger.log(`Starting ${numberOfRuns} benchmark runs...`)

    for (let i = 0; i < numberOfRuns; i++) {
      const startTime = performance.now()

      // Run VAD and consume the async generator fully
      // We don't need the segments themselves, just the time it takes to process
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _segment of vad.run(audioData, sampleRate)) {
        // Looping through consumes the generator
      }

      const endTime = performance.now()
      const duration = endTime - startTime
      timings.push(duration)
      logger.log(`Run ${i + 1}/${numberOfRuns} completed in ${duration.toFixed(2)}ms`)
    }

    // 4. Calculate and display results
    const totalTime = timings.reduce((sum, time) => sum + time, 0)
    const meanTime = totalTime / numberOfRuns

    logger.log('--- Benchmark Results ---')
    logger.log(`Total time for ${numberOfRuns} runs: ${totalTime.toFixed(2)}ms`)
    logger.log(`Mean processing time per run: ${meanTime.toFixed(2)}ms`)
  } catch (error) {
    logger.error('Benchmark failed:')
    logger.error(error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.stack) {
      logger.error(error.stack)
    }
    process.exit(1)
  }
}

// Run the benchmark if this file is executed directly
const isMainModule =
  import.meta.url.startsWith('file://') && process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))

if (isMainModule) {
  runBenchmark().catch((error) => {
    logger.error('Unhandled error during benchmark execution:')
    logger.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

// RESULTS

// Pyannote speed multiplier: 48x
// Silero speed multiplier: 475x

// Speed difference is 10x between the two
