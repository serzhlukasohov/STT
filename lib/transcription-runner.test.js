const test = require('node:test');
const assert = require('node:assert/strict');
const { transcribeParts } = require('./transcription-runner');

test('transcribeParts stops immediately when a part fails', async () => {
  const calls = [];

  await assert.rejects(
    () => transcribeParts({
      chunks: ['/tmp/part-1.m4a', '/tmp/part-2.m4a', '/tmp/part-3.m4a'],
      durationSeconds: 180,
      transcribePart: async (chunkPath) => {
        calls.push(chunkPath);
        if (chunkPath.endsWith('part-2.m4a')) {
          throw new Error('invalid file format');
        }
        return 'ok';
      }
    }),
    /part 2\/3 failed: invalid file format/
  );

  assert.deepEqual(calls, ['/tmp/part-1.m4a', '/tmp/part-2.m4a']);
});

test('transcribeParts reports progress and merges successful parts', async () => {
  const events = [];
  const result = await transcribeParts({
    chunks: ['/tmp/part-1.m4a', '/tmp/part-2.m4a'],
    durationSeconds: 120,
    onProgress: (event) => events.push(event.type),
    transcribePart: async (chunkPath) => chunkPath.endsWith('part-1.m4a')
      ? 'first'
      : 'second'
  });

  assert.equal(result.text, 'first\n\nsecond');
  assert.equal(result.cumulativeOutputTokens, 4);
  assert.deepEqual(events, [
    'chunk_start',
    'chunk_done',
    'chunk_start',
    'chunk_done',
    'complete'
  ]);
});
