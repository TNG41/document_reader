const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileNameEl = document.getElementById('fileName');

const viewerSection = document.getElementById('viewerSection');
const viewerEyebrow = document.getElementById('viewerEyebrow');
const viewerFilename = document.getElementById('viewerFilename');
const viewerFrameWrap = document.getElementById('viewerFrameWrap');
const confirmUploadBtn = document.getElementById('confirmUploadBtn');
const cancelPreviewBtn = document.getElementById('cancelPreviewBtn');
const scanBtn = document.getElementById('scanBtn');
const downloadBtn = document.getElementById('downloadBtn');
const deleteBtn = document.getElementById('deleteBtn');
const resetBtn = document.getElementById('resetBtn');

const queueSection = document.getElementById('queue');
const queueStatus = document.getElementById('queueStatus');

const resultSection = document.getElementById('result');
const pageTabs = document.getElementById('pageTabs');
const resultBody = document.getElementById('resultBody');
const copyBtn = document.getElementById('copyBtn');
const hideTextBtn = document.getElementById('hideTextBtn');

const errorBanner = document.getElementById('errorBanner');

let pagesCache = [];
let activeDocument = null; // { id, mime_type, original_filename }
let selectedFile = null;
let previewUrl = null; // object URL for the not-yet-uploaded preview, revoked on transition

initAuth();

browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) stageFile(e.target.files[0]);
});

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => e.preventDefault());
});
dropzone.addEventListener('dragover', () => dropzone.classList.add('dragover'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) stageFile(file);
});

confirmUploadBtn.addEventListener('click', () => {
  if (selectedFile) handleFile(selectedFile);
});
cancelPreviewBtn.addEventListener('click', () => backToIntake());

resetBtn.addEventListener('click', () => backToIntake());
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(resultBody.textContent);
  copyBtn.textContent = 'copied';
  setTimeout(() => { copyBtn.textContent = 'copy text'; }, 1500);
});
hideTextBtn.addEventListener('click', () => { resultSection.hidden = true; });

scanBtn.addEventListener('click', () => {
  if (activeDocument) startExtraction(activeDocument.id);
});

