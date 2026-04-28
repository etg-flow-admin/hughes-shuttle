// POST /api/mgmt-update-user
const bcrypt = require('bcrypt');
const { requireAdmin, authError }     = require('../shared/auth');
const { getListItem, updateListItem } = require('../shared/msLists');

module.exports = async function (context, req) {
  try { await requireAdmin(req); }
  catch (err) { authError(context, err); return; }

  const { email: raw, updates } = req.body || {};
  const email = (raw || '').toLowerCase().trim();
  if (!email || !updates) {
    context.res = { status: 400, body: { error: 'email and updates are required.' } }; return;
  }
  try {
    const user = await getListItem('ShuttleUsers', `Title eq '${email}'`);
    if (!user) { context.res = { status: 404, body: { error: 'User not found.' } }; return; }

    const fields = {};
    if (updates.name      !== undefined) fields.Name      = updates.name.trim();
    if (updates.studentId !== undefined) fields.StudentID = updates.studentId.trim().toUpperCase();
    if (updates.mobile    !== undefined) fields.Mobile    = updates.mobile.trim();
    if (updates.status    !== undefined) fields.Status    = updates.status;
    if (updates.isAdmin   !== undefined) fields.IsAdmin   = updates.isAdmin === true;
    if (updates.newPassword) {
      if (updates.newPassword.length < 8) {
        context.res = { status: 400, body: { error: 'Password must be at least 8 characters.' } }; return;
      }
      fields.PasswordHash = await bcrypt.hash(updates.newPassword, 10);
    }
    if (!Object.keys(fields).length) {
      context.res = { status: 400, body: { error: 'No valid update fields provided.' } }; return;
    }
    await updateListItem('ShuttleUsers', user.ID, fields);
    context.log.info(`mgmt-update-user: updated ${email}`);
    context.res = { status: 200, body: { updated: true } };
  } catch (err) {
    context.log.error('mgmt-update-user:', err.message);
    context.res = { status: 500, body: { error: 'Update failed.' } };
  }
};
