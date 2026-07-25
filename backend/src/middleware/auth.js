const jwt = require('jsonwebtoken');
const { isAtLeast } = require('../utils/roles');

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'dr_session';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // never readable by frontend JS — the main XSS mitigation for session theft
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/** Requires a valid session; attaches { id, email, role } to req.user. */
function authenticate(req, res, next) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : undefined;
  if (!token) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'SESSION_EXPIRED_OR_INVALID' });
  }
}

/**
 * Requires req.user.role to be at least `minRole` in the
 * user < officer < executive < admin hierarchy. Call after authenticate().
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    if (!isAtLeast(req.user.role, minRole)) {
      return res.status(403).json({ error: 'INSUFFICIENT_ROLE' });
    }
    return next();
  };
}

module.exports = {
  signToken, setSessionCookie, clearSessionCookie, authenticate, requireRole, COOKIE_NAME,
};
