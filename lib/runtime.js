const os = require('os');
const path = require('path');

const IS_VERCEL = Boolean(process.env.VERCEL);

function getMaxUploadBytes() {
  if (process.env.MAX_UPLOAD_MB) {
    return Number(process.env.MAX_UPLOAD_MB) * 1024 * 1024;
  }
  // Vercel serverless request body limits (Hobby ~4.5 MB, Pro ~50 MB)
  if (IS_VERCEL) {
    return 4 * 1024 * 1024;
  }
  return 500 * 1024 * 1024;
}

function getUploadDir() {
  return path.join(os.tmpdir(), 'sp-to-txt-uploads');
}

function getAnalyticsDataFile() {
  if (process.env.ANALYTICS_DATA_FILE) {
    return process.env.ANALYTICS_DATA_FILE;
  }
  if (IS_VERCEL) {
    return path.join(os.tmpdir(), 'sp-to-txt-analytics', 'analytics.json');
  }
  return path.join(__dirname, '..', 'data', 'analytics.json');
}

module.exports = {
  IS_VERCEL,
  getMaxUploadBytes,
  getUploadDir,
  getAnalyticsDataFile
};
