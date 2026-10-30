const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const CHAT_MODEL = process.env.CHAT_MODEL || 'llama3.2';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

async function post(pathname, body, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${pathname} 回應 ${res.status}：${text.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function listModels() {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama 無法連線（${res.status}）`);
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

async function embed(text) {
  try {
    const data = await post('/api/embed', { model: EMBED_MODEL, input: text }, 60000);
    if (data.embeddings && data.embeddings[0]) return data.embeddings[0];
  } catch (err) {
    // 舊版 Ollama 沒有 /api/embed，改用 /api/embeddings
  }
  const data = await post('/api/embeddings', { model: EMBED_MODEL, prompt: text }, 60000);
  if (!data.embedding) throw new Error('Ollama 沒有回傳嵌入向量');
  return data.embedding;
}

async function chat(messages) {
  const data = await post(
    '/api/chat',
    { model: CHAT_MODEL, messages, stream: false, options: { temperature: 0.2 } },
    180000
  );
  return (data.message && data.message.content) || '';
}

function hasModel(models, name) {
  return models.some((m) => m === name || m === `${name}:latest`);
}

async function health() {
  try {
    const models = await listModels();
    return {
      ok: true,
      url: OLLAMA_URL,
      chatModel: CHAT_MODEL,
      embedModel: EMBED_MODEL,
      hasChatModel: hasModel(models, CHAT_MODEL),
      hasEmbedModel: hasModel(models, EMBED_MODEL),
      models,
    };
  } catch (err) {
    return {
      ok: false,
      url: OLLAMA_URL,
      chatModel: CHAT_MODEL,
      embedModel: EMBED_MODEL,
      hasChatModel: false,
      hasEmbedModel: false,
      models: [],
      error: err.message,
    };
  }
}

module.exports = {
  OLLAMA_URL,
  CHAT_MODEL,
  EMBED_MODEL,
  listModels,
  embed,
  chat,
  health,
};
