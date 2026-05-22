const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildChunkPlan,
  assertChunkPlanCoversDuration
} = require('./chunk-plan');

test('buildChunkPlan covers the full duration including the final tail', () => {
  const chunks = buildChunkPlan(2423.274667, {
    maxChunkSeconds: 60,
    overlapSeconds: 2
  });

  assert.equal(chunks[0].startSeconds, 0);
  assert.equal(chunks.at(-1).endSeconds, 2423.274667);
  assertChunkPlanCoversDuration(chunks, 2423.274667);
});

test('buildChunkPlan overlaps neighboring chunks without gaps', () => {
  const chunks = buildChunkPlan(125, {
    maxChunkSeconds: 60,
    overlapSeconds: 2
  });

  assert.deepEqual(chunks, [
    { startSeconds: 0, endSeconds: 60 },
    { startSeconds: 58, endSeconds: 118 },
    { startSeconds: 116, endSeconds: 125 }
  ]);
  assertChunkPlanCoversDuration(chunks, 125);
});

test('assertChunkPlanCoversDuration rejects missing tail coverage', () => {
  assert.throws(
    () => assertChunkPlanCoversDuration([
      { startSeconds: 0, endSeconds: 60 },
      { startSeconds: 60, endSeconds: 100 }
    ], 120),
    /does not cover the end/i
  );
});
