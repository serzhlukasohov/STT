const STORAGE_KEY = 'sp-to-txt-openai-key';

const $ = (id) => document.getElementById(id);

const apiKeyInput = $('api-key');
const toggleKeyBtn = $('toggle-key');
const saveKeyBtn = $('save-key');
const keyStatus = $('key-status');
const uploadSection = $('upload-section');
const dropzone = $('dropzone');
const fileInput = $('file-input');
const filePreview = $('file-preview');
const fileNameEl = $('file-name');
const fileSizeEl = $('file-size');
const fileEstimateEl = $('file-estimate');
const clearFileBtn = $('clear-file');
const transcribeBtn = $('transcribe-btn');
const progressSection = $('progress-section');
const progressText = $('progress-text');
const progressFill = $('progress-fill');
const usageStatus = $('usage-status');
const usageDuration = $('usage-duration');
const usageBillable = $('usage-billable');
const usageTokens = $('usage-tokens');
const usageCost = $('usage-cost');
const activityLog = $('activity-log');
const progressTitle = document.querySelector('.progress-title');
const resultSection = $('result-section');
const resultPreview = $('result-preview');
const downloadBtn = $('download-btn');
const newTranscriptionBtn = $('new-transcription');
const errorSection = $('error-section');
const errorMessage = $('error-message');
const dismissErrorBtn = $('dismiss-error');

const fileWaveform = new WaveformCanvas($('waveform-canvas'));
const liveWaveform = new WaveformCanvas($('live-waveform'));

let selectedFile = null;
let fileDurationSeconds = null;
let resultContent = '';
let resultFileName = 'transcription.txt';
let lastCostUsd = 0;
let lastTokenCount = 0;
let lastBillableMinutes = 0;
let activitySeq = 0;
let activeActivityId = null;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStoredApiKey() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

function setApiKeySaved(key) {
  if (key) {
    localStorage.setItem(STORAGE_KEY, key);
    keyStatus.textContent = 'API key saved locally';
    keyStatus.classList.add('saved');
    uploadSection.classList.remove('disabled');
    uploadSection.classList.add('step-unlocked');
  } else {
    localStorage.removeItem(STORAGE_KEY);
    keyStatus.textContent = 'No API key saved yet';
    keyStatus.classList.remove('saved');
    uploadSection.classList.add('disabled');
    uploadSection.classList.remove('step-unlocked');
  }
}

async function hideWorkflowPanels() {
  await hideViews([progressSection, resultSection, errorSection]);
  liveWaveform.stop();
  progressSection.classList.remove('is-active');
}

function showError(message) {
  hideWorkflowPanels().then(() => {
    errorMessage.textContent = message;
    showView(errorSection);
  });
}

function resetUsagePanel() {
  usageStatus.textContent = '—';
  usageDuration.textContent = '—';
  usageBillable.textContent = '—';
  usageTokens.textContent = '—';
  usageCost.textContent = '—';
  usageCost.dataset.value = '0';
  usageTokens.dataset.value = '0';
  usageBillable.dataset.value = '0';
  lastCostUsd = 0;
  lastTokenCount = 0;
  lastBillableMinutes = 0;
  activitySeq = 0;
  activeActivityId = null;
  activityLog.innerHTML = '';
  progressFill.style.width = '0%';
  liveWaveform.setProgress(0);
  if (progressTitle) {
    progressTitle.textContent = 'Transcribing…';
  }
}

function formatActivityTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function pushActivity(message, { active = true } = {}) {
  if (activeActivityId) {
    const prev = activityLog.querySelector(`[data-id="${activeActivityId}"]`);
    if (prev) {
      prev.classList.remove('is-active');
      prev.classList.add('is-done');
    }
  }

  activitySeq += 1;
  const id = activitySeq;
  if (active) {
    activeActivityId = id;
  }

  const item = document.createElement('li');
  item.className = `activity-item${active ? ' is-active' : ' is-done'}`;
  item.dataset.id = String(id);
  item.innerHTML = `
    <span class="activity-dot" aria-hidden="true"></span>
    <span class="activity-time">${formatActivityTime()}</span>
    <span class="activity-text"></span>
  `;
  item.querySelector('.activity-text').textContent = message;
  activityLog.append(item);
  activityLog.scrollTop = activityLog.scrollHeight;

  return id;
}

