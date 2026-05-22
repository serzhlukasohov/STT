const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const {
  AUDIO_EXTENSIONS,
  buildDownloadFileName,
  buildOutputContentFromUpload,
  transcribeLargeAudio
} = require('./script');
const { trackEvent, getSummary, isValidSecret } = require('./analytics');
const { WHISPER_USD_PER_MINUTE } = require('./whisper-cost');
const {
  IS_VERCEL,
  getMaxUploadBytes,
  getUploadDir
} = require('./lib/runtime');

const PORT = process.env.PORT || 3847;
const ANALYTICS_SECRET = process.env.ANALYTICS_SECRET || '';
const MAX_UPLOAD_SIZE = getMaxUploadBytes();
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_SIZE / (1024 * 1024));

const uploadDir = getUploadDir();
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported format. Allowed: ${[...AUDIO_EXTENSIONS].join(', ')}`));
  }
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getApiKey(req) {
  const headerKey = req.get('x-openai-api-key');
  if (headerKey && headerKey.trim()) {
    return headerKey.trim();
  }
  return null;
}

function removeFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function getVisitorId(req) {
  const fromBody = req.body?.visitorId;
  const fromHeader = req.get('x-visitor-id');
  const value = (fromBody || fromHeader || '').trim();
  return value.length >= 8 && value.length <= 64 ? value : null;
}

const ALLOWED_EVENTS = new Set(['visit', 'download']);

app.get('/api/config', (_req, res) => {
  res.json({
    isVercel: IS_VERCEL,
    maxUploadMb: MAX_UPLOAD_MB,
    maxWhisperChunkMb: 25,
    analyticsEphemeral: IS_VERCEL,
    note: IS_VERCEL
      ? 'On Vercel, use files under the upload limit. Long jobs need a Pro plan with extended function duration.'
      : null
  });
});

app.post('/api/analytics/track', (req, res) => {
  const event = req.body?.event;
  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ error: 'Invalid analytics event' });
  }

  trackEvent(event, getVisitorId(req));
  res.json({ ok: true });
});

app.get('/api/whisper-pricing', (_req, res) => {
  res.json({
    pricePerMinuteUsd: WHISPER_USD_PER_MINUTE,
    charsPerTokenEstimate: 4,
    model: 'whisper-1',
    billingUnit: 'audio_minute'
  });
});

function wantsEventStream(req) {
  return req.query.stream === '1' || (req.get('accept') || '').includes('text/event-stream');
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get('/api/analytics/stats', (req, res) => {
  const secret = req.query.secret || req.get('x-analytics-secret') || '';
  if (!ANALYTICS_SECRET) {
    return res.status(503).json({
      error: 'Analytics dashboard is disabled. Set ANALYTICS_SECRET env variable.'
    });
  }

  if (!isValidSecret(secret, ANALYTICS_SECRET)) {
    return res.status(401).json({ error: 'Invalid analytics secret' });
  }

  res.json(getSummary());
});

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ error: 'OpenAI API key is required' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Audio file is required' });
  }

  const uploadedAt = new Date();
  const originalName = req.file.originalname;
  const visitorId = getVisitorId(req);
  const useStream = wantsEventStream(req);

  if (useStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
  }

  const sendProgress = (payload) => {
    if (useStream) {
      writeSse(res, 'progress', payload);
    }
  };

  try {
    const transcription = await transcribeLargeAudio(req.file.path, apiKey, {
      onProgress: sendProgress,
      sourceFileName: originalName
    });
    const content = buildOutputContentFromUpload({
      fileName: originalName,
      transcription,
      uploadedAt
    });

    trackEvent('transcribe_success', visitorId);

    const payload = {
      content,
      fileName: buildDownloadFileName(originalName),
      preview: transcription.slice(0, 2000)
    };

    if (useStream) {
      writeSse(res, 'result', payload);
      res.end();
    } else {
      res.json(payload);
    }
  } catch (error) {
    trackEvent('transcribe_fail', visitorId);
    const message = error.response?.data?.error?.message || error.message || 'Transcription failed';
    const hint = IS_VERCEL && /timeout|TIMEOUT|504|502/i.test(message)
      ? ' Try a shorter file or upgrade Vercel plan for longer function duration.'
      : '';

    if (useStream) {
      writeSse(res, 'error', { error: message + hint });
      res.end();
    } else {
      res.status(500).json({ error: message + hint });
    }
  } finally {
    removeFile(req.file.path);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `File is too large (max ${MAX_UPLOAD_MB} MB on this host)`
      : error.message;
    return res.status(400).json({ error: message });
  }

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({ error: 'Unexpected server error' });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Speech-to-text UI: http://localhost:${PORT}`);
    if (ANALYTICS_SECRET) {
      console.log(`Analytics dashboard: http://localhost:${PORT}/stats.html`);
    } else {
      console.log('Analytics: tracking enabled. Set ANALYTICS_SECRET to open /stats.html');
    }
  });
}
