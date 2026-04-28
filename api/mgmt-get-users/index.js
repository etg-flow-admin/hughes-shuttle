// GET /api/mgmt-get-users
const { requireAdmin, authError } = require('../shared/auth');
const { getListItems }            = require('../shared/msLists');

module.exports = async function (context, req) {
  try { await requireAdmin(req); }
  catch (err) { authError(context, err); return; }
  try {
    const items = await getListItems(
      'ShuttleUsers', '',
      'ID,Title,Name,StudentID,RoomNumber,Mobile,Status,IsAdmin,EmailVerified,CreatedAt,LastLoginAt',
      5000
    );
    const users = items.map(u => ({
      id:            u.ID,
      email:         u.Title,
      name:          u.Name,
      studentId:     u.StudentID,
      roomNumber:    u.RoomNumber || '',
      mobile:        u.Mobile || '',
      status:        u.Status,
      isAdmin:       u.IsAdmin === true,
      emailVerified: u.EmailVerified === true,
      createdAt:     u.CreatedAt || '',
      lastLoginAt:   u.LastLoginAt || '',
    }));
    context.res = { status: 200, body: { users } };
  } catch (err) {
    context.log.error('mgmt-get-users:', err.message);
    context.res = { status: 500, body: { error: 'Failed to load users.' } };
  }
};
