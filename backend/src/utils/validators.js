const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Whitelist, not blacklist — anything not on this list is rejected outright.
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const EXTENSION_BY_MIME = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function isAllowedMimeType(mimeType) {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

/**
 * Never trust the client-supplied filename for anything beyond display.
 * Generate a fresh UUID-based name server-side so path traversal
 * ("../../etc/passwd"), null bytes, and duplicate-name collisions
 * are impossible.
 */
function buildSafeStoredFilename(mimeType) {
  const ext = EXTENSION_BY_MIME[mimeType] || '';
  return `${uuidv4()}${ext}`;
}

/**
 * Strip anything but a plain basename before ever showing the original
 * filename back to a user, since it will be rendered in the UI.
 */
function sanitizeDisplayFilename(originalName) {
  const base = path.basename(originalName);
  return base.slice(0, 255);
}

module.exports = {
  ALLOWED_MIME_TYPES,
  isAllowedMimeType,
  buildSafeStoredFilename,
  sanitizeDisplayFilename,
};
