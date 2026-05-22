const $ = (id) => document.getElementById(id);

const authSection = $('auth-section');
const statsContent = $('stats-content');
const secretInput = $('stats-secret');
const loadBtn = $('load-stats');
const authError = $('auth-error');

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function renderChart(days) {
  const chart = $('chart');
  chart.innerHTML = '';

  const maxValue = Math.max(
    1,
    ...days.map((d) => d.pageViews + d.transcriptionsSuccess + d.uniqueVisitors)
  );

  days.forEach((day) => {
    const total = day.pageViews + day.transcriptionsSuccess;
    const height = Math.round((total / maxValue) * 100);

    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';
    wrap.title = `${day.date}: ${day.pageViews} views, ${day.uniqueVisitors} visitors, ${day.transcriptionsSuccess} OK`;

    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${Math.max(height, 4)}%`;

    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = day.date.slice(5);

    wrap.append(bar, label);
    chart.append(wrap);
  });
}

function renderStats(data) {
  $('stat-visitors').textContent = formatNumber(data.uniqueVisitors);
  $('stat-views').textContent = formatNumber(data.pageViews);
  $('stat-transcriptions').textContent = formatNumber(data.transcriptionsTotal);
  $('stat-transcriptions-sub').textContent =
    `${formatNumber(data.transcriptionsSuccess)} success · ${formatNumber(data.transcriptionsFailed)} failed`;
  $('stat-downloads').textContent = formatNumber(data.downloads);
  $('stat-conversion').textContent = `${data.conversionRate}%`;
  $('stat-meta').textContent =
    `Since ${new Date(data.firstSeen).toLocaleString()} · updated ${new Date(data.lastUpdated).toLocaleString()}`;

  renderChart(data.last14Days);
  statsContent.classList.remove('hidden');
  authError.classList.add('hidden');
}

async function loadStats(secret) {
  const response = await fetch(`/api/analytics/stats?secret=${encodeURIComponent(secret)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load stats');
  }

  return data;
}

loadBtn.addEventListener('click', async () => {
  const secret = secretInput.value.trim();
  if (!secret) {
    authError.textContent = 'Enter the analytics secret';
    authError.classList.remove('hidden');
    return;
  }

  loadBtn.disabled = true;
  authError.classList.add('hidden');

  try {
    const data = await loadStats(secret);
    saveStatsSecret(secret);
    renderStats(data);
  } catch (error) {
    clearStatsSecret();
    authError.textContent = error.message;
    authError.classList.remove('hidden');
    statsContent.classList.add('hidden');
  } finally {
    loadBtn.disabled = false;
  }
});

const savedSecret = getStatsSecret();
if (savedSecret) {
  secretInput.value = savedSecret;
  loadStats(savedSecret)
    .then(renderStats)
    .catch(() => clearStatsSecret());
}
