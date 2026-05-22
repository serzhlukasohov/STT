const CHUNK_DURATION_SEC = 10 * 60;

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const samples = audioBuffer.length;
  const blockAlign = (numChannels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch += 1) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  for (let i = 0; i < samples; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function downmixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer;
  }

  const mono = new AudioBuffer({
    length: audioBuffer.length,
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: 1
  });
  const output = mono.getChannelData(0);
  output.fill(0);

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
    const input = audioBuffer.getChannelData(ch);
    for (let i = 0; i < output.length; i += 1) {
      output[i] += input[i] / audioBuffer.numberOfChannels;
    }
  }

  return mono;
}

function resampleBuffer(audioBuffer, targetSampleRate) {
  if (audioBuffer.sampleRate === targetSampleRate) {
    return audioBuffer;
  }

  const duration = audioBuffer.duration;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(duration * targetSampleRate),
    targetSampleRate
  );
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

function secondsForMaxBytes(maxBytes, sampleRate = 16000) {
  const bytesPerSecond = sampleRate * 2;
  return Math.max(30, Math.floor((maxBytes * 0.85) / bytesPerSecond));
}

async function splitAudioIntoUploadChunks(file, maxBytes) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mono = downmixToMono(decoded);
    const resampled = await resampleBuffer(mono, 16000);

    const maxChunkSeconds = Math.min(
      CHUNK_DURATION_SEC,
      secondsForMaxBytes(maxBytes, 16000)
    );
    const samplesPerChunk = Math.floor(maxChunkSeconds * 16000);
    const chunks = [];

    for (let offset = 0; offset < resampled.length; offset += samplesPerChunk) {
      const length = Math.min(samplesPerChunk, resampled.length - offset);
      const chunkBuffer = new AudioBuffer({
        length,
        sampleRate: 16000,
        numberOfChannels: 1
      });
      chunkBuffer.getChannelData(0).set(resampled.getChannelData(0).subarray(offset, offset + length));

      const partIndex = chunks.length + 1;
      const blob = audioBufferToWavBlob(chunkBuffer);
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      chunks.push({
        blob,
        name: `${baseName}_part_${partIndex}.wav`,
        index: partIndex,
        total: 0
      });
    }

    chunks.forEach((chunk) => {
      chunk.total = chunks.length;
    });

    return chunks;
  } finally {
    await audioContext.close();
  }
}

function extractTranscriptionBody(content) {
  const marker = 'Transcription:\n';
  const index = content.indexOf(marker);
  if (index === -1) {
    return content.trim();
  }
  return content.slice(index + marker.length).trim();
}

function buildMergedContent(fileName, textParts) {
  const mergedText = textParts.filter(Boolean).join('\n\n');
  const now = new Date().toISOString();

  return [
    `File: ${fileName}`,
    `Uploaded at: ${now}`,
    `Parts merged: ${textParts.length}`,
    '',
    'Transcription:',
    mergedText,
    ''
  ].join('\n');
}

window.secondsForMaxBytes = secondsForMaxBytes;
window.splitAudioIntoUploadChunks = splitAudioIntoUploadChunks;
window.extractTranscriptionBody = extractTranscriptionBody;
window.buildMergedContent = buildMergedContent;
