const { mergeTranscriptionParts } = require('./transcription-merge');
const {
  estimateTokensFromText,
  estimateWhisperCost
} = require('../whisper-cost');

async function transcribeParts({
  chunks,
  durationSeconds,
  onProgress,
  transcribePart,
  includeChunkMarkers = false
}) {
  const transcriptions = [];
  let cumulativeOutputTokens = 0;
  let processedSeconds = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkSeconds = durationSeconds / chunks.length;
    const chunkStartMin = (i * durationSeconds) / chunks.length / 60;
    const chunkEndMin = ((i + 1) * durationSeconds) / chunks.length / 60;

    onProgress?.({
      type: 'chunk_start',
      chunk: i + 1,
      totalChunks: chunks.length,
      message: `Transcribing part ${i + 1} of ${chunks.length}…`,
      processedSeconds,
      totalSeconds: durationSeconds,
      progressPercent: durationSeconds > 0
        ? Math.round((processedSeconds / durationSeconds) * 100)
        : 0
    });

    try {
      const chunkResult = await transcribePart(chunks[i], i);
      const chunkTokens = estimateTokensFromText(chunkResult);
      cumulativeOutputTokens += chunkTokens;
      processedSeconds += chunkSeconds;

      const cost = estimateWhisperCost(processedSeconds);

      onProgress?.({
        type: 'chunk_done',
        chunk: i + 1,
        totalChunks: chunks.length,
        chunkOutputTokens: chunkTokens,
        cumulativeOutputTokens,
        processedSeconds,
        totalSeconds: durationSeconds,
        billableMinutes: cost.billableMinutes,
        estimatedCostUsd: cost.costUsd,
        progressPercent: durationSeconds > 0
          ? Math.round((processedSeconds / durationSeconds) * 100)
          : 100
      });

      transcriptions.push({
        text: chunkResult,
        timestamp: `[${chunkStartMin.toFixed(1)}min - ${chunkEndMin.toFixed(1)}min]`
      });
    } catch (error) {
      const message = error.response?.data?.error?.message || error.message;
      processedSeconds += chunkSeconds;

      onProgress?.({
        type: 'chunk_error',
        chunk: i + 1,
        totalChunks: chunks.length,
        message
      });

      throw new Error(`Transcription part ${i + 1}/${chunks.length} failed: ${message}`);
    }
  }

  const text = mergeTranscriptionParts(transcriptions, { includeChunkMarkers });
  const finalCost = estimateWhisperCost(durationSeconds);

  onProgress?.({
    type: 'complete',
    cumulativeOutputTokens,
    billableMinutes: finalCost.billableMinutes,
    estimatedCostUsd: finalCost.costUsd,
    progressPercent: 100,
    partsMerged: chunks.length
  });

  return {
    text,
    cumulativeOutputTokens
  };
}

module.exports = {
  transcribeParts
};
