const multer = require('multer');
const fs = require('fs');
const { isAllowedMimeType, buildSafeStoredFilename } = require('../utils/validators');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, buildSafeStoredFilename(file.mimetype)),
});

function fileFilter(_req, file, cb) {
  if (!isAllowedMimeType(file.mimetype)) {
    // Reject before the file is ever written to disk.
    return cb(new Error('UNSUPPORTED_FILE_TYPE'), false);
  }
  return cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 1,
    fileSize: MAX_UPLOAD_BYTES,
  },
});

module.exports = { upload, UPLOAD_DIR, MAX_UPLOAD_BYTES };
