const multer = require('multer');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code });
  }
  if (err.message === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(415).json({ error: 'UNSUPPORTED_FILE_TYPE' });
  }

  console.error(err); // full detail goes to server logs only

  const isProd = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    // Stack traces and DB error text are never sent to the client in prod —
    // they can leak schema details useful for further attacks.
    detail: isProd ? undefined : err.message,
  });
}

module.exports = errorHandler;
