const fs = require('fs/promises');
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');
const { query } = require('../config/db');

const EXTRACTION_TIMEOUT_MS = Number(process.env.EXTRACTION_TIMEOUT_MS) || 90_000;

/**
 * Extracts text from a stored file and writes one row per page to
 * extracted_pages. Runs off the HTTP request/response cycle (called
 * fire-and-forget from the route, tracked via processing_jobs) since
 * OCR on a large image can take several seconds.
 */
async function extractDocument(documentId, storedPath, mimeType) {
  await markJob(documentId, 'running', { started_at: new Date() });

  try {
    const work = mimeType === 'application/pdf'
      ? extractPdf(documentId, storedPath)
      : extractImage(documentId, storedPath);

    // A hard timeout, not just a try/catch: some failure modes (a worker
    // thread that dies without ever posting a message back, a stalled
    // network call) never reject the underlying promise at all, which
    // would otherwise leave the document stuck on 'processing' forever
    // with no user-visible error. This guarantees the job resolves one
    // way or the other within a bounded time.
    await withTimeout(work, EXTRACTION_TIMEOUT_MS, 'extraction timed out');

    await setDocumentStatus(documentId, 'done');
    await markJob(documentId, 'succeeded', { finished_at: new Date() });
  } catch (err) {
    await setDocumentStatus(documentId, 'failed');
    await markJob(documentId, 'failed', { finished_at: new Date(), error_message: err.message });
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function extractPdf(documentId, storedPath) {
  const buffer = await fs.readFile(storedPath);

  // pdf-parse gives combined text; splitting on form-feed approximates
  // page boundaries for most producers. Good enough for a reader UI —
  // a production version would use pdf.js per-page rendering instead.
  const { text } = await pdfParse(buffer);
  const pages = text.split('\f').filter((p) => p.trim().length > 0);
  const effectivePages = pages.length > 0 ? pages : [text];

  for (let i = 0; i < effectivePages.length; i += 1) {
    await insertPage(documentId, i + 1, effectivePages[i]);
  }
}

async function extractImage(documentId, storedPath) {
  // Without an errorHandler, tesseract.js throws worker errors directly
  // (bypassing the promise chain) instead of just rejecting recognize() —
  // which becomes an uncaught exception our try/catch below can never see.
  // The promise is already rejected internally before this callback runs,
  // so a no-op here (rather than re-throwing) is what actually lets the
  // rejection below be caught normally.
  const worker = await createWorker('eng', 1, {
    errorHandler: () => {},
  });
  try {
    const { data } = await worker.recognize(storedPath);
    await insertPage(documentId, 1, data.text);
  } finally {
    await worker.terminate();
  }
}

async function insertPage(documentId, pageNumber, content) {
  await query(
    `INSERT INTO extracted_pages (document_id, page_number, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id, page_number) DO UPDATE SET content = EXCLUDED.content`,
    [documentId, pageNumber, content],
  );
}

async function setDocumentStatus(documentId, status) {
  await query('UPDATE documents SET status = $1 WHERE id = $2', [status, documentId]);
}

async function markJob(documentId, status, extra = {}) {
  const fields = ['status = $2'];
  const params = [documentId, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    fields.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  }
  await query(
    `UPDATE processing_jobs SET ${fields.join(', ')} WHERE document_id = $1
       AND id = (SELECT id FROM processing_jobs WHERE document_id = $1 ORDER BY id DESC LIMIT 1)`,
    params,
  );
}

module.exports = { extractDocument };
