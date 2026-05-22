const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldSplitAudio, getChunkCount } = require('./split-audio');
const { MAX_FILE_SIZE, CHUNK_DURATION } = require('../script-constants');

test('shouldSplitAudio when file exceeds Whisper size limit', () => {
  assert.equal(shouldSplitAudio(MAX_FILE_SIZE + 1, 60), true);
});

test('shouldSplitAudio when duration exceeds chunk duration', () => {
  assert.equal(shouldSplitAudio(1024, CHUNK_DURATION + 1), true);
});

test('shouldSplitAudio returns false for small short files', () => {
  assert.equal(shouldSplitAudio(1024, 120), false);
});

test('getChunkCount rounds up by duration', () => {
  assert.equal(getChunkCount(CHUNK_DURATION), 1);
  assert.equal(getChunkCount(CHUNK_DURATION + 1), 2);
  assert.equal(getChunkCount(CHUNK_DURATION * 2.5), 3);
});
