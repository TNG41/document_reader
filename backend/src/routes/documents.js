const express = require('express');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { query } = require('../config/db');
const { upload, UPLOAD_DIR } = require('../middleware/upload');
const { sanitizeDisplayFilename } = require('../utils/validators');
const { extractDocument } = require('../services/extraction');
const { authenticate } = require('../middleware/auth');
const { isAtLeast } = require('../utils/roles');

const router = express.Router();

router.use(authenticate);

function canViewAll(role) {
  return isAtLeast(role, 'officer');
}

router.get('/', async (req, res, next) => {
  try {
    const sql = canViewAll(req.user.role)
      ? `SELECT d.*, u.email AS uploaded_by_email
         FROM documents d
         LEFT JOIN users u ON u.id = d.uploaded_by
         ORDER BY d.uploaded_at DESC LIMIT 200`
      : `SELECT d.*, u.email AS uploaded_by_email
         FROM documents d
         LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE d.owner_id = $1
         ORDER BY d.uploaded_at DESC LIMIT 200`;
    const params = canViewAll(req.user.role) ? [] : [req.user.id];
    const { rows } = await query(sql, params);
    return res.json({ documents: rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'FILE_REQUIRED' });
    }

    // multer/busboy decode the multipart filename header as latin1 by
    // default, so any UTF-8 filename (Thai, Chinese, emoji, etc.) comes
    // through mangled. Re-decode the raw bytes as utf8 before it's ever
    // sanitized, stored, or shown back to the user.
    const utf8OriginalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const displayName = sanitizeDisplayFilename(utf8OriginalName);

    // Status defaults to 'uploaded' — the file is immediately viewable.
    // Text extraction is a separate, on-demand step (POST /:id/extract),
    // not something every upload pays the OCR/parse cost for up front.
    const { rows } = await query(
      `INSERT INTO documents (owner_id, uploaded_by, original_filename, stored_filename, mime_type, file_size_bytes)
       VALUES ($1, $1, $2, $3, $4, $5)
       RETURNING id, owner_id, uploaded_by, original_filename, mime_type, file_size_bytes, status, uploaded_at`,
      [req.user.id, displayName, req.file.filename, req.file.mimetype, req.file.size],
    );
    const document = { ...rows[0], uploaded_by_email: req.user.email };

    return res.status(201).json({ document });
  } catch (err) {
    return next(err);
  }
});

async function loadOwnedOrVisible(req, res) {
  const { rows } = await query(
    `SELECT d.*, u.email AS uploaded_by_email
     FROM documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = $1`,
    [req.params.id],
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return null;
  }
  const doc = rows[0];
  const isOwner = doc.owner_id === req.user.id;
  if (!isOwner && !canViewAll(req.user.role)) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return null;
  }
  return doc;
}

router.get('/:id', async (req, res, next) => {
  try {
    const doc = await loadOwnedOrVisible(req, res);
    if (!doc) return undefined;
    return res.json({ document: doc });
  } catch (err) {
    return next(err);
  }
});

// Streams the original file back so the browser can render it natively
// (PDF viewer / <img>) instead of the app re-implementing a renderer.
router.get('/:id/file', async (req, res, next) => {
  try {
    const doc = await loadOwnedOrVisible(req, res);
    if (!doc) return undefined;

    const filePath = path.join(UPLOAD_DIR, doc.stored_filename);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'FILE_MISSING_ON_DISK' });
    }

    // Explicit headers rather than relying on sendFile's extension-based
    // guess — stored_filename is a UUID, so the DB's mime_type is the only
    // reliable source of truth for what this actually is.
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Length', stat.size);
    // inline (not attachment) so PDFs/images render in the browser rather
    // than triggering a download prompt.
    res.setHeader('Content-Disposition', 'inline');

    const stream = fsSync.createReadStream(filePath);
    stream.on('error', next);
    return stream.pipe(res);
  } catch (err) {
    return next(err);
  }
});

// On-demand text extraction ("scan to text") — a separate step from
// upload/view, since most files are only ever opened, not OCR'd.
router.post('/:id/extract', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });

    const doc = existing[0];
    const isOwner = doc.owner_id === req.user.id;
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (doc.status === 'processing') {
      return res.status(409).json({ error: 'EXTRACTION_ALREADY_RUNNING' });
    }

    await query('UPDATE documents SET status = $1 WHERE id = $2', ['processing', doc.id]);
    await query('INSERT INTO processing_jobs (document_id, status) VALUES ($1, $2)', [doc.id, 'queued']);

    const filePath = path.join(UPLOAD_DIR, doc.stored_filename);
    extractDocument(doc.id, filePath, doc.mime_type);

    return res.status(202).json({ status: 'processing' });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/pages', async (req, res, next) => {
  try {
    const doc = await loadOwnedOrVisible(req, res);
    if (!doc) return undefined;

    const { rows } = await query(
      'SELECT page_number, content, char_count FROM extracted_pages WHERE document_id = $1 ORDER BY page_number',
      [req.params.id],
    );
    return res.json({ pages: rows });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows: existing } = await query('SELECT owner_id, stored_filename FROM documents WHERE id = $1', [
      req.params.id,
    ]);
    if (existing.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });

    const isOwner = existing[0].owner_id === req.user.id;
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    await query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    const filePath = path.join(UPLOAD_DIR, existing[0].stored_filename);
    await fs.unlink(filePath).catch(() => {});

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
