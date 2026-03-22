const jwt = require('jsonwebtoken');

function jwtSecret() {
  const s = (process.env.JWT_SECRET || '').trim();
  if (s) return s;
  return 'pran-dev-jwt-secret-change-me';
}

/**
 * Verifies Authorization: Bearer <token> and sets req.userId (Mongo ObjectId string).
 */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: 'Not authenticated', hint: 'Login and send Bearer token.' });
  }
  try {
    const payload = jwt.verify(m[1], jwtSecret());
    const uid = payload.sub || payload.userId;
    if (!uid) return res.status(401).json({ error: 'Invalid token' });
    req.userId = uid;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signUserToken(userId) {
  return jwt.sign(
    { sub: String(userId) },
    jwtSecret(),
    { expiresIn: '30d' }
  );
}

module.exports = { requireAuth, signUserToken, jwtSecret };