function seedInitialEstimate(file) {
  if (!fileDurationSeconds) {
    return;
  }

  const estimate = buildClientUsageEstimate(fileDurationSeconds, file.size);
  updateUsagePanel({
    status: 'Starting…',
    progressText: 'Initializing transcription…',
    durationFormatted: estimate.durationFormatted,
    billableMinutes: estimate.billableMinutes,
    estimatedCostUsd: estimate.estimatedCostUsd,
    estimatedOutputTokens: 0,
    progressPercent: 1
  });
}

function setProgressPercent(percent) {
  progressFill.style.width = `${percent}%`;
  liveWaveform.setProgress(percent);
}

function applyUsageValuesSync(data) {
  const chunkNote = data.totalChunks > 1 && data.chunk
    ? ` · part ${data.chunk}/${data.totalChunks}`
    : '';

  if (data.billableMinutes !== undefined) {
    usageBillable.textContent = `${Number(data.billableMinutes).toFixed(2)} min${chunkNote}`;
    usageBillable.dataset.value = String(data.billableMinutes);
  }

  if (data.cumulativeOutputTokens !== undefined) {
    usageTokens.textContent = `~${formatTokenCount(data.cumulativeOutputTokens)}`;
    usageTokens.dataset.value = String(data.cumulativeOutputTokens);
  } else if (data.estimatedOutputTokens !== undefined) {
    usageTokens.textContent = data.estimatedOutputTokens > 0
      ? `~${formatTokenCount(data.estimatedOutputTokens)} (est.)`
      : 'waiting…';
  }

  if (data.estimatedCostUsd !== undefined) {
    usageCost.textContent = formatUsd(data.estimatedCostUsd);
    usageCost.dataset.value = String(data.estimatedCostUsd);
  }
}

function animateUsageValues(data) {
  const chunkNote = data.totalChunks > 1 && data.chunk
    ? ` · part ${data.chunk}/${data.totalChunks}`
    : '';

  if (data.billableMinutes !== undefined && data.billableMinutes !== lastBillableMinutes) {
    lastBillableMinutes = data.billableMinutes;
    animateNumber(usageBillable, data.billableMinutes, {
      formatter: (value) => `${value.toFixed(2)} min${chunkNote}`
    });
  }

  if (data.cumulativeOutputTokens !== undefined && data.cumulativeOutputTokens !== lastTokenCount) {
    lastTokenCount = data.cumulativeOutputTokens;
    animateNumber(usageTokens, data.cumulativeOutputTokens, {
      formatter: (value) => `~${formatTokenCount(Math.round(value))}`
    });
  }

  if (data.estimatedCostUsd !== undefined && data.estimatedCostUsd !== lastCostUsd) {
    lastCostUsd = data.estimatedCostUsd;
    usageCost.classList.add('is-ticking');
    animateNumber(usageCost, data.estimatedCostUsd, {
      formatter: (value) => formatUsd(value)
    }).finally(() => usageCost.classList.remove('is-ticking'));
  }
}

function updateUsagePanel(data) {
  if (data.message || data.status) {
    const statusText = data.message || data.status;
    usageStatus.textContent = statusText;
    usageStatus.classList.remove('status-pulse');
    void usageStatus.offsetWidth;
    usageStatus.classList.add('status-pulse');
    if (data.log !== false) {
      pushActivity(statusText);
    }
  }

  if (data.durationFormatted) {
    usageDuration.textContent = data.durationFormatted;
  } else if (data.totalSeconds) {
    usageDuration.textContent = formatDuration(data.totalSeconds);
  }

  applyUsageValuesSync(data);

  if (data.progressPercent !== undefined) {
    setProgressPercent(data.progressPercent);
  }

  if (data.progressText) {
    progressText.textContent = data.progressText;
  }

  if (data.title && progressTitle) {
    progressTitle.textContent = data.title;
  }

  animateUsageValues(data);
}

