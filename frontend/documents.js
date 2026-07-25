const docsSection = document.getElementById('docsSection');
const docList = document.getElementById('docList');
const docsEmpty = document.getElementById('docsEmpty');
const othersTabBtn = document.getElementById('othersTabBtn');
const docsBreadcrumb = document.getElementById('docsBreadcrumb');

const viewerSection = document.getElementById('viewerSection');
const viewerFilename = document.getElementById('viewerFilename');
const viewerUploader = document.getElementById('viewerUploader');
const viewerFrameWrap = document.getElementById('viewerFrameWrap');
const closeViewerBtn = document.getElementById('closeViewerBtn');
const downloadBtn = document.getElementById('downloadBtn');
const docsPlaceholder = document.getElementById('docsPlaceholder');

const errorBanner = document.getElementById('errorBanner');

// Only roles that can see everyone's documents (see canViewAll() on the
// server, backend/src/routes/documents.js) have anyone else's uploads to
// browse — a plain 'user' only ever gets their own documents back from
// GET /api/documents, so there's nothing for the tab to show them.
const OFFICER_PLUS = ['officer', 'executive', 'admin'];

let allDocuments = [];
let mode = 'mine'; // 'mine' | 'others-picker' | 'others-docs'
let selectedUploader = null;

initAuth((user) => {
  othersTabBtn.hidden = !OFFICER_PLUS.includes(user.role);
  loadDocuments();
});

othersTabBtn.addEventListener('click', () => {
  mode = mode === 'mine' ? 'others-picker' : 'mine';
  selectedUploader = null;
  renderCurrentView();
});

docsBreadcrumb.addEventListener('click', () => {
  mode = 'others-picker';
  selectedUploader = null;
  renderCurrentView();
});

closeViewerBtn.addEventListener('click', () => {
  hideViewer();
});

function hideViewer() {
  viewerSection.hidden = true;
  viewerFrameWrap.innerHTML = '';
  docsPlaceholder.hidden = false;
}

function showError(message) {
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

async function loadDocuments() {
  errorBanner.hidden = true;
  try {
    const res = await fetch(`${API_BASE}/documents`, { credentials: 'include' });
    if (res.status === 401) {
      redirectToSignin();
      return;
    }
    if (!res.ok) throw new Error(`couldn't load documents (${res.status})`);
    const { documents } = await res.json();
    allDocuments = documents;
    renderCurrentView();
  } catch (err) {
    showError(err.message);
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Dispatches to the right sidebar content for the current tab/sub-view. */
function renderCurrentView() {
  othersTabBtn.classList.toggle('active', mode !== 'mine');
  docsBreadcrumb.hidden = mode !== 'others-docs';

  if (mode === 'mine') {
    const mine = allDocuments.filter((d) => d.owner_id === currentUser.id);
    renderList(mine, 'Nothing saved yet — upload a file from the reader page to see it here.');
  } else if (mode === 'others-picker') {
    renderUploaderPicker();
  } else {
    docsBreadcrumb.textContent = `‹ back to users · viewing ${selectedUploader.email}`;
    const theirs = allDocuments.filter((d) => d.owner_id === selectedUploader.id);
    renderList(theirs, `${selectedUploader.email} hasn't uploaded anything yet.`);
  }
}

/** Distinct uploaders (excluding yourself) derived from the documents you
 * already have visibility into — no extra endpoint needed, since anyone
 * who can see this tab already receives everyone's documents (with their
 * uploader email attached) from GET /api/documents. */
function renderUploaderPicker() {
  docList.innerHTML = '';

  const byId = new Map();
  allDocuments.forEach((d) => {
    if (d.owner_id === currentUser.id) return;
    if (!byId.has(d.owner_id)) {
      byId.set(d.owner_id, { id: d.owner_id, email: d.uploaded_by_email || 'unknown', count: 0 });
    }
    byId.get(d.owner_id).count += 1;
  });
  const uploaders = Array.from(byId.values()).sort((a, b) => a.email.localeCompare(b.email));

  docsEmpty.hidden = uploaders.length > 0;
  docsEmpty.textContent = 'No other users have uploaded anything yet.';

  uploaders.forEach((uploader) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'doc-row uploader-row';

    const info = document.createElement('div');
    info.className = 'doc-info';

    const name = document.createElement('p');
    name.className = 'doc-name';
    name.textContent = uploader.email; // textContent — server data, still untrusted

    const meta = document.createElement('p');
    meta.className = 'doc-meta';
    meta.textContent = `${uploader.count} document${uploader.count === 1 ? '' : 's'}`;

    info.append(name, meta);
    row.appendChild(info);
    row.addEventListener('click', () => {
      selectedUploader = uploader;
      mode = 'others-docs';
      renderCurrentView();
    });
    docList.appendChild(row);
  });
}

function renderList(documents, emptyMessage) {
  docList.innerHTML = '';
  docsEmpty.hidden = documents.length > 0;
  docsEmpty.textContent = emptyMessage;

  documents.forEach((doc) => {
    const row = document.createElement('div');
    row.className = 'doc-row';

    const info = document.createElement('div');
    info.className = 'doc-info';

    const name = document.createElement('p');
    name.className = 'doc-name';
    name.textContent = doc.original_filename;

    const meta = document.createElement('p');
    meta.className = 'doc-meta';
    meta.textContent = `${doc.mime_type} · ${formatDate(doc.uploaded_at)}`;

    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'doc-actions';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn-primary';
    viewBtn.type = 'button';
    viewBtn.textContent = 'view';
    viewBtn.addEventListener('click', () => openViewer(doc));

    actions.append(viewBtn);

    // Only the owner or an admin can delete — matches the server-side
    // check in DELETE /api/documents/:id, so this just avoids showing a
    // button that would 403 anyway.
    if (doc.owner_id === currentUser.id || currentUser.role === 'admin') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-ghost';
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'delete';
      deleteBtn.addEventListener('click', () => deleteDocument(doc.id));
      actions.append(deleteBtn);
    }

    row.append(info, actions);
    docList.appendChild(row);
  });
}

function openViewer(doc) {
  errorBanner.hidden = true;
  viewerFilename.textContent = doc.original_filename;
  viewerUploader.textContent = `uploaded by ${doc.uploaded_by_email || 'unknown'}`;
  viewerFrameWrap.innerHTML = '';

  const fileUrl = `${API_BASE}/documents/${doc.id}/file`;
  downloadBtn.href = fileUrl;
  downloadBtn.download = doc.original_filename;
  if (doc.mime_type === 'application/pdf') {
    viewerFrameWrap.appendChild(buildPdfViewer(fileUrl, doc.original_filename));
  } else {
    const img = document.createElement('img');
    img.src = fileUrl;
    img.alt = doc.original_filename;
    viewerFrameWrap.appendChild(img);
  }

  docsPlaceholder.hidden = true;
  viewerSection.hidden = false;
  viewerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteDocument(id) {
  if (!window.confirm('Delete this document? This can\'t be undone.')) return;
  try {
    if (!csrfToken) await fetchCsrfToken();
    const res = await fetch(`${API_BASE}/documents/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken },
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`couldn't delete document (${res.status})`);
    }
    hideViewer();
    loadDocuments();
  } catch (err) {
    showError(err.message);
  }
}
