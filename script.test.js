const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { extractDateFromFilename } = require('./script');

test('extractDateFromFilename parses date from audio filename', () => {
  const result = extractDateFromFilename('audio_10@07-01-2025_16-39-35.ogg');
  assert.equal(result, '07-01-2025 16:39:35');
});

test('extractDateFromFilename returns null when format is missing', () => {
  const result = extractDateFromFilename('Mieszczańska.m4a');
  assert.equal(result, null);
});

test('buildOutputPath uses dedicated output folder', () => {
  const { buildOutputPath } = require('./script');
  const sourcePath = '/tmp/audio_10@07-01-2025_16-39-35.ogg';
  const outputDir = '/tmp/transcriptions';
  const result = buildOutputPath(sourcePath, outputDir);

  assert.equal(result, path.join(outputDir, 'audio_10@07-01-2025_16-39-35_transcription.txt'));
});

test('buildDownloadFileName appends transcription suffix', () => {
  const { buildDownloadFileName } = require('./script');
  assert.equal(
    buildDownloadFileName('audio_10@07-01-2025_16-39-35.ogg'),
    'audio_10@07-01-2025_16-39-35_transcription.txt'
  );
});

test('buildOutputContentFromUpload includes metadata and transcription', () => {
  const { buildOutputContentFromUpload } = require('./script');
  const uploadedAt = new Date('2025-01-07T14:00:00.000Z');
  const content = buildOutputContentFromUpload({
    fileName: 'audio_10@07-01-2025_16-39-35.ogg',
    transcription: 'Hello world',
    uploadedAt
  });

  assert.match(content, /File: audio_10@07-01-2025_16-39-35\.ogg/);
  assert.match(content, /Date from filename: 07-01-2025 16:39:35/);
  assert.match(content, /Transcription:\nHello world/);
});
