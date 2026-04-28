// POST /api/send-2fa-code
// { email } → { sent: true }  — resend OTP for email verification
const bcrypt = require('bcrypt');
const { getListItem, updateListItem } = require('../shared/msLists');
const { sendEmail, otpTemplate }      = require('../shared/email');

module.exports = async function (context, req) {
  const email = ((req.body && req.body.email) || '').toLowerCase().trim();
  if (!email) { context.res = { status: 400, body: { error: 'Email required.' } }; return; }
  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    if (!user) { context.res = { status: 200, body: { sent: true } }; return; } // Silent — no enumeration
    const otp    = Math.floor(100000 + Math.random() * 900000).toString();
    const hash   = await bcrypt.hash(otp, 8);
    const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await updateListItem('ShuttleUsers', user.ID, { OTPCode: hash, OTPExpiry: expiry });
    await sendEmail(email, 'Your Hughes Shuttle verification code', otpTemplate(user.Name, otp));
    context.log.info('send-2fa-code: sent to ' + email);
    context.res = { status: 200, body: { sent: true } };
  } catch (err) {
    context.log.error('send-2fa-code:', err.message);
    context.res = { status: 200, body: { sent: true } }; // Always succeed silently
  }
};
