const express = require('express');
const path = require('node:path');
const multer = require('multer');

const db = require('./src/db');
const ollama = require('./src/ollama');
const { extractPdf } = require('./src/pdf');
const { buildChunks, topK } = require('./src/rag');

const app = express();
const PORT = process.env.PORT || 3200;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf) cb(null, true);
    else cb(new Error('只接受 PDF 檔案'));
  },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res) => {
  res.json(await ollama.health());
});

app.get('/api/documents', (req, res) => {
  res.json(db.listDocuments());
});

app.post('/api/documents', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '請選擇 PDF 檔案' });

    const health = await ollama.health();
    if (!health.ok) {
      return res.status(503).json({ error: 'Ollama 未啟動，請先執行 `ollama serve`', detail: health.error });
    }
    if (!health.hasEmbedModel) {
      return res.status(503).json({ error: `缺少嵌入模型，請先執行 \`ollama pull ${ollama.EMBED_MODEL}\`` });
    }

    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const { pages, numpages } = await extractPdf(req.file.buffer);
    const chunks = buildChunks(pages);
    if (!chunks.length) {
      return res.status(422).json({ error: 'PDF 中沒有可擷取的文字（可能是掃描檔）' });
    }

    for (const chunk of chunks) {
      chunk.embedding = await ollama.embed(chunk.content);
    }

    const id = db.createDocument({ name, size: req.file.size, pages: numpages, chunkCount: chunks.length });
    db.insertChunks(id, chunks);

    res.status(201).json(db.getDocument(id));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/documents/:id', (req, res) => {
  const ok = db.deleteDocument(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: '找不到文件' });
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res, next) => {
  try {
    const { documentId, question, topK: requestedK } = req.body || {};
    if (!documentId || !question || !String(question).trim()) {
      return res.status(400).json({ error: '請提供 documentId 與 question' });
    }

    const doc = db.getDocument(Number(documentId));
    if (!doc) return res.status(404).json({ error: '找不到文件' });

    const health = await ollama.health();
    if (!health.ok) return res.status(503).json({ error: 'Ollama 未啟動', detail: health.error });
    if (!health.hasChatModel) {
      return res.status(503).json({ error: `缺少對話模型，請先執行 \`ollama pull ${ollama.CHAT_MODEL}\`` });
    }
    if (!health.hasEmbedModel) {
      return res.status(503).json({ error: `缺少嵌入模型，請先執行 \`ollama pull ${ollama.EMBED_MODEL}\`` });
    }

    const chunks = db.getChunks(Number(documentId));
    const questionEmbedding = await ollama.embed(String(question));
    const k = Math.min(Math.max(Number(requestedK) || 4, 1), 8);
    const hits = topK(questionEmbedding, chunks, k);

    const context = hits.map((h, i) => `[${i + 1}]（第 ${h.page} 頁）\n${h.content}`).join('\n\n');
    const messages = [
      {
        role: 'system',
        content:
          '你是一個嚴謹的文件問答助教。只能根據使用者提供的「文件片段」回答，不要使用片段以外的知識。每個重點都要在句末標註來源編號，例如 [1]、[2]。如果片段中找不到答案，請直接說明「文件中沒有提到」。請用繁體中文回答。',
      },
      { role: 'user', content: `文件片段：\n${context}\n\n問題：${question}` },
    ];

    const answer = await ollama.chat(messages);

    res.json({
      answer,
      sources: hits.map((h, i) => ({
        index: i + 1,
        page: h.page,
        score: Number(h.score.toFixed(4)),
        snippet: h.content.slice(0, 220),
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.message === '只接受 PDF 檔案' ? 400 : 500;
  res.status(status).json({ error: err.message || '伺服器錯誤' });
});

app.listen(PORT, () => {
  console.log(`AI 文件助教已啟動：http://localhost:${PORT}`);
  console.log(`Ollama: ${ollama.OLLAMA_URL} | chat=${ollama.CHAT_MODEL} embed=${ollama.EMBED_MODEL}`);
});
