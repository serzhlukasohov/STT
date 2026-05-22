function mergeTranscriptionParts(parts, { includeChunkMarkers = false } = {}) {
  const emptyPartIndex = parts.findIndex((part) => {
    const text = typeof part === 'string' ? part : part.text || '';
    return text.trim().length === 0;
  });

  if (emptyPartIndex !== -1) {
    throw new Error(`Transcription part ${emptyPartIndex + 1} returned empty text`);
  }

  const failedPartIndex = parts.findIndex((part) => {
    const text = typeof part === 'string' ? part : part.text || '';
    return /\[ERROR:\s*Failed to transcribe this part\]/i.test(text);
  });

  if (failedPartIndex !== -1) {
    throw new Error(`Transcription part ${failedPartIndex + 1} failed`);
  }

  const normalized = parts
    .map((part) => (typeof part === 'string' ? part : part.text || '').trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return '';
  }

  if (normalized.length === 1) {
    return normalized[0];
  }

  if (!includeChunkMarkers) {
    return normalized.join('\n\n');
  }

  return parts
    .map((part, index) => {
      const text = (typeof part === 'string' ? part : part.text || '').trim();
      const label = part.timestamp || `[part ${index + 1}]`;
      return `${label}\n${text}`;
    })
    .join('\n\n---\n\n');
}

module.exports = {
  mergeTranscriptionParts
};
