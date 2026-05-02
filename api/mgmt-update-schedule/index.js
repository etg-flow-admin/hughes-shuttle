// POST /api/mgmt-update-schedule
// { serviceNumber, times, disabled, dropoffOnlyStops }
const { verifyToken, authError }                                   = require('../shared/auth');
const { wrapHandler }                                              = require('../shared/logger');
const { getListItem, getListItems, updateListItem, createListItem } = require('../shared/msLists');
const { sendEmail, scheduleChangeTemplate }                        = require('../shared/email');

module.exports = wrapHandler('mgmt-update-schedule', async function (context, req) {
  let payload;
  try { payload = await verifyToken(req); } catch (err) { authError(context, err); return; }

  // Verify admin by looking up user record — don't rely on token payload.isAdmin
  const userRecord = await getListItem('ShuttleUsers', `Title eq '${payload.email}'`).catch(() => null);
  if (!userRecord || (!userRecord.IsAdmin && userRecord.IsAdmin !== 1)) {
    context.res = { status: 403, body: { error: 'Admin access required.' } }; return;
  }

  const { serviceNumber, times, disabled, dropoffOnlyStops } = req.body || {};
  if (!serviceNumber || !Array.isArray(times) || times.length < 6) {
    context.res = { status: 400, body: { error: 'serviceNumber and times array required.' } }; return;
  }

  try {
    const existing = await getListItem('ShuttleServices', `ServiceNumber eq ${serviceNumber}`);
    const fields = {
      ServiceNumber:    serviceNumber,
      Stop1Time:        times[0] || '*N/S',
      Stop2Time:        times[1] || '*N/S',
      Stop3Time:        times[2] || '*N/S',
      Stop4Time:        times[3] || '*N/S',
      Stop5Time:        times[4] || '*N/S',
      Stop6Time:        times[5] || '*N/S',
      Stop7Time:        times[6] || '*N/S',
      IsDisabled:       disabled === true,
      DropoffOnlyStops: Array.isArray(dropoffOnlyStops) ? dropoffOnlyStops.join(',') : '',
      UpdatedAt:        new Date().toISOString(),
    };

    if (existing) {
      await updateListItem('ShuttleServices', existing.ID, fields);
    } else {
      await createListItem('ShuttleServices', { Title: `Service ${serviceNumber}`, ...fields });
    }

    context.log.info(`mgmt-update-schedule: updated service ${serviceNumber} by ${payload.email}`);

    // Fire-and-forget admin notification
    notifyAdmins(context, serviceNumber, times, dropoffOnlyStops, payload.email)
      .catch(e => context.log.warn('notifyAdmins failed:', e.message));

    context.res = { status: 200, body: { updated: true, serviceNumber, times, dropoffOnlyStops } };
  } catch (err) {
    context.log.error('mgmt-update-schedule:', err.message);
    context.res = { status: 500, body: { error: 'Schedule update failed.' } };
    throw err;
  }
});

async function notifyAdmins(context, serviceNumber, times, dropoffOnlyStops, changedBy) {
  // Fetch all users and filter IsAdmin in code (IsAdmin not indexed in SharePoint)
  const allUsers = await getListItems('ShuttleUsers', '', 'id,Title,Name,IsAdmin', 500);
  const admins   = allUsers.filter(u => u.IsAdmin === true || u.IsAdmin === 1);
  context.log.info(`notifyAdmins: ${admins.length} admin(s) found from ${allUsers.length} total users`);
  if (!admins.length) {
    context.log.warn('notifyAdmins: no admins found — check IsAdmin field in ShuttleUsers');
    return;
  }

  const subject = `Hughes Shuttle — Service No.${serviceNumber} schedule updated`;
  const html    = scheduleChangeTemplate(serviceNumber, times, dropoffOnlyStops || [], changedBy);

  await Promise.all(
    admins.map(a => {
      context.log.info(`notifyAdmins: sending to ${a.Title}`);
      return sendEmail(a.Title, subject, html)
        .catch(e => context.log.warn(`Email failed for ${a.Title}:`, e.message));
    })
  );
  context.log.info('notifyAdmins: complete');
}
