require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const documentsRouter = require('./routes/documents');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const errorHandler = require('./middleware/errorHandler');
const { issueCsrfToken, verifyCsrfToken } = require('./middleware/csrf');

// Text extraction (extractDocument) runs fire-and-forget, off the request
// cycle. Some of its dependencies (tesseract.js in particular) throw from
// a worker message handler rather than rejecting a promise when something
// goes wrong — e.g. no network access to fetch the OCR language data —
// which Node treats as an uncaught exception and would otherwise kill the
// whole process, taking down every other user's session with it. Catching
// it here keeps that failure scoped to the one job that caused it; the
// job itself is already marked 'failed' in processing_jobs by extraction.js.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (process kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (process kept alive):', reason);
});

const app = express();

// Requests now arrive via the nginx service (see docker-compose.yml),
// not directly from clients. Without this, req.ip would be nginx's own
// container IP for every request — collapsing the per-IP auth rate
// limiter below into one shared bucket for all users. `1` trusts exactly
// one hop (the nginx container), reading the real client IP from the
// X-Forwarded-For header nginx sets in nginx.conf.
app.set('trust proxy', 1);

// --- Security headers (mitigates a chunk of XSS/clickjacking classes for free) ---
app.use(helmet({
  // Same-origin static frontend + API means we can run a real CSP instead
  // of disabling it; still permissive on connect-src for local dev.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", 'fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      // blob: is needed for the reader's pre-upload preview: it renders the
      // chosen file locally via URL.createObjectURL() before anything is
      // sent to the server, so both an <img src="blob:..."> (images) and an
      // <iframe src="blob:..."> (PDFs) need to be allowed here.
      imgSrc: ["'self'", 'data:', 'blob:'],
      frameSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      // Helmet's directive defaults (merged in automatically since
      // useDefaults isn't set to false) include upgrade-insecure-requests,
      // which tells the browser to rewrite every http: request the page
      // makes — including its own CSS/JS — to https:. This server has no
      // TLS listener of its own (that's meant to sit in front of it, e.g.
      // a reverse proxy, when deployed for real); until then, that rewrite
      // just makes every asset request fail with nothing rendering past
      // the raw HTML. Explicitly nulling it out restores plain-HTTP access
      // (localhost, a LAN IP, etc.) without touching any other directive.
      upgradeInsecureRequests: null,
    },
  },
}));

app.use(
  cors({
    // Only needed if the frontend is ever served from a different origin
    // (e.g. a separate static host). When Express serves both, as below,
    // requests are same-origin and CORS never enters the picture.
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));
app.use(require('cookie-parser')());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Upload endpoint gets its own tighter limiter — it's the expensive one (disk + OCR).
const uploadLimiter = rateLimit({
  windowMs: 3000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(issueCsrfToken);
app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: req.csrfToken }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// CSRF check applies to every state-changing API route, including login/
// register: the frontend always fetches /api/csrf-token first (a safe GET,
// unauthenticated), so this doesn't block anonymous visitors — it just
// closes the door on a third-party site forging the request on their behalf.
app.use('/api/auth', verifyCsrfToken, authRouter);
app.use('/api/users', verifyCsrfToken, usersRouter);
app.use('/api/documents', verifyCsrfToken, uploadLimiter, documentsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'ROUTE_NOT_FOUND' }));

// Serve the frontend (index.html, app.js, style.css) from the same process —
// no Docker, no nginx, no second dev server. Resolves relative to the repo
// root locally; FRONTEND_DIR overrides it for the container layout, where
// the frontend is copied to a different relative location (see Dockerfile).
const FRONTEND_DIR = process.env.FRONTEND_DIR
  ? path.resolve(process.env.FRONTEND_DIR)
  : path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

app.use(errorHandler);

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`document-reader running at http://localhost:${PORT}`));
}

module.exports = app;
