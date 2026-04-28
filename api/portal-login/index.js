// POST /api/portal-login
// { email, password } → { token, name, isAdmin }
const bcrypt        = require('bcrypt');
const jwt           = require('jsonwebtoken');
const { getListItem, updateListItem } = require('../shared/msLists');
const { getSecret } = require('../shared/keyVault');

module.exports = async function (context, req) {
  const { email: raw, password } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!email || !password) {
    context.res = { status: 400, body: { error: 'Email and password are required.' } }; return;
  }
  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    const hash = user?.PasswordHash || '$2b$10$invalidhashtopreventtimingattack00000000000000000';
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) {
      context.res = { status: 401, body: { error: 'Incorrect email or password.' } }; return;
    }
    if (user.Status === 'Suspended') {
      context.res = { status: 403, body: { error: 'Your account has been suspended. Please contact support.' } }; return;
    }
    if (!user.EmailVerified) {
      context.res = { status: 403, body: { error: 'Please verify your email before signing in.', requiresVerification: true, email } }; return;
    }
    const secret = await getSecret('jwt-secret');
    const token  = jwt.sign(
      { email, name: user.Name, studentId: user.StudentID, isAdmin: user.IsAdmin === true },
      secret, { expiresIn: '7d' }
    );
    // Fire-and-forget last login update
    updateListItem('ShuttleUsers', user.ID, { LastLoginAt: new Date().toISOString() }).catch(() => {});
    context.res = { status: 200, body: { token, name: user.Name, email, isAdmin: user.IsAdmin === true } };
  } catch (err) {
    context.log.error('portal-login:', err.message);
    context.res = { status: 500, body: { error: 'Login failed. Please try again.' } };
  }
};
