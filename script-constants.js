const AUDIO_EXTENSIONS = new Set(['.m4a', '.ogg', '.mp3', '.wav', '.mp4', '.aac', '.webm']);
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const CHUNK_DURATION = 10 * 60;
const OUTPUT_DIR_NAME = 'transcriptions';

module.exports = {
  AUDIO_EXTENSIONS,
  MAX_FILE_SIZE,
  CHUNK_DURATION,
  OUTPUT_DIR_NAME
};
