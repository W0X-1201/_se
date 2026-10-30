const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    page INTEGER,
    content TEXT NOT NULL,
    embedding TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
`);

function createDocument({ name, size, pages, chunkCount }) {
  const stmt = db.prepare(
    'INSERT INTO documents (name, size, pages, chunk_count, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const info = stmt.run(name, size, pages, chunkCount, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function insertChunks(documentId, chunks) {
  const stmt = db.prepare(
    'INSERT INTO chunks (document_id, idx, page, content, embedding) VALUES (?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const chunk of chunks) {
      stmt.run(documentId, chunk.idx, chunk.page, chunk.content, JSON.stringify(chunk.embedding));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listDocuments() {
  return db
    .prepare('SELECT id, name, size, pages, chunk_count, created_at FROM documents ORDER BY id DESC')
    .all();
}

function getDocument(id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

function getChunks(documentId) {
  return db
    .prepare('SELECT id, idx, page, content, embedding FROM chunks WHERE document_id = ? ORDER BY idx')
    .all(documentId);
}

function deleteDocument(id) {
  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
  const info = db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = {
  db,
  createDocument,
  insertChunks,
  listDocuments,
  getDocument,
  getChunks,
  deleteDocument,
};
