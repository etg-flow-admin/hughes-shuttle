// POST /api/mgmt-reset-password
// { email } → generates strong temp password, saves hash, emails welcome template
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { wrapHandler }             = require('../shared/logger');
const { requireAdmin, authError } = require('../shared/auth');
const { getListItem, updateListItem } = require('../shared/msLists');
const { sendEmail, welcomeTemplate }  = require('../shared/email');

module.exports = wrapHandler('mgmt-reset-password', async function (context, req) {
  try { await requireAdmin(req); }
  catch (err) { authError(context, err); return; }

  const { email: raw } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!email) { context.res = { status: 400, body: { error: 'Email required.' } }; return; }

  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    if (!user) { context.res = { status: 404, body: { error: 'User not found.' } }; return; }

    const tempPassword = crypto.randomBytes(4).toString('hex').toUpperCase() + '!9';
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await updateListItem('ShuttleUsers', user.ID, { PasswordHash: passwordHash });
    await sendEmail(email, 'Your new Hughes Shuttle Bus password', welcomeTemplate(user.Name, email, tempPassword));

    context.log.info('mgmt-reset-password: reset for ' + email);
    context.res = { status: 200, body: { sent: true } };
  } catch (err) {
    context.log.error('mgmt-reset-password:', err.message);
    context.res = { status: 500, body: { error: 'Failed to reset password.' } };
    throw err;
  }
});
