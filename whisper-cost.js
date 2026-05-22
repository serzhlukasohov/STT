// OpenAI Whisper-1 list price (USD per minute of audio). Override via env if pricing changes.
const WHISPER_USD_PER_MINUTE = Number(process.env.WHISPER_USD_PER_MINUTE) || 0.006;
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokensFromText(text = '') {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function estimateWhisperCost(durationSeconds) {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const minutes = seconds / 60;
  const costUsd = minutes * WHISPER_USD_PER_MINUTE;

  return {
    durationSeconds: seconds,
    billableMinutes: Number(minutes.toFixed(2)),
    costUsd: Number(costUsd.toFixed(4))
  };
}

function getChunkDurationSeconds(chunkIndex, totalDurationSeconds, chunkDurationSeconds) {
  const start = chunkIndex * chunkDurationSeconds;
  const remaining = Math.max(0, totalDurationSeconds - start);
  return Math.min(chunkDurationSeconds, remaining);
}

function buildUsageEstimate({
  durationSeconds,
  fileSize,
  chunkDurationSeconds = 10 * 60,
  maxFileSize = 25 * 1024 * 1024,
  forceSplit = null
}) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const needsSplit = forceSplit ?? (
    (fileSize || 0) > maxFileSize || duration > chunkDurationSeconds
  );
  const chunkCount = needsSplit && duration > 0
    ? Math.ceil(duration / chunkDurationSeconds)
    : 1;
  const whisper = estimateWhisperCost(duration);

  return {
    durationSeconds: duration,
    durationFormatted: formatDuration(duration),
    chunkCount,
    billableMinutes: whisper.billableMinutes,
    estimatedCostUsd: whisper.costUsd,
    estimatedOutputTokens: 0,
    pricingNote: 'Whisper is billed per audio minute, not GPT tokens. Output tokens are an approximate text length indicator.',
    pricePerMinuteUsd: WHISPER_USD_PER_MINUTE
  };
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatUsd(amount) {
  const value = Number(amount) || 0;
  if (value < 0.01 && value > 0) {
    return `<$0.01`;
  }
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

module.exports = {
  WHISPER_USD_PER_MINUTE,
  estimateTokensFromText,
  estimateWhisperCost,
  getChunkDurationSeconds,
  buildUsageEstimate,
  formatDuration,
  formatUsd
};
