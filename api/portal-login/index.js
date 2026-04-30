// POST /api/portal-login
// { email, password } → { token, name, isAdmin }
const bcrypt        = require('bcrypt');
const { wrapHandler }    = require('../shared/logger');
const jwt           = require('jsonwebtoken');
const { getListItem, updateListItem } = require('../shared/msLists');
const { getSecret } = require('../shared/keyVault');

module.exports = wrapHandler('portal-login', async function (context, req) {
  const { email: raw, password } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!email || !password) {
    context.res = { status: 400, body: { error: 'Email and password are required.' } }; return;
  }
  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);

    // Log all field keys so we can see exact Graph API field names
    context.log.info('portal-login fields:', JSON.stringify(user ? Object.keys(user) : null));

    // Graph API may return field names with different casing — handle both
    const passwordHash  = user?.PasswordHash  || user?.passwordHash  || null;
    const emailVerified = user?.EmailVerified  ?? user?.emailVerified ?? false;
    const userStatus    = user?.Status         || user?.status        || '';
    const isAdmin       = user?.IsAdmin === true || user?.isAdmin === true;
    const userName      = user?.Name           || user?.name          || '';
    const studentId     = user?.StudentID      || user?.studentId     || '';

    context.log.info('portal-login:', { passwordHash: passwordHash ? 'present' : 'MISSING', emailVerified, userStatus });

    const hash  = passwordHash || '$2b$10$invalidhashtopreventtimingattack00000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      context.res = { status: 401, body: { error: 'Incorrect email or password.' } }; return;
    }
    if (userStatus === 'Suspended') {
      context.res = { status: 403, body: { error: 'Your account has been suspended. Please contact support.' } }; return;
    }
    if (!emailVerified) {
      context.res = { status: 403, body: { error: 'Please verify your email before signing in.', requiresVerification: true, email } }; return;
    }

    const secret = await getSecret('jwt-secret');
    const token  = jwt.sign(
      { email, name: userName, studentId, isAdmin },
      secret, { expiresIn: '7d' }
    );

    // Fire-and-forget last login update
    updateListItem('ShuttleUsers', user.ID, { LastLoginAt: new Date().toISOString() }).catch(() => {});

    context.res = { status: 200, body: { token, name: userName, email, isAdmin } };
  } catch (err) {
    context.log.error('portal-login:', err.message);
    context.res = { status: 500, body: { error: 'Login failed. Please try again.' } };
    throw err;
  }
});
