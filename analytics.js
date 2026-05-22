const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getAnalyticsDataFile } = require('./lib/runtime');

const DATA_FILE = getAnalyticsDataFile();
const DATA_DIR = path.dirname(DATA_FILE);
const MAX_STORED_VISITORS = 50_000;

function emptyState() {
  const now = new Date().toISOString();
  return {
    firstSeen: now,
    lastUpdated: now,
    totals: {
      pageViews: 0,
      transcriptionsSuccess: 0,
      transcriptionsFailed: 0,
      downloads: 0
    },
    uniqueVisitors: [],
    daily: {}
  };
}

function loadState() {
  if (!fs.existsSync(DATA_FILE)) {
    return emptyState();
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const tempPath = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, DATA_FILE);
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ensureDailyBucket(state, day) {
  if (!state.daily[day]) {
    state.daily[day] = {
      pageViews: 0,
      uniqueVisitors: [],
      transcriptionsSuccess: 0,
      transcriptionsFailed: 0,
      downloads: 0
    };
  }
  return state.daily[day];
}

function registerUniqueVisitor(state, visitorId, day) {
  if (!visitorId || typeof visitorId !== 'string') {
    return false;
  }

  const isNewGlobal = !state.uniqueVisitors.includes(visitorId);
  if (isNewGlobal) {
    state.uniqueVisitors.push(visitorId);
    if (state.uniqueVisitors.length > MAX_STORED_VISITORS) {
      state.uniqueVisitors = state.uniqueVisitors.slice(-MAX_STORED_VISITORS);
    }
  }

  const bucket = ensureDailyBucket(state, day);
  const isNewToday = !bucket.uniqueVisitors.includes(visitorId);
  if (isNewToday) {
    bucket.uniqueVisitors.push(visitorId);
  }

  return isNewGlobal;
}

function trackEvent(event, visitorId) {
  const state = loadState();
  const day = todayKey();
  const bucket = ensureDailyBucket(state, day);

  if (visitorId) {
    registerUniqueVisitor(state, visitorId, day);
  }

  switch (event) {
    case 'visit':
      state.totals.pageViews += 1;
      bucket.pageViews += 1;
      break;
    case 'transcribe_success':
      state.totals.transcriptionsSuccess += 1;
      bucket.transcriptionsSuccess += 1;
      break;
    case 'transcribe_fail':
      state.totals.transcriptionsFailed += 1;
      bucket.transcriptionsFailed += 1;
      break;
    case 'download':
      state.totals.downloads += 1;
      bucket.downloads += 1;
      break;
    default:
      return null;
  }

  state.lastUpdated = new Date().toISOString();
  saveState(state);
  return getSummary(state);
}

function getLastDays(state, count = 14) {
  const days = [];
  const cursor = new Date();

  for (let i = 0; i < count; i += 1) {
    const key = todayKey(cursor);
    const bucket = state.daily[key] || {
      pageViews: 0,
      uniqueVisitors: [],
      transcriptionsSuccess: 0,
      transcriptionsFailed: 0,
      downloads: 0
    };

    days.unshift({
      date: key,
      pageViews: bucket.pageViews,
      uniqueVisitors: bucket.uniqueVisitors.length,
      transcriptionsSuccess: bucket.transcriptionsSuccess,
      transcriptionsFailed: bucket.transcriptionsFailed,
      downloads: bucket.downloads
    });

    cursor.setDate(cursor.getDate() - 1);
  }

  return days;
}

function getSummary(state = loadState()) {
  const transcriptionsTotal =
    state.totals.transcriptionsSuccess + state.totals.transcriptionsFailed;

  return {
    firstSeen: state.firstSeen,
    lastUpdated: state.lastUpdated,
    uniqueVisitors: state.uniqueVisitors.length,
    pageViews: state.totals.pageViews,
    transcriptionsSuccess: state.totals.transcriptionsSuccess,
    transcriptionsFailed: state.totals.transcriptionsFailed,
    transcriptionsTotal,
    downloads: state.totals.downloads,
    conversionRate: state.totals.pageViews > 0
      ? Number((transcriptionsTotal / state.totals.pageViews * 100).toFixed(1))
      : 0,
    last14Days: getLastDays(state, 14)
  };
}

function isValidSecret(provided, expected) {
  if (!expected || !provided) {
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  trackEvent,
  getSummary,
  isValidSecret,
  DATA_FILE
};
