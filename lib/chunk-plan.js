const DEFAULT_CHUNK_SECONDS = 60;
const DEFAULT_OVERLAP_SECONDS = 2;

function buildChunkPlan(durationSeconds, {
  maxChunkSeconds = DEFAULT_CHUNK_SECONDS,
  overlapSeconds = DEFAULT_OVERLAP_SECONDS
} = {}) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const chunkSeconds = Math.max(1, Number(maxChunkSeconds) || DEFAULT_CHUNK_SECONDS);
  const overlap = Math.min(
    Math.max(0, Number(overlapSeconds) || 0),
    chunkSeconds / 2
  );

  if (duration === 0) {
    return [];
  }

  const chunks = [];
  let startSeconds = 0;

  while (startSeconds < duration) {
    const endSeconds = Math.min(duration, startSeconds + chunkSeconds);
    chunks.push({ startSeconds, endSeconds });

    if (endSeconds >= duration) {
      break;
    }

    startSeconds = Math.max(0, endSeconds - overlap);
  }

  return chunks;
}

function assertChunkPlanCoversDuration(chunks, durationSeconds) {
  const duration = Math.max(0, Number(durationSeconds) || 0);

  if (duration === 0) {
    return;
  }

  if (chunks.length === 0) {
    throw new Error('No audio chunks were created');
  }

  const first = chunks[0];
  const last = chunks[chunks.length - 1];

  if (first.startSeconds > 0.001) {
    throw new Error('Audio chunk plan does not start at the beginning');
  }

  for (let i = 1; i < chunks.length; i += 1) {
    const previous = chunks[i - 1];
    const current = chunks[i];
    if (current.startSeconds > previous.endSeconds + 0.001) {
      throw new Error(`Audio chunk plan has a gap before part ${i + 1}`);
    }
  }

  if (last.endSeconds < duration - 0.001) {
    throw new Error('Audio chunk plan does not cover the end of the file');
  }
}

module.exports = {
  DEFAULT_CHUNK_SECONDS,
  DEFAULT_OVERLAP_SECONDS,
  buildChunkPlan,
  assertChunkPlanCoversDuration
};
