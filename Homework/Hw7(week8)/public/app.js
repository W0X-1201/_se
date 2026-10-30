const state = {
  documents: [],
  selectedId: null,
  busy: false,
};

const $ = (selector) => document.querySelector(selector);

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `請求失敗（${res.status}）`);
  return data;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(health) {
  const el = $('#status');
  if (!health.ok) {
    el.className = 'status bad';
    el.textContent = 'Ollama 未連線，請先執行 ollama serve';
    return;
  }
  const missing = [];
  if (!health.hasChatModel) missing.push(health.chatModel);
  if (!health.hasEmbedModel) missing.push(health.embedModel);
  if (missing.length) {
    el.className = 'status warn';
    el.textContent = `缺少模型：${missing.join('、')}（請 ollama pull）`;
  } else {
    el.className = 'status ok';
    el.textContent = `Ollama 就緒 · ${health.chatModel}`;
  }
}

async function loadHealth() {
  try {
    setStatus(await api('/api/health'));
  } catch {
    const el = $('#status');
    el.className = 'status bad';
    el.textContent = '無法連線後端';
  }
}

function renderDocuments() {
  const list = $('#doc-list');
  list.innerHTML = '';
  if (!state.documents.length) {
    list.innerHTML = '<li class="doc-empty">還沒有文件，先上傳一份 PDF 吧。</li>';
    return;
  }
  for (const doc of state.documents) {
    const li = document.createElement('li');
    li.className = 'doc' + (doc.id === state.selectedId ? ' active' : '');
    li.innerHTML = `
      <button class="doc-main" data-id="${doc.id}">
        <span class="doc-name">${escapeHtml(doc.name)}</span>
        <span class="doc-meta">${doc.pages} 頁 · ${doc.chunk_count} 段 · ${formatSize(doc.size)}</span>
      </button>
      <button class="doc-del" data-del="${doc.id}" title="刪除">✕</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll('.doc-main').forEach((btn) => {
    btn.addEventListener('click', () => selectDocument(Number(btn.dataset.id)));
  });
  list.querySelectorAll('.doc-del').forEach((btn) => {
    btn.addEventListener('click', () => removeDocument(Number(btn.dataset.del)));
  });
}

async function loadDocuments() {
  state.documents = await api('/api/documents');
  renderDocuments();
}

function selectDocument(id) {
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) return;
  state.selectedId = id;
  $('#chat-title').textContent = doc.name;
  $('#chat-meta').textContent = `${doc.pages} 頁 · ${doc.chunk_count} 段`;
  $('#messages').innerHTML = '';
  $('#question').disabled = false;
  $('#ask-btn').disabled = false;
  $('#question').focus();
  renderDocuments();
}

async function removeDocument(id) {
  if (!window.confirm('確定要刪除這份文件嗎？')) return;
  try {
    await api(`/api/documents/${id}`, { method: 'DELETE' });
    if (state.selectedId === id) {
      state.selectedId = null;
      $('#chat-title').textContent = '請先選擇一份文件';
      $('#chat-meta').textContent = '';
      $('#messages').innerHTML =
        '<div class="empty">選一份文件，然後在下方提問。例如：「這份文件的重點是什麼？」</div>';
      $('#question').disabled = true;
      $('#ask-btn').disabled = true;
    }
    await loadDocuments();
  } catch (err) {
    window.alert(err.message);
  }
}

function clearEmptyState() {
  const empty = $('#messages .empty');
  if (empty) empty.remove();
}

function appendMessage(role, text) {
  clearEmptyState();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  $('#messages').appendChild(div);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return div;
}

function appendSources(sources) {
  if (!sources || !sources.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'sources';
  wrap.innerHTML = '<div class="sources-title">引用來源</div>';
  for (const source of sources) {
    const div = document.createElement('div');
    div.className = 'source';
    div.innerHTML = `<b>[${source.index}] 第 ${source.page} 頁</b>（相似度 ${source.score}）<br>${escapeHtml(
      source.snippet
    )}…`;
    wrap.appendChild(div);
  }
  $('#messages').appendChild(wrap);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

async function askQuestion(question) {
  if (state.busy || !state.selectedId) return;
  state.busy = true;
  $('#ask-btn').disabled = true;
  $('#question').disabled = true;

  appendMessage('user', question);
  const typing = appendMessage('typing', '正在閱讀文件並整理答案…');

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: state.selectedId, question }),
    });
    typing.remove();
    appendMessage('assistant', data.answer || '（沒有回覆內容）');
    appendSources(data.sources);
  } catch (err) {
    typing.remove();
    appendMessage('error', err.message);
  } finally {
    state.busy = false;
    $('#ask-btn').disabled = false;
    $('#question').disabled = false;
    $('#question').focus();
  }
}

function bindUpload() {
  const fileInput = $('#file');
  const drop = $('#drop');
  const dropText = $('#drop-text');
  const uploadBtn = $('#upload-btn');
  let selectedFile = null;

  function setFile(file) {
    selectedFile = file;
    if (file) {
      dropText.textContent = file.name;
      drop.classList.add('selected');
      uploadBtn.disabled = false;
    } else {
      dropText.textContent = '點擊或拖曳 PDF 到這裡';
      drop.classList.remove('selected');
      uploadBtn.disabled = true;
    }
  }

  fileInput.addEventListener('change', () => setFile(fileInput.files[0] || null));

  ['dragenter', 'dragover'].forEach((evt) =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
    })
  );
  drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  $('#upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile || state.busy) return;

    const form = new FormData();
    form.append('file', selectedFile);
    uploadBtn.disabled = true;
    uploadBtn.textContent = '解析與建立索引中…（首次較久）';

    try {
      const doc = await api('/api/documents', { method: 'POST', body: form });
      setFile(null);
      fileInput.value = '';
      await loadDocuments();
      selectDocument(doc.id);
    } catch (err) {
      window.alert(err.message);
    } finally {
      uploadBtn.textContent = '上傳並建立索引';
      uploadBtn.disabled = !selectedFile;
    }
  });
}

function bindChat() {
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#question');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    askQuestion(question);
  });
}

async function init() {
  bindUpload();
  bindChat();
  await loadHealth();
  try {
    await loadDocuments();
  } catch (err) {
    appendMessage('error', err.message);
  }
}

init();
