const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeTranscriptionParts } = require('./transcription-merge');

test('mergeTranscriptionParts joins multiple parts with blank line', () => {
  const result = mergeTranscriptionParts([
    { text: 'First sentence.' },
    { text: 'Second sentence.' }
  ]);

  assert.equal(result, 'First sentence.\n\nSecond sentence.');
});

test('mergeTranscriptionParts returns single part unchanged', () => {
  assert.equal(mergeTranscriptionParts([{ text: 'Only part.' }]), 'Only part.');
});

test('mergeTranscriptionParts can include chunk markers', () => {
  const result = mergeTranscriptionParts(
    [{ text: 'A', timestamp: '[0-1min]' }, { text: 'B', timestamp: '[1-2min]' }],
    { includeChunkMarkers: true }
  );

  assert.match(result, /\[0-1min\]\nA/);
  assert.match(result, /---/);
  assert.match(result, /\[1-2min\]\nB/);
});
