// POST /api/verify-2fa
// { email, otp } → { token, name, isAdmin }
const bcrypt        = require('bcrypt');
const jwt           = require('jsonwebtoken');
const { getListItem, updateListItem } = require('../shared/msLists');
const { getSecret } = require('../shared/keyVault');

module.exports = async function (context, req) {
  const { email: raw, otp } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!email || !otp) {
    context.res = { status: 400, body: { error: 'Email and code are required.' } }; return;
  }
  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    if (!user) { context.res = { status: 400, body: { error: 'Invalid code.' } }; return; }
    if (!user.OTPExpiry || new Date(user.OTPExpiry) < new Date()) {
      context.res = { status: 400, body: { error: 'Code has expired. Please request a new one.' } }; return;
    }
    const valid = await bcrypt.compare(otp.trim(), user.OTPCode || '');
    if (!valid) { context.res = { status: 400, body: { error: 'Invalid code. Please check and try again.' } }; return; }
    await updateListItem('ShuttleUsers', user.ID, {
      EmailVerified: true,
      Status:        user.Status === 'New' ? 'Active' : user.Status,
      OTPCode:       '',
      OTPExpiry:     null,
      LastLoginAt:   new Date().toISOString(),
    });
    const secret = await getSecret('jwt-secret');
    const token  = jwt.sign(
      { email, name: user.Name, studentId: user.StudentID, isAdmin: user.IsAdmin === true },
      secret, { expiresIn: '7d' }
    );
    context.log.info('verify-2fa: verified ' + email);
    context.res = { status: 200, body: { token, name: user.Name, email, isAdmin: user.IsAdmin === true } };
  } catch (err) {
    context.log.error('verify-2fa:', err.message);
    context.res = { status: 500, body: { error: 'Verification failed. Please try again.' } };
  }
};
