// POST /api/mgmt-create-user
const bcrypt = require('bcrypt');
const { wrapHandler }    = require('../shared/logger');
const crypto = require('crypto');
const { requireAdmin, authError }     = require('../shared/auth');
const { getListItem, createListItem } = require('../shared/msLists');
const { sendEmail, welcomeTemplate }  = require('../shared/email');

module.exports = wrapHandler('mgmt-create-user', async function (context, req) {
  try { await requireAdmin(req); }
  catch (err) { authError(context, err); return; }

  const { name, email: raw, studentId, roomNumber, mobile, isAdmin } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!name || !email || !studentId || !roomNumber) {
    context.res = { status: 400, body: { error: 'name, email, studentId and roomNumber are required.' } }; return;
  }
  try {
    const existing = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    if (existing) {
      context.res = { status: 409, body: { error: 'An account with this email already exists.' } }; return;
    }
    const tempPassword = crypto.randomBytes(5).toString('hex').toUpperCase() + '!9';
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await createListItem('ShuttleUsers', {
      Title:         email,
      Name:          name.trim(),
      StudentID:     studentId.trim().toUpperCase(),
      RoomNumber:    roomNumber.trim().toUpperCase(),
      Mobile:        (mobile || '').trim(),
      PasswordHash:  passwordHash,
      Status:        'Active',
      IsAdmin:       isAdmin === true,
      EmailVerified: true,
      CreatedAt:     new Date().toISOString(),
    });
    await sendEmail(email, 'Your Hughes Shuttle account', welcomeTemplate(name, email, tempPassword));
    context.log.info('mgmt-create-user: created ' + email);
    context.res = { status: 200, body: { created: true, email } };
  } catch (err) {
    context.log.error('mgmt-create-user:', err.message);
    context.res = { status: 500, body: { error: 'Failed to create user.' } };
    throw err;
  }
});
