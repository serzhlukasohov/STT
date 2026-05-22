const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { MAX_FILE_SIZE, CHUNK_DURATION } = require('../script-constants');

function getChunkDurationSeconds(chunkIndex, totalDurationSeconds) {
  const start = chunkIndex * CHUNK_DURATION;
  return Math.min(CHUNK_DURATION, Math.max(0, totalDurationSeconds - start));
}

function shouldSplitAudio(fileSize, durationSeconds) {
  return fileSize > MAX_FILE_SIZE || durationSeconds > CHUNK_DURATION;
}

function getChunkCount(durationSeconds) {
  return Math.max(1, Math.ceil(durationSeconds / CHUNK_DURATION));
}

function createChunkDirectory(filePath) {
  const baseName = path.parse(filePath).name;
  const chunkDir = path.join(
    path.dirname(filePath),
    `${baseName}_chunks_${Date.now()}`
  );
  fs.mkdirSync(chunkDir, { recursive: true });
  return chunkDir;
}

function buildChunkPath(chunkDir, index) {
  return path.join(chunkDir, `chunk_${String(index + 1).padStart(3, '0')}.m4a`);
}

function exportChunk(filePath, startTime, durationSeconds, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .setStartTime(startTime)
      .duration(durationSeconds)
      .audioCodec('aac')
      .audioBitrate('96k')
      .format('ipod')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

async function ensureChunkUnderLimit(chunkPath, filePath, startTime, durationSeconds) {
  let stats = fs.statSync(chunkPath);
  if (stats.size <= MAX_FILE_SIZE) {
    return chunkPath;
  }

  const halfDuration = Math.max(30, durationSeconds / 2);
  const partA = chunkPath.replace('.m4a', '_a.m4a');
  const partB = chunkPath.replace('.m4a', '_b.m4a');

  await exportChunk(filePath, startTime, halfDuration, partA);
  await exportChunk(filePath, startTime + halfDuration, durationSeconds - halfDuration, partB);

  fs.unlinkSync(chunkPath);
  return [partA, partB];
}

async function splitAudioIntoChunks(filePath, { duration, fileSize, onProgress } = {}) {
  const resolvedDuration = duration ?? await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });
  const resolvedSize = fileSize ?? fs.statSync(filePath).size;

  if (!shouldSplitAudio(resolvedSize, resolvedDuration)) {
    return { chunks: [filePath], chunkDir: null, numChunks: 1 };
  }

  const numChunks = getChunkCount(resolvedDuration);
  const chunkDir = createChunkDirectory(filePath);
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    onProgress?.({
      type: 'splitting',
      chunk: i + 1,
      totalChunks: numChunks,
      message: `Splitting audio part ${i + 1} of ${numChunks}…`
    });

    const startTime = i * CHUNK_DURATION;
    const chunkDuration = getChunkDurationSeconds(i, resolvedDuration);
    const chunkPath = buildChunkPath(chunkDir, i);

    await exportChunk(filePath, startTime, chunkDuration, chunkPath);
    const result = await ensureChunkUnderLimit(
      chunkPath,
      filePath,
      startTime,
      chunkDuration
    );

    if (Array.isArray(result)) {
      chunks.push(...result);
    } else {
      chunks.push(result);
    }
  }

  return { chunks, chunkDir, numChunks };
}

function cleanupChunks(chunks, originalFilePath, chunkDir) {
  chunks.forEach((chunkPath) => {
    if (chunkPath !== originalFilePath && fs.existsSync(chunkPath)) {
      fs.unlinkSync(chunkPath);
    }
  });

  if (chunkDir && fs.existsSync(chunkDir)) {
    fs.rmSync(chunkDir, { recursive: true, force: true });
  }
}

module.exports = {
  shouldSplitAudio,
  getChunkCount,
  splitAudioIntoChunks,
  cleanupChunks,
  getChunkDurationSeconds
};
