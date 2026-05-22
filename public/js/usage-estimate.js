const DEFAULT_PRICE_PER_MINUTE = 0.006;
const CHARS_PER_TOKEN = 4;
const CHUNK_DURATION_SEC = 10 * 60;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

let pricePerMinuteUsd = DEFAULT_PRICE_PER_MINUTE;

async function loadWhisperPricing() {
  try {
    const response = await fetch('/api/whisper-pricing');
    if (response.ok) {
      const data = await response.json();
      pricePerMinuteUsd = data.pricePerMinuteUsd ?? DEFAULT_PRICE_PER_MINUTE;
    }
  } catch {
    pricePerMinuteUsd = DEFAULT_PRICE_PER_MINUTE;
  }
}

function estimateTokensFromText(text = '') {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateWhisperCost(durationSeconds) {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const minutes = seconds / 60;
  const costUsd = minutes * pricePerMinuteUsd;

  return {
    billableMinutes: Number(minutes.toFixed(2)),
    costUsd: Number(costUsd.toFixed(4))
  };
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatUsd(amount) {
  const value = Number(amount) || 0;
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

function buildClientUsageEstimate(durationSeconds, fileSize) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const needsSplit = (fileSize || 0) > MAX_FILE_SIZE_BYTES && duration > 0;
  const chunkCount = needsSplit ? Math.ceil(duration / CHUNK_DURATION_SEC) : 1;
  const whisper = estimateWhisperCost(duration);

  return {
    durationSeconds: duration,
    durationFormatted: formatDuration(duration),
    chunkCount,
    billableMinutes: whisper.billableMinutes,
    estimatedCostUsd: whisper.costUsd,
    estimatedOutputTokens: 0
  };
}

function getAudioDurationFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';

    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url);
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        reject(new Error('Could not read audio duration'));
        return;
      }
      resolve(audio.duration);
    });

    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read audio duration'));
    });

    audio.src = url;
  });
}

loadWhisperPricing();
