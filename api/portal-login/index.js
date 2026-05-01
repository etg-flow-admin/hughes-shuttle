// POST /api/portal-login
// { email, password, deviceToken? } → { token, name, isAdmin } or { requires2FA: true }
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { wrapHandler }    = require('../shared/logger');
const jwt                = require('jsonwebtoken');
const { getListItem, updateListItem } = require('../shared/msLists');
const { getSecret }      = require('../shared/keyVault');
const { sendEmail }      = require('../shared/email');

module.exports = wrapHandler('portal-login', async function (context, req) {
  const { email: raw, password, deviceToken } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!email || !password) {
    context.res = { status: 400, body: { error: 'Email and password are required.' } }; return;
  }
  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);

    context.log.info('portal-login fields:', JSON.stringify(user ? Object.keys(user) : null));

    const passwordHash  = user?.PasswordHash  || user?.passwordHash  || null;
    const emailVerified = user?.EmailVerified === true || user?.EmailVerified === 'Yes' || user?.EmailVerified === 1
      || user?.emailVerified === true || user?.emailVerified === 'Yes' || user?.emailVerified === 1 || false;
    const userStatus    = user?.Status  || user?.status  || '';
    const isAdmin       = user?.IsAdmin === true || user?.isAdmin === true;
    const userName      = user?.Name    || user?.name    || '';
    const studentId     = user?.StudentID || user?.studentId || '';

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

    // ── 2FA for admins ──
    if (isAdmin) {
      // Check trusted device token
      if (deviceToken) {
        let devices = [];
        try { devices = JSON.parse(user.TrustedDevices || '[]'); } catch(e) {}
        const now = Date.now();
        const match = devices.find(d => {
          try {
            const buf = Buffer.from(d.tokenHash, 'hex');
            const candidate = Buffer.from(crypto.createHash('sha256').update(deviceToken).digest('hex'), 'hex');
            return crypto.timingSafeEqual(buf, candidate) && new Date(d.expiry).getTime() > now;
          } catch(e) { return false; }
        });
        if (match) {
          // Trusted device — issue JWT directly
          const secret = await getSecret('jwt-secret');
          const token  = jwt.sign({ email, name: userName, studentId, isAdmin }, secret, { expiresIn: '7d' });
          updateListItem('ShuttleUsers', user.ID, { LastLoginAt: new Date().toISOString() }).catch(() => {});
          context.res = { status: 200, body: { token, name: userName, email, isAdmin } }; return;
        }
      }

      // Send 2FA code
      const otp    = Math.floor(100000 + Math.random() * 900000).toString();
      const hash2  = await bcrypt.hash(otp, 8);
      const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await updateListItem('ShuttleUsers', user.ID, { TwoFactorCode: hash2, TwoFactorExpiry: expiry });

      // Send email
      const { otpTemplate } = require('../shared/email');
      await sendEmail(email, 'Your Hughes Shuttle admin verification code', otpTemplate(userName, otp));

      context.res = { status: 200, body: { requires2FA: true, email, name: userName } }; return;
    }

    // Non-admin — issue JWT directly
    const secret = await getSecret('jwt-secret');
    const token  = jwt.sign({ email, name: userName, studentId, isAdmin }, secret, { expiresIn: '7d' });
    updateListItem('ShuttleUsers', user.ID, { LastLoginAt: new Date().toISOString() }).catch(() => {});
    context.res = { status: 200, body: { token, name: userName, email, isAdmin } };
  } catch (err) {
    context.log.error('portal-login:', err.message);
    context.res = { status: 500, body: { error: 'Login failed. Please try again.' } };
    throw err;
  }
});
