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
  progressFill.style.width = '0%';
  liveWaveform.setProgress(0);
}

function setProgressPercent(percent) {
  progressFill.style.width = `${percent}%`;
  liveWaveform.setProgress(percent);
}

async function animateUsageValues(data) {
  if (data.billableMinutes !== undefined && data.billableMinutes !== lastBillableMinutes) {
    lastBillableMinutes = data.billableMinutes;
    const chunkNote = data.totalChunks > 1 && data.chunk
      ? ` · chunk ${data.chunk}/${data.totalChunks}`
      : '';
    await animateNumber(usageBillable, data.billableMinutes, {
      formatter: (value) => `${value.toFixed(2)} min${chunkNote}`
    });
  }

  if (data.cumulativeOutputTokens !== undefined && data.cumulativeOutputTokens !== lastTokenCount) {
    lastTokenCount = data.cumulativeOutputTokens;
    await animateNumber(usageTokens, data.cumulativeOutputTokens, {
      formatter: (value) => `~${formatTokenCount(Math.round(value))}`
    });
  } else if (data.estimatedOutputTokens !== undefined) {
    usageTokens.textContent = data.estimatedOutputTokens > 0
      ? `~${formatTokenCount(data.estimatedOutputTokens)} (est.)`
      : '— (after transcription)';
  }

  if (data.estimatedCostUsd !== undefined && data.estimatedCostUsd !== lastCostUsd) {
    lastCostUsd = data.estimatedCostUsd;
    usageCost.classList.add('is-ticking');
    await animateNumber(usageCost, data.estimatedCostUsd, {
      formatter: (value) => formatUsd(value)
    });
    usageCost.classList.remove('is-ticking');
  }
}

function updateUsagePanel(data) {
  if (data.message || data.status) {
    usageStatus.textContent = data.message || data.status;
    usageStatus.classList.remove('status-pulse');
    void usageStatus.offsetWidth;
    usageStatus.classList.add('status-pulse');
  }

  if (data.durationFormatted) {
    usageDuration.textContent = data.durationFormatted;
  } else if (data.totalSeconds) {
    usageDuration.textContent = formatDuration(data.totalSeconds);
  }

  if (data.progressPercent !== undefined) {
    setProgressPercent(data.progressPercent);
  }

  if (data.progressText) {
    progressText.textContent = data.progressText;
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

function parseSseChunk(buffer, onEvent) {
  const parts = buffer.split('\n\n');
  const remainder = parts.pop() || '';

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
      const data = JSON.parse(dataLine);
      onEvent(eventName, data);
    } catch {
      // ignore malformed chunks
    }
  });

  return remainder;
}

async function transcribeWithStream(formData, apiKey) {
  const response = await fetch('/api/transcribe?stream=1', {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'X-OpenAI-API-Key': apiKey,
      'X-Visitor-Id': getVisitorId()
    },
    body: formData
  });

  if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json();
    throw new Error(data.error || 'Transcription failed');
  }

  if (!response.body) {
    throw new Error('Streaming is not supported in this browser');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let resultPayload = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseChunk(buffer, (eventName, data) => {
      if (eventName === 'progress') {
        handleProgressEvent(data);
      } else if (eventName === 'result') {
        resultPayload = data;
      } else if (eventName === 'error') {
        throw new Error(data.error || 'Transcription failed');
      }
    });
  }

  if (!resultPayload) {
    throw new Error('No transcription result received');
  }

  return resultPayload;
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
  updateUsagePanel({
    status: 'Splitting in browser…',
    progressText: 'Preparing audio parts for upload…',
    progressPercent: 8
  });

  const splitFn = window.splitAudioIntoUploadChunks;
  if (typeof splitFn !== 'function') {
    throw new Error('Audio splitter failed to load. Please hard-refresh the page (Cmd+Shift+R).');
  }

  const chunks = await splitFn(file, getMaxUploadBytes() * 0.9);
  const textParts = [];
  const extractFn = window.extractTranscriptionBody;
  const mergeFn = window.buildMergedContent;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    updateUsagePanel({
      status: `Part ${chunk.index} of ${chunk.total}`,
      progressText: `Uploading and transcribing part ${chunk.index}…`,
      progressPercent: 10 + Math.round((i / chunks.length) * 85)
    });

    const formData = new FormData();
    formData.append('audio', chunk.blob, chunk.name);
    const data = await transcribeWithStream(formData, apiKey);
    textParts.push(extractFn(data.content));
  }

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

  const willSplitClient = needsClientSideSplit(selectedFile);
  updateUsagePanel({
    status: willSplitClient ? 'Preparing parts…' : 'Uploading…',
    progressText: willSplitClient
      ? 'Large file will be split, then each part transcribed and merged'
      : 'Uploading audio to server…',
    progressPercent: 2
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
