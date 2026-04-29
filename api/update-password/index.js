// POST /api/update-password
// { newPassword } — authenticated user updates their own password
const bcrypt = require('bcrypt');
const { wrapHandler }             = require('../shared/logger');
const { verifyToken, authError }  = require('../shared/auth');
const { getListItem, updateListItem } = require('../shared/msLists');

module.exports = wrapHandler('update-password', async function(context, req) {
  let payload;
  try { payload = await verifyToken(req); }
  catch (err) { authError(context, err); return; }

  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    context.res = { status: 400, body: { error: 'Password must be at least 8 characters.' } }; return;
  }

  const user = await getListItem('ShuttleUsers', `Title eq '${payload.email}'`);
  if (!user) { context.res = { status: 404, body: { error: 'User not found.' } }; return; }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updateListItem('ShuttleUsers', user.ID, { PasswordHash: passwordHash });

  context.log.info('update-password: updated for ' + payload.email);
  context.res = { status: 200, body: { updated: true } };
});
