const VISITOR_STORAGE_KEY = 'sp-to-txt-visitor-id';
const STATS_SECRET_STORAGE_KEY = 'sp-to-txt-analytics-secret';

function generateVisitorId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getVisitorId() {
  let id = localStorage.getItem(VISITOR_STORAGE_KEY);
  if (!id) {
    id = generateVisitorId();
    localStorage.setItem(VISITOR_STORAGE_KEY, id);
  }
  return id;
}

function trackClientEvent(event) {
  fetch('/api/analytics/track', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Visitor-Id': getVisitorId()
    },
    body: JSON.stringify({ event, visitorId: getVisitorId() })
  }).catch(() => {});
}

function getStatsSecret() {
  return sessionStorage.getItem(STATS_SECRET_STORAGE_KEY) || '';
}

function saveStatsSecret(secret) {
  sessionStorage.setItem(STATS_SECRET_STORAGE_KEY, secret);
}

function clearStatsSecret() {
  sessionStorage.removeItem(STATS_SECRET_STORAGE_KEY);
}
