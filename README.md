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
