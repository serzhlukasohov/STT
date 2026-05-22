# STT

Speech-to-text tool with a local web UI. Transcribe audio files using OpenAI Whisper.

## Quick start

```bash
npm install
npm start
```

Open http://localhost:3847

## Scripts

- `npm start` — web UI server
- `npm run cli` — batch transcribe audio files in a folder
- `npm test` — run tests

## Requirements

- Node.js
- [ffmpeg](https://ffmpeg.org/) (`brew install ffmpeg` on macOS)
- OpenAI API key

## Analytics dashboard (optional)

```bash
ANALYTICS_SECRET=your-secret npm start
```

Open http://localhost:3847/stats.html

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/serzhlukasohov/STT)

```bash
npm i -g vercel
vercel login
vercel
```

### Environment variables (Vercel dashboard)

| Variable | Required | Description |
|----------|----------|-------------|
| `ANALYTICS_SECRET` | No | Secret for `/stats.html` dashboard |
| `MAX_UPLOAD_MB` | No | Upload limit in MB (default `4` on Vercel, `500` locally) |
| `WHISPER_USD_PER_MINUTE` | No | Price estimate per minute (default `0.006`) |

### Vercel limits

- **Upload size**: ~4 MB on Hobby, up to ~50 MB on Pro — set `MAX_UPLOAD_MB=45` on Pro if needed.
- **Function duration**: long audio needs **Pro** (this project sets `maxDuration: 300` in `vercel.json`).
- **Analytics**: stored in `/tmp` on Vercel (resets between cold starts).
- Users still bring their own **OpenAI API key** in the browser.
