// POST /api/admin-verify-2fa
// { email, otp, trustDevice } → { token, name, isAdmin, deviceToken? }
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { wrapHandler }    = require('../shared/logger');
const jwt                = require('jsonwebtoken');
const { getListItem, updateListItem } = require('../shared/msLists');
const { getSecret }      = require('../shared/keyVault');

const TRUST_DAYS   = 30;
const MAX_DEVICES  = 2;

module.exports = wrapHandler('admin-verify-2fa', async function (context, req) {
  const { email: raw, otp, trustDevice } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!email || !otp) {
    context.res = { status: 400, body: { error: 'Email and code are required.' } }; return;
  }
  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    if (!user) { context.res = { status: 400, body: { error: 'Invalid code.' } }; return; }

    // Check expiry
    if (!user.TwoFactorExpiry || new Date(user.TwoFactorExpiry) < new Date()) {
      context.res = { status: 400, body: { error: 'Code has expired. Please sign in again.' } }; return;
    }

    // Verify OTP
    const valid = await bcrypt.compare(otp.trim(), user.TwoFactorCode || '');
    if (!valid) {
      context.res = { status: 400, body: { error: 'Invalid code. Please check and try again.' } }; return;
    }

    // Clear 2FA fields, update last login
    const updates = { TwoFactorCode: null, TwoFactorExpiry: null, LastLoginAt: new Date().toISOString() };

    // Handle trusted device
    let newDeviceToken = null;
    if (trustDevice) {
      newDeviceToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(newDeviceToken).digest('hex');
      const expiry    = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000).toISOString();

      let devices = [];
      try { devices = JSON.parse(user.TrustedDevices || '[]'); } catch(e) {}

      // Remove expired devices
      devices = devices.filter(d => new Date(d.expiry).getTime() > Date.now());

      // Enforce max 2 devices — remove oldest if at limit
      while (devices.length >= MAX_DEVICES) devices.shift();

      devices.push({ tokenHash, expiry, addedAt: new Date().toISOString() });
      updates.TrustedDevices = JSON.stringify(devices);
    }

    await updateListItem('ShuttleUsers', user.ID, updates);

    const secret = await getSecret('jwt-secret');
    const token  = jwt.sign(
      { email, name: user.Name, studentId: user.StudentID, isAdmin: true },
      secret, { expiresIn: '7d' }
    );

    context.log.info('admin-verify-2fa: verified ' + email + (trustDevice ? ' (device trusted)' : ''));
    context.res = { status: 200, body: { token, name: user.Name, email, isAdmin: true, deviceToken: newDeviceToken } };
  } catch (err) {
    context.log.error('admin-verify-2fa:', err.message);
    context.res = { status: 500, body: { error: 'Verification failed. Please try again.' } };
    throw err;
  }
});
