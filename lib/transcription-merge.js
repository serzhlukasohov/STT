function mergeTranscriptionParts(parts, { includeChunkMarkers = false } = {}) {
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
