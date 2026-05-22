const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const CHUNK_DURATION = 10 * 60;
const AUDIO_EXTENSIONS = new Set(['.m4a', '.ogg', '.mp3', '.wav', '.mp4', '.aac', '.webm']);
const OUTPUT_DIR_NAME = 'transcriptions';
const DEFAULT_API_KEY = process.env.OPENAI_API_KEY;
const {
  estimateTokensFromText,
  estimateWhisperCost,
  getChunkDurationSeconds,
  buildUsageEstimate
} = require('./whisper-cost');

function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

async function splitAudioIntoChunks(filePath, { duration, fileSize, onProgress } = {}) {
  const resolvedDuration = duration ?? await getAudioDuration(filePath);
  const resolvedSize = fileSize ?? fs.statSync(filePath).size;

  console.log(`Audio duration: ${resolvedDuration.toFixed(2)} seconds`);
  console.log(`File size: ${(resolvedSize / 1024 / 1024).toFixed(2)} MB`);

  if (resolvedSize <= MAX_FILE_SIZE) {
    console.log('File is small enough, no splitting needed');
    return [filePath];
  }

  console.log('File is too large, splitting into chunks...');
  const chunks = [];
  const numChunks = Math.ceil(resolvedDuration / CHUNK_DURATION);

  for (let i = 0; i < numChunks; i++) {
    onProgress?.({
      type: 'splitting',
      chunk: i + 1,
      totalChunks: numChunks,
      message: `Splitting audio chunk ${i + 1} of ${numChunks}…`
    });

    const startTime = i * CHUNK_DURATION;
    const chunkPath = filePath.replace(/\.[^/.]+$/, `_chunk_${i + 1}.m4a`);

    await new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .seekInput(startTime)
        .duration(CHUNK_DURATION)
        .output(chunkPath)
        .on('end', () => {
          console.log(`Created chunk ${i + 1}/${numChunks}: ${chunkPath}`);
          chunks.push(chunkPath);
          resolve();
        })
        .on('error', reject)
        .run();
    });
  }

  return chunks;
}

async function transcribeAudio(filePath, apiKey = DEFAULT_API_KEY) {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('model', 'whisper-1');

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    return response.data.text;
  } catch (error) {
    console.error('Error during transcription:', error.response?.data || error.message);
    throw error;
  }
}

function extractDateFromFilename(fileName) {
  const match = fileName.match(/@(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})/);
  if (!match) {
    return null;
  }

  const [, datePart, timePart] = match;
  return `${datePart} ${timePart.replace(/-/g, ':')}`;
}

function formatIsoDate(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return 'N/A';
  }
  return dateValue.toISOString();
}

