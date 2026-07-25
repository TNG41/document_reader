const crypto = require('crypto');

const COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'dr_csrf';
const HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit cookie CSRF check.
 *
 * This API is stateless (no auth cookie today), so CSRF isn't currently
 * exploitable — a forged cross-site request has no session to ride on.
 * The middleware is included anyway because the moment this app adds
 * cookie-based sessions (the natural next step for a "real" product),
 * every state-changing route already requires a token that a third-party
 * site cannot read or forge, since the browser's same-origin policy
 * blocks it from ever seeing dr_csrf's value.
 */
function issueCsrfToken(req, res, next) {
  if (!req.cookies || !req.cookies[COOKIE_NAME]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false, // must be readable by frontend JS to echo back in the header
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[COOKIE_NAME];
  }
  next();
}

function verifyCsrfToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies ? req.cookies[COOKIE_NAME] : undefined;
  const headerToken = req.get(HEADER_NAME);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF_TOKEN_INVALID' });
  }
  return next();
}

module.exports = { issueCsrfToken, verifyCsrfToken, COOKIE_NAME, HEADER_NAME };