function formatTokenCount(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function showFileEstimate(estimate) {
  const chunksLabel = estimate.chunkCount > 1 ? ` · ${estimate.chunkCount} parts` : '';
  const splitLabel = estimate.clientSideSplit ? ' · split before upload' : estimate.willSplit ? ' · split on server' : '';
  fileEstimateEl.textContent =
    `~${estimate.durationFormatted} · ${estimate.billableMinutes} min billable · est. ${formatUsd(estimate.estimatedCostUsd)}${chunksLabel}${splitLabel}`;
  fileEstimateEl.classList.remove('hidden');
  fileEstimateEl.classList.add('estimate-pop');
}

function hideFileEstimate() {
  fileEstimateEl.classList.add('hidden');
  fileEstimateEl.classList.remove('estimate-pop');
  fileEstimateEl.textContent = '';
}

async function loadWaveform(file) {
  const canvas = $('waveform-canvas');
  canvas.classList.add('is-loading');

  try {
    const peaks = await decodeAudioPeaks(file);
    fileWaveform.setStaticPeaks(peaks);
  } catch {
    fileWaveform.setStaticPeaks(generateFallbackPeaks());
  } finally {
    canvas.classList.remove('is-loading');
  }
}

async function loadFileEstimate(file) {
  try {
    fileDurationSeconds = await getAudioDurationFromFile(file);
    const estimate = buildClientUsageEstimate(fileDurationSeconds, file.size);
    showFileEstimate(estimate);
  } catch {
    fileDurationSeconds = null;
    hideFileEstimate();
  }
}

function handleProgressEvent(payload) {
  switch (payload.type) {
    case 'status':
      updateUsagePanel({
        status: payload.message,
        progressText: payload.message
      });
      break;
    case 'usage_estimate':
      updateUsagePanel({
        status: 'Ready to transcribe',
        progressText: payload.chunkCount > 1
          ? `Splitting into ${payload.chunkCount} chunks…`
          : 'Transcribing with Whisper…',
        durationFormatted: payload.durationFormatted,
        billableMinutes: payload.billableMinutes,
        estimatedCostUsd: payload.estimatedCostUsd,
        estimatedOutputTokens: payload.estimatedOutputTokens,
        totalSeconds: payload.durationSeconds,
        progressPercent: 5
      });
      break;
    case 'splitting':
      updateUsagePanel({
        status: payload.message,
        progressText: payload.message,
        chunk: payload.chunk,
        totalChunks: payload.totalChunks,
        progressPercent: 10 + Math.round((payload.chunk / payload.totalChunks) * 15)
      });
      break;
    case 'chunk_start':
      updateUsagePanel({
        status: payload.message,
        progressText: payload.message,
        chunk: payload.chunk,
        totalChunks: payload.totalChunks,
        totalSeconds: payload.totalSeconds,
        progressPercent: payload.progressPercent || 20
      });
      break;
    case 'chunk_done':
      updateUsagePanel({
        status: `Chunk ${payload.chunk} of ${payload.totalChunks} done`,
        progressText: `Processed ${formatDuration(payload.processedSeconds)} of ${formatDuration(payload.totalSeconds)}`,
        chunk: payload.chunk,
        totalChunks: payload.totalChunks,
        billableMinutes: payload.billableMinutes,
        cumulativeOutputTokens: payload.cumulativeOutputTokens,
        estimatedCostUsd: payload.estimatedCostUsd,
        progressPercent: payload.progressPercent
      });
      break;
    case 'chunk_error':
      updateUsagePanel({
        status: `Chunk ${payload.chunk} failed`,
        progressText: payload.message
      });
      break;
    case 'complete':
      updateUsagePanel({
        status: 'Finishing up…',
        progressText: 'Building transcription file…',
        billableMinutes: payload.billableMinutes,
        cumulativeOutputTokens: payload.cumulativeOutputTokens,
        estimatedCostUsd: payload.estimatedCostUsd,
        progressPercent: 100
      });
      break;
    default:
      break;
  }
}

function createSseParser(onEvent) {
  let buffer = '';

  return {
    feed(chunkText) {
      buffer += chunkText;
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      parts.forEach((part) => {
        const lines = part.split('\n');
        let eventName = 'message';
        let dataLine = '';

        lines.forEach((line) => {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLine += line.slice(5).trim();
          }
        });

        if (!dataLine) return;

        try {
          onEvent(eventName, JSON.parse(dataLine));
        } catch {
          // ignore malformed chunks
        }
      });
    }
  };
}

