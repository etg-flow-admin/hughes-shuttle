// POST /api/create-account
// { name, email, studentId, password } → { sent: true }
const bcrypt = require('bcrypt');
const { wrapHandler }    = require('../shared/logger');
const { getListItem, createListItem } = require('../shared/msLists');
const { sendEmail, otpTemplate }      = require('../shared/email');

module.exports = wrapHandler('create-account', async function (context, req) {
  const { name, email: raw, studentId, roomNumber, password } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!name || !email || !studentId || !roomNumber || !password) {
    context.res = { status: 400, body: { error: 'All fields are required.' } }; return;
  }
  if (password.length < 8) {
    context.res = { status: 400, body: { error: 'Password must be at least 8 characters.' } }; return;
  }
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    context.res = { status: 400, body: { error: 'Invalid email address.' } }; return;
  }
  try {
    const existing = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    if (existing) {
      // Don't reveal account existence — just appear to succeed
      context.res = { status: 200, body: { sent: true } }; return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const otp          = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash      = await bcrypt.hash(otp, 8);
    const otpExpiry    = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await createListItem('ShuttleUsers', {
      Title:         email,
      Name:          name.trim(),
      StudentID:     studentId.trim().toUpperCase(),
      RoomNumber:    roomNumber.trim().toUpperCase(),
      PasswordHash:  passwordHash,
      Status:        'New',
      IsAdmin:       false,
      EmailVerified: false,
      OTPCode:       otpHash,
      OTPExpiry:     otpExpiry,
      CreatedAt:     new Date().toISOString(),
    });
    await sendEmail(email, 'Verify your Hughes Shuttle account', otpTemplate(name, otp));
    context.log.info('create-account: created ' + email);
    context.res = { status: 200, body: { sent: true } };
  } catch (err) {
    context.log.error('create-account:', err.message);
    context.res = { status: 500, body: { error: 'Account creation failed. Please try again.' } };
    throw err;
  }
});
