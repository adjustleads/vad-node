import { processMP3File } from './src'
import { Resampler } from './src/resampler'
import { AutoModelForAudioFrameClassification, AutoProcessor } from '@huggingface/transformers'

/**
 * Post-process segmentation logits into VAD segments.
 *
 * @param {Object} logits
 *   - .dims: [1, numFrames, numClasses]
 *   - .data: Float32Array of length numFrames * numClasses
 * @param {number} audioLength
 *   Number of audio samples (e.g. resampledAudioDataArray.length).
 * @param {Object} [opts]
 * @param {number} [opts.sampleRate=16000]
 * @param {number} [opts.onset=0.767]
 * @param {number} [opts.offset=0.377]
 * @param {number} [opts.minDurationOn=0.136]
 * @param {number} [opts.minDurationOff=0.067]
 *
 * @returns {Array<Object>}
 *   Each object has { start, end, id, confidence }.
 */
function postProcessVAD(
  logits: { dims: number[]; data: Float32Array },
  audioLength: number,
  { sampleRate = 16000, onset = 0.767, offset = 0.377, minDurationOn = 0.136, minDurationOff = 0.067 } = {},
) {
  const [, numFrames, numClasses] = logits.dims
  const data = logits.data

  // 1️⃣ collapse logits → per-frame score (sigmoid of max logit)
  const frameScores = new Float32Array(numFrames)
  for (let t = 0; t < numFrames; t++) {
    let maxLogit = -Infinity
    for (let c = 0; c < numClasses; c++) {
      const idx = t * numClasses + c
      if (data[idx] > maxLogit) maxLogit = data[idx]
    }
    // convert to probability
    frameScores[t] = 1 / (1 + Math.exp(-maxLogit))
  }

  // 2️⃣ determine frameDuration (in seconds)
  const totalSeconds = audioLength / sampleRate
  const frameDuration = totalSeconds / numFrames

  // 3️⃣ hysteresis thresholding → raw segments
  const raw = []
  let inSpeech = false,
    startFrame = 0
  for (let t = 0; t < numFrames; t++) {
    const p = frameScores[t]
    if (!inSpeech && p >= onset) {
      inSpeech = true
      startFrame = t
    } else if (inSpeech && p < offset) {
      inSpeech = false
      raw.push({ start: startFrame, end: t })
    }
  }
  if (inSpeech) raw.push({ start: startFrame, end: numFrames })

  // 4️⃣ apply duration constraints (min on / fill off)
  // 4a. filter out too-short speech segments
  let filtered = raw.filter((seg) => (seg.end - seg.start) * frameDuration >= minDurationOn)
  // 4b. merge small gaps
  const merged = []
  for (const seg of filtered) {
    if (!merged.length) {
      merged.push(seg)
      continue
    }
    const prev = merged[merged.length - 1]
    const gap = (seg.start - prev.end) * frameDuration
    if (gap <= minDurationOff) {
      // fill the gap
      prev.end = seg.end
    } else {
      merged.push(seg)
    }
  }

  // 5️⃣ compute final segments with confidence
  return merged.map(({ start, end }) => {
    const slice = frameScores.subarray(start, end)
    const avgConfidence = slice.reduce((sum, v) => sum + v, 0) / slice.length
    return {
      start: start * frameDuration,
      end: end * frameDuration,
      id: 0, // only one class (SPEECH)
      confidence: avgConfidence,
    }
  })
}

// modelPath: string = 'onnx-community/pyannote-segmentation-3.0',
async function runVAD(modelPath: string = './pyannote-onnx', wavPath: string = './test/data/test.mp3') {
  // 1️⃣  Decode the WAV file into a Float32Array
  const { sampleRate, audioData } = await processMP3File(wavPath)

  const processor = await AutoProcessor.from_pretrained(modelPath, {
    sampleRate,
    channels: 1,
    feature_extractor_type: 'pyannote',
  })

  const inputs = await processor(audioData)

  const model = await AutoModelForAudioFrameClassification.from_pretrained(modelPath)

  const { logits } = await model(inputs)

  console.log('logits', logits)

  const result = processor.post_process_speaker_diarization(logits, audioData.length)
  console.log('result', result)

  const vadSegments = postProcessVAD(logits, audioData.length)
  console.log('vadSegments', vadSegments)
}

if (require.main === module) {
  runVAD().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