function transcribeWithStream(formData, apiKey, { uploadLabel = 'audio' } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = (data) => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const xhr = new XMLHttpRequest();
    const parser = createSseParser((eventName, data) => {
      if (eventName === 'progress') {
        handleProgressEvent(data);
      } else if (eventName === 'result') {
        finishResolve(data);
      } else if (eventName === 'error') {
        finishReject(new Error(data.error || 'Transcription failed'));
      }
    });

    let lastResponseLength = 0;

    xhr.open('POST', '/api/transcribe?stream=1');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('X-OpenAI-API-Key', apiKey);
    xhr.setRequestHeader('X-Visitor-Id', getVisitorId());

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const uploadPercent = Math.round((event.loaded / event.total) * 14);
      updateUsagePanel({
        status: `Uploading ${uploadLabel}…`,
        progressText: `Uploaded ${formatFileSize(event.loaded)} of ${formatFileSize(event.total)}`,
        progressPercent: uploadPercent,
        log: false
      });
    });

    xhr.addEventListener('readystatechange', () => {
      if (xhr.readyState >= 3) {
        const chunk = xhr.responseText.slice(lastResponseLength);
        lastResponseLength = xhr.responseText.length;
        if (chunk) {
          parser.feed(chunk);
        }
      }

      if (xhr.readyState === 4) {
        const tail = xhr.responseText.slice(lastResponseLength);
        if (tail) {
          parser.feed(tail);
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          if (!settled) {
            finishReject(new Error('No transcription result received'));
          }
          return;
        }

        try {
          const payload = JSON.parse(xhr.responseText);
          finishReject(new Error(payload.error || 'Transcription failed'));
        } catch {
          finishReject(new Error(`Transcription failed (${xhr.status})`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      finishReject(new Error('Network error during transcription'));
    });

    xhr.addEventListener('timeout', () => {
      finishReject(new Error('Request timed out'));
    });

    xhr.send(formData);
  });
}

const BROWSER_PROCESSING_LIMIT = 250 * 1024 * 1024;

function needsClientSideSplit(file) {
  return file.size > getMaxUploadBytes();
}

function validateFileSize(file) {
  if (file.size > BROWSER_PROCESSING_LIMIT) {
    showError(`File is too large to process in the browser (max ${BROWSER_PROCESSING_LIMIT / (1024 * 1024)} MB).`);
    return false;
  }
  return true;
}

async function transcribeInClientParts(file, apiKey) {
  const splitFn = window.splitAudioIntoUploadChunks;
  if (typeof splitFn !== 'function') {
    throw new Error('Audio splitter failed to load. Please hard-refresh the page (Cmd+Shift+R).');
  }

  const chunks = await splitFn(file, getMaxUploadBytes() * 0.9, (progress) => {
    updateUsagePanel({
      status: progress.message,
      progressText: progress.message,
      progressPercent: progress.percent,
      durationFormatted: progress.durationSeconds
        ? formatDuration(progress.durationSeconds)
        : undefined,
      log: true
    });
  });

  const textParts = [];
  const extractFn = window.extractTranscriptionBody;
  const mergeFn = window.buildMergedContent;
  let processedSeconds = 0;
  const totalDuration = fileDurationSeconds || chunks.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);

  pushActivity(`Transcribing ${chunks.length} parts…`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const rangeStart = processedSeconds;
    processedSeconds += chunk.durationSeconds || 0;

    updateUsagePanel({
      status: `Transcribing part ${chunk.index}/${chunk.total}`,
      progressText: `Uploading part ${chunk.index} of ${chunk.total}…`,
      progressPercent: 35 + Math.round((i / chunks.length) * 60),
      title: `Part ${chunk.index} of ${chunk.total}`
    });

    const formData = new FormData();
    formData.append('audio', chunk.blob, chunk.name);
    const data = await transcribeWithStream(formData, apiKey, {
      uploadLabel: `part ${chunk.index}/${chunk.total}`
    });
    textParts.push(extractFn(data.content));

    const donePercent = totalDuration > 0
      ? Math.round((processedSeconds / totalDuration) * 100)
      : Math.round(((i + 1) / chunks.length) * 100);

    updateUsagePanel({
      status: `Part ${chunk.index}/${chunk.total} done`,
      progressText: `Merged ${i + 1} of ${chunks.length} parts`,
      progressPercent: Math.min(99, 35 + Math.round(((i + 1) / chunks.length) * 60)),
      totalSeconds: totalDuration,
      billableMinutes: processedSeconds / 60
    });

    pushActivity(`Part ${chunk.index} finished (${formatDuration(rangeStart)}–${formatDuration(processedSeconds)})`, {
      active: i === chunks.length - 1
    });
  }

  pushActivity('Merging all parts into one text…', { active: true });

  const content = mergeFn(file.name, textParts);
  return {
    content,
    fileName: `${file.name.replace(/\.[^/.]+$/, '')}_transcription.txt`,
    preview: content.slice(0, 2000)
  };
}

