require('./lib/ffmpeg-setup');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const {
  AUDIO_EXTENSIONS,
  MAX_FILE_SIZE,
  CHUNK_DURATION,
  OUTPUT_DIR_NAME
} = require('./script-constants');
const {
  shouldSplitAudio,
  splitAudioIntoChunks,
  cleanupChunks
} = require('./lib/split-audio');
const { transcribeParts } = require('./lib/transcription-runner');

const DEFAULT_API_KEY = process.env.OPENAI_API_KEY;
const { buildUsageEstimate } = require('./whisper-cost');

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

function resolveTranscriptionFileName(filePath, sourceFileName = null) {
  if (sourceFileName && path.extname(sourceFileName)) {
    return path.basename(sourceFileName);
  }

  return path.basename(filePath);
}

async function transcribeAudio(filePath, apiKey = DEFAULT_API_KEY, options = {}) {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  const filename = resolveTranscriptionFileName(filePath, options.filename);
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath), { filename });
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

async function transcribeLargeAudio(filePath, apiKey = DEFAULT_API_KEY, options = {}) {
  const { onProgress, sourceFileName } = options;
  let chunks = [];
  let chunkDir = null;

  try {
    console.log(`Starting transcription of: ${filePath}`);

    onProgress?.({ type: 'status', message: 'Analyzing audio duration…' });
    const duration = await getAudioDuration(filePath);
    const fileSize = fs.statSync(filePath).size;
    const willSplit = shouldSplitAudio(fileSize, duration);
    const usageEstimate = buildUsageEstimate({
      durationSeconds: duration,
      fileSize,
      forceSplit: willSplit
    });

    onProgress?.({
      type: 'usage_estimate',
      ...usageEstimate,
      willSplit
    });

    const splitResult = await splitAudioIntoChunks(filePath, {
      duration,
      fileSize,
      onProgress
    });
    chunks = splitResult.chunks;
    chunkDir = splitResult.chunkDir;

    console.log(`Transcribing ${chunks.length} part(s)...`);
    const result = await transcribeParts({
      chunks,
      durationSeconds: duration,
      onProgress,
      includeChunkMarkers: process.env.INCLUDE_CHUNK_MARKERS === '1',
      transcribePart: async (chunkPath, index) => {
        console.log(`Transcribing part ${index + 1}/${chunks.length}...`);
        const filename = chunkPath === filePath
          ? resolveTranscriptionFileName(filePath, sourceFileName)
          : resolveTranscriptionFileName(chunkPath);
        const text = await transcribeAudio(chunkPath, apiKey, { filename });
        console.log(`Part ${index + 1} completed`);
        return text;
      }
    });

    return result.text;
  } catch (error) {
    console.error('Error in transcribeLargeAudio:', error);
    throw error;
  } finally {
    cleanupChunks(chunks, filePath, chunkDir);
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
  resolveTranscriptionFileName,
  getAudioDuration,
  shouldSplitAudio,
  transcribeLargeAudio
};