function listAudioFiles(directoryPath) {
  return fs
    .readdirSync(directoryPath)
    .filter((fileName) => AUDIO_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function getOutputDirectory(baseDirectory) {
  const outputDir = path.join(baseDirectory, OUTPUT_DIR_NAME);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

function buildOutputPath(filePath, outputDirectory) {
  const parsed = path.parse(filePath);
  return path.join(outputDirectory, `${parsed.name}_transcription.txt`);
}

function cleanupChunks(chunks, originalFilePath) {
  chunks.forEach((chunkPath) => {
    if (chunkPath !== originalFilePath && fs.existsSync(chunkPath)) {
      fs.unlinkSync(chunkPath);
      console.log(`Deleted: ${chunkPath}`);
    }
  });
}

async function transcribeLargeAudio(filePath, apiKey = DEFAULT_API_KEY, options = {}) {
  const { onProgress } = options;

  try {
    console.log(`Starting transcription of: ${filePath}`);

    onProgress?.({ type: 'status', message: 'Analyzing audio duration…' });
    const duration = await getAudioDuration(filePath);
    const fileSize = fs.statSync(filePath).size;
    const usageEstimate = buildUsageEstimate({ durationSeconds: duration, fileSize });

    onProgress?.({
      type: 'usage_estimate',
      ...usageEstimate
    });

    const chunks = await splitAudioIntoChunks(filePath, { duration, fileSize, onProgress });

    console.log(`Transcribing ${chunks.length} chunks...`);
    const transcriptions = [];
    let cumulativeOutputTokens = 0;
    let processedSeconds = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkSeconds = getChunkDurationSeconds(i, duration, CHUNK_DURATION);
      const chunkStartMin = (i * CHUNK_DURATION) / 60;
      const chunkEndMin = Math.min((i + 1) * CHUNK_DURATION, duration) / 60;

      onProgress?.({
        type: 'chunk_start',
        chunk: i + 1,
        totalChunks: chunks.length,
        message: `Transcribing chunk ${i + 1} of ${chunks.length}…`,
        processedSeconds,
        totalSeconds: duration,
        progressPercent: duration > 0 ? Math.round((processedSeconds / duration) * 100) : 0
      });

      console.log(`Transcribing chunk ${i + 1}/${chunks.length}...`);
      try {
        const chunkResult = await transcribeAudio(chunks[i], apiKey);
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
          totalSeconds: duration,
          billableMinutes: cost.billableMinutes,
          estimatedCostUsd: cost.costUsd,
          progressPercent: duration > 0 ? Math.round((processedSeconds / duration) * 100) : 100
        });

        transcriptions.push({
          chunk: i + 1,
          text: chunkResult,
          timestamp: `[${chunkStartMin.toFixed(1)}min - ${chunkEndMin.toFixed(1)}min]`
        });
        console.log(`Chunk ${i + 1} completed`);
      } catch (error) {
        console.error(`Error transcribing chunk ${i + 1}:`, error.message);
        processedSeconds += chunkSeconds;

        onProgress?.({
          type: 'chunk_error',
          chunk: i + 1,
          totalChunks: chunks.length,
          message: error.message
        });

        transcriptions.push({
          chunk: i + 1,
          text: '[ERROR: Failed to transcribe this chunk]',
          timestamp: `[${chunkStartMin.toFixed(1)}min - ${chunkEndMin.toFixed(1)}min]`
        });
      }
    }

    const fullTranscription = transcriptions
      .map((t) => `${t.timestamp}\n${t.text}`)
      .join('\n\n---\n\n');

    cleanupChunks(chunks, filePath);

    const finalCost = estimateWhisperCost(duration);
    onProgress?.({
      type: 'complete',
      cumulativeOutputTokens,
      billableMinutes: finalCost.billableMinutes,
      estimatedCostUsd: finalCost.costUsd,
      progressPercent: 100
    });

    return fullTranscription;
  } catch (error) {
    console.error('Error in transcribeLargeAudio:', error);
    throw error;
  }
}

function buildOutputContent(filePath, transcription) {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const sourceDateFromName = extractDateFromFilename(fileName) || 'N/A';

  return [
    `File: ${fileName}`,
    `Date from filename: ${sourceDateFromName}`,
    `Filesystem creation date: ${formatIsoDate(stat.birthtime)}`,
    `Filesystem modification date: ${formatIsoDate(stat.mtime)}`,
    '',
    'Transcription:',
    transcription,
    ''
  ].join('\n');
}

function buildOutputContentFromUpload({ fileName, transcription, uploadedAt = new Date() }) {
  const sourceDateFromName = extractDateFromFilename(fileName) || 'N/A';

  return [
    `File: ${fileName}`,
    `Date from filename: ${sourceDateFromName}`,
    `Uploaded at: ${formatIsoDate(uploadedAt)}`,
    '',
    'Transcription:',
    transcription,
    ''
  ].join('\n');
}

function buildDownloadFileName(fileName) {
  const parsed = path.parse(fileName);
  return `${parsed.name}_transcription.txt`;
}

async function processSingleFile(filePath, outputDirectory) {
  const transcription = await transcribeLargeAudio(filePath);
  const outputPath = buildOutputPath(filePath, outputDirectory);
  const content = buildOutputContent(filePath, transcription);
  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`Saved: ${outputPath}`);
}

async function processAllAudioFiles(directoryPath) {
  const audioFiles = listAudioFiles(directoryPath);
  const outputDirectory = getOutputDirectory(directoryPath);

  if (audioFiles.length === 0) {
    console.log('No audio files found.');
    return;
  }

  console.log(`Found ${audioFiles.length} audio files.`);

  for (const audioFileName of audioFiles) {
    const audioPath = path.join(directoryPath, audioFileName);
    console.log(`\n=== Processing ${audioFileName} ===`);
    try {
      await processSingleFile(audioPath, outputDirectory);
    } catch (error) {
      console.error(`Failed to process ${audioFileName}:`, error.message);
    }
  }
}

if (require.main === module) {
  const targetDirectory = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  processAllAudioFiles(targetDirectory).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  AUDIO_EXTENSIONS,
  CHUNK_DURATION,
  MAX_FILE_SIZE,
  extractDateFromFilename,
  listAudioFiles,
  buildOutputPath,
  buildOutputContentFromUpload,
  buildDownloadFileName,
  getAudioDuration,
  transcribeLargeAudio
};