async function transcribeSelectedFile(apiKey) {
  if (needsClientSideSplit(selectedFile)) {
    return transcribeInClientParts(selectedFile, apiKey);
  }

  const formData = new FormData();
  formData.append('audio', selectedFile);
  return transcribeWithStream(formData, apiKey);
}

async function setSelectedFile(file) {
  selectedFile = file;
  fileDurationSeconds = null;

  if (!file) {
    await hideView(filePreview);
    dropzone.classList.remove('hidden');
    transcribeBtn.disabled = true;
    hideFileEstimate();
    fileWaveform.clear();
    return;
  }

  if (!validateFileSize(file)) {
    fileInput.value = '';
    return;
  }

  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatFileSize(file.size);
  dropzone.classList.add('hidden');
  transcribeBtn.disabled = false;
  hideFileEstimate();

  showView(filePreview);
  await Promise.all([loadFileEstimate(file), loadWaveform(file)]);
}

function isAudioFile(file) {
  const allowed = ['.m4a', '.ogg', '.mp3', '.wav', '.mp4', '.aac', '.webm'];
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return allowed.includes(ext);
}

saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key.startsWith('sk-')) {
    keyStatus.textContent = 'Key should start with sk-';
    keyStatus.classList.remove('saved');
    return;
  }
  setApiKeySaved(key);
});

toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleKeyBtn.setAttribute('aria-label', isPassword ? 'Hide API key' : 'Show API key');
});

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (file && isAudioFile(file)) {
    await setSelectedFile(file);
  } else if (file) {
    showError('Unsupported format. Use m4a, ogg, mp3, wav, mp4, aac, or webm.');
  }
});

clearFileBtn.addEventListener('click', () => {
  fileInput.value = '';
  setSelectedFile(null);
  hideWorkflowPanels();
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', async (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!isAudioFile(file)) {
    showError('Unsupported format. Use m4a, ogg, mp3, wav, mp4, aac, or webm.');
    return;
  }
  await setSelectedFile(file);
});

transcribeBtn.addEventListener('click', async () => {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    showError('Save your OpenAI API key first.');
    return;
  }
  if (!selectedFile) return;

  await hideWorkflowPanels();
  resetUsagePanel();
  progressSection.classList.add('is-active');
  showView(progressSection);
  requestAnimationFrame(() => {
    liveWaveform.resize();
    liveWaveform.setLive(48);
  });
  uploadSection.classList.add('disabled');

  seedInitialEstimate(selectedFile);

  const willSplitClient = needsClientSideSplit(selectedFile);
  pushActivity(willSplitClient ? 'Large file — splitting locally first' : 'Sending audio to server');
  updateUsagePanel({
    status: willSplitClient ? 'Preparing parts…' : 'Uploading…',
    progressText: willSplitClient
      ? 'Splitting audio, then transcribing each part'
      : 'Uploading audio to server…',
    progressPercent: 2,
    log: false
  });

  try {
    const data = await transcribeSelectedFile(apiKey);

    resultContent = data.content;
    resultFileName = data.fileName;
    resultPreview.textContent =
      data.preview + (data.content.length > data.preview.length ? '\n\n…' : '');

    liveWaveform.stop();
    progressSection.classList.remove('is-active');
    await hideView(progressSection);
    showView(resultSection);
  } catch (error) {
    liveWaveform.stop();
    progressSection.classList.remove('is-active');
    showError(error.message);
  } finally {
    uploadSection.classList.remove('disabled');
  }
});

downloadBtn.addEventListener('click', () => {
  trackClientEvent('download');
  downloadBtn.classList.add('btn-success-pulse');
  setTimeout(() => downloadBtn.classList.remove('btn-success-pulse'), 600);

  const blob = new Blob([resultContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = resultFileName;
  link.click();
  URL.revokeObjectURL(url);
});

newTranscriptionBtn.addEventListener('click', () => {
  fileInput.value = '';
  setSelectedFile(null);
  hideWorkflowPanels();
});

dismissErrorBtn.addEventListener('click', () => {
  hideView(errorSection);
});

const storedKey = getStoredApiKey();
if (storedKey) {
  apiKeyInput.value = storedKey;
  setApiKeySaved(storedKey);
}

trackClientEvent('visit');
