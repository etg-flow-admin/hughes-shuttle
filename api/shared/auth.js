// api/shared/auth.js
const jwt        = require('jsonwebtoken');
const { getSecret } = require('./keyVault');

async function verifyToken(req) {
  const auth  = (req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw { status: 401, message: 'No token provided.' };
  const secret = await getSecret('jwt-secret');
  try {
    return jwt.verify(token, secret);
  } catch (e) {
    throw { status: 401, message: 'Invalid or expired session.' };
  }
}

async function requireAdmin(req) {
  const payload = await verifyToken(req);
  if (!payload.isAdmin) throw { status: 403, message: 'Admin access required.' };
  return payload;
}

function authError(context, err) {
  context.res = { status: err.status || 500, body: { error: err.message || 'Authentication error.' } };
}

module.exports = { verifyToken, requireAdmin, authError };
