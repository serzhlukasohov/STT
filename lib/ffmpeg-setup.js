const ffmpeg = require('fluent-ffmpeg');

let configured = false;

function configureFfmpeg() {
  if (configured) {
    return;
  }

  try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    }
  } catch {
    // System ffmpeg when available (local dev)
  }

  try {
    const ffprobe = require('ffprobe-static');
    if (ffprobe?.path) {
      ffmpeg.setFfprobePath(ffprobe.path);
    }
  } catch {
    // System ffprobe when available (local dev)
  }

  configured = true;
}

configureFfmpeg();

module.exports = { configureFfmpeg };
