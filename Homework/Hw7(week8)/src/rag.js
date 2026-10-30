function normalize(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkPage(text, { size = 700, overlap = 120 } = {}) {
  const clean = normalize(text);
  if (!clean) return [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const windowText = clean.slice(start, end);
      const breakAt = Math.max(
        windowText.lastIndexOf('\n'),
        windowText.lastIndexOf('。'),
        windowText.lastIndexOf('！'),
        windowText.lastIndexOf('？'),
        windowText.lastIndexOf('. ')
      );
      if (breakAt > size * 0.5) end = start + breakAt + 1;
    }
    const content = clean.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function buildChunks(pages) {
  const out = [];
  let idx = 0;
  pages.forEach((pageText, i) => {
    for (const content of chunkPage(pageText)) {
      out.push({ idx: idx++, page: i + 1, content });
    }
  });
  return out;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function topK(questionEmbedding, chunks, k = 4) {
  return chunks
    .map((chunk) => ({ ...chunk, score: cosine(questionEmbedding, JSON.parse(chunk.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

module.exports = { normalize, chunkPage, buildChunks, cosine, topK };
