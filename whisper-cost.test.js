const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateTokensFromText,
  estimateWhisperCost,
  buildUsageEstimate,
  formatDuration,
  formatUsd
} = require('./whisper-cost');

test('estimateWhisperCost uses per-minute pricing', () => {
  const result = estimateWhisperCost(120);
  assert.equal(result.billableMinutes, 2);
  assert.equal(result.costUsd, 0.012);
});

test('estimateTokensFromText approximates token count', () => {
  assert.equal(estimateTokensFromText('hello world'), 3);
  assert.equal(estimateTokensFromText(''), 0);
});

test('buildUsageEstimate reports chunk count for large files', () => {
  const large = buildUsageEstimate({
    durationSeconds: 25 * 60,
    fileSize: 30 * 1024 * 1024
  });
  assert.equal(large.chunkCount, 3);

  const small = buildUsageEstimate({
    durationSeconds: 60,
    fileSize: 1024
  });
  assert.equal(small.chunkCount, 1);
});

test('formatDuration and formatUsd', () => {
  assert.equal(formatDuration(125), '2m 5s');
  assert.equal(formatUsd(0.004), '<$0.01');
  assert.equal(formatUsd(1.5), '$1.50');
});
