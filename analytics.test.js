const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('trackEvent counts visitors and events', (t) => {
  const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-analytics-')), 'analytics.json');
  process.env.ANALYTICS_DATA_FILE = tempFile;

  const analyticsPath = path.resolve(__dirname, 'analytics.js');
  delete require.cache[analyticsPath];
  const { trackEvent, getSummary, isValidSecret } = require(analyticsPath);

  t.after(() => {
    delete process.env.ANALYTICS_DATA_FILE;
    delete require.cache[analyticsPath];
    fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
  });

  trackEvent('visit', 'visitor-a');
  trackEvent('visit', 'visitor-a');
  trackEvent('visit', 'visitor-b');
  trackEvent('transcribe_success', 'visitor-a');
  trackEvent('transcribe_fail', 'visitor-b');
  trackEvent('download', 'visitor-a');

  const summary = getSummary();

  assert.equal(summary.uniqueVisitors, 2);
  assert.equal(summary.pageViews, 3);
  assert.equal(summary.transcriptionsSuccess, 1);
  assert.equal(summary.transcriptionsFailed, 1);
  assert.equal(summary.downloads, 1);
  assert.equal(summary.last14Days.length, 14);
});

test('isValidSecret uses timing-safe comparison', () => {
  const analyticsPath = path.resolve(__dirname, 'analytics.js');
  const { isValidSecret } = require(analyticsPath);

  assert.equal(isValidSecret('my-secret', 'my-secret'), true);
  assert.equal(isValidSecret('wrong', 'my-secret'), false);
  assert.equal(isValidSecret('', 'my-secret'), false);
});