deleteBtn.addEventListener('click', async () => {
  if (!activeDocument) return;
  if (!window.confirm('Delete this document? This can\'t be undone.')) return;
  try {
    if (!csrfToken) await fetchCsrfToken();
    await fetch(`${API_BASE}/documents/${activeDocument.id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken },
    });
  } catch {
    // best-effort — even if the request fails, take the user back to intake
  }
  backToIntake();
});

function revokePreview() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

function backToIntake() {
  activeDocument = null;
  pagesCache = [];
  selectedFile = null;
  revokePreview();
  viewerSection.hidden = true;
  queueSection.hidden = true;
  resultSection.hidden = true;
  errorBanner.hidden = true;
  viewerFrameWrap.innerHTML = '';
  fileNameEl.textContent = '';
  fileInput.value = '';
  setViewerMode('preview');
}

// Toggles which action buttons are visible: 'preview' (staged, not yet
// uploaded — confirm/cancel) or 'viewing' (uploaded — scan/delete/reset).
function setViewerMode(mode) {
  const isPreview = mode === 'preview';
  confirmUploadBtn.hidden = !isPreview;
  cancelPreviewBtn.hidden = !isPreview;
  scanBtn.hidden = isPreview;
  downloadBtn.hidden = isPreview;
  deleteBtn.hidden = isPreview;
  resetBtn.hidden = isPreview;
  viewerEyebrow.textContent = isPreview ? '02 — preview (not yet uploaded)' : '02 — viewing';
  confirmUploadBtn.disabled = false;
  confirmUploadBtn.textContent = 'confirm upload';
}

function stageFile(file) {
  errorBanner.hidden = true;
  queueSection.hidden = true;
  resultSection.hidden = true;
  selectedFile = file;
  fileNameEl.textContent = file.name;

  revokePreview();
  previewUrl = URL.createObjectURL(file);

  viewerFilename.textContent = file.name;
  viewerFrameWrap.innerHTML = '';
  if (file.type === 'application/pdf') {
    viewerFrameWrap.appendChild(buildPdfViewer(previewUrl, file.name));
  } else {
    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = file.name;
    viewerFrameWrap.appendChild(img);
  }

  setViewerMode('preview');
  viewerSection.hidden = false;
  viewerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showError(message) {
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

async function handleFile(file) {
  errorBanner.hidden = true;
  confirmUploadBtn.disabled = true;
  confirmUploadBtn.textContent = 'uploading…';
  cancelPreviewBtn.disabled = true;

  if (!csrfToken) await fetchCsrfToken();

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/documents`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      credentials: 'include',
      body: formData,
    });

    if (res.status === 401) {
      redirectToSignin();
      throw new Error('Your session expired — please sign in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `upload failed (${res.status})`);
    }

    const { document: doc } = await res.json();
    selectedFile = null;
    showViewer(doc);
  } catch (err) {
    confirmUploadBtn.disabled = false;
    confirmUploadBtn.textContent = 'confirm upload';
    cancelPreviewBtn.disabled = false;
    showError(err.message);
  }
}

function showViewer(doc) {
  activeDocument = doc;
  pagesCache = [];
  revokePreview();
  queueSection.hidden = true;
  resultSection.hidden = true;
  viewerSection.hidden = false;
  viewerFilename.textContent = doc.original_filename;
  fileNameEl.textContent = '';
  fileInput.value = '';
  cancelPreviewBtn.disabled = false;
  setViewerMode('viewing');

  const fileUrl = `${API_BASE}/documents/${doc.id}/file`;
  downloadBtn.href = fileUrl;
  downloadBtn.download = doc.original_filename;
  viewerFrameWrap.innerHTML = '';

  if (doc.mime_type === 'application/pdf') {
    viewerFrameWrap.appendChild(buildPdfViewer(fileUrl, doc.original_filename));
  } else {
    const img = document.createElement('img');
    img.src = fileUrl;
    img.alt = doc.original_filename;
    viewerFrameWrap.appendChild(img);
  }
}

async function startExtraction(documentId) {
  errorBanner.hidden = true;
  resultSection.hidden = true;

  try {
    if (!csrfToken) await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/documents/${documentId}/extract`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken },
    });
    if (!res.ok && res.status !== 409) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `couldn't start scan (${res.status})`);
    }

    queueSection.hidden = false;
    queueStatus.textContent = 'processing';
    pollStatus(documentId);
  } catch (err) {
    showError(err.message);
  }
}

async function pollStatus(documentId) {
  const res = await fetch(`${API_BASE}/documents/${documentId}`, { credentials: 'include' });
  const { document: doc } = await res.json();
  queueStatus.textContent = doc.status;

  if (doc.status === 'done') {
    await loadPages(documentId);
  } else if (doc.status === 'failed') {
    queueSection.hidden = true;
    showError('scan failed — try a clearer file, or a different one.');
  } else {
    setTimeout(() => pollStatus(documentId), 1200);
  }
}

async function loadPages(documentId) {
  const res = await fetch(`${API_BASE}/documents/${documentId}/pages`, { credentials: 'include' });
  const { pages } = await res.json();
  pagesCache = pages;

  queueSection.hidden = true;
  resultSection.hidden = false;
  renderTabs();
  renderPage(0);
}

function renderTabs() {
  pageTabs.innerHTML = '';
  pagesCache.forEach((page, i) => {
    const tab = document.createElement('button');
    tab.className = `page-tab${i === 0 ? ' active' : ''}`;
    tab.type = 'button';
    tab.textContent = `page ${page.page_number}`;
    tab.addEventListener('click', () => {
      document.querySelectorAll('.page-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderPage(i);
    });
    pageTabs.appendChild(tab);
  });
}

function renderPage(index) {
  const page = pagesCache[index];
  // textContent, never innerHTML: extracted text came from a user-uploaded
  // file and must never be parsed as HTML/JS by the browser.
  resultBody.textContent = page ? page.content : '(no text found on this page)';
}
