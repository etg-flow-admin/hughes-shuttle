// POST /api/mgmt-update-schedule
// { serviceNumber, times, disabled, dropoffOnlyStops }
// Sends email notification to all admins on schedule change
const { requireAdmin, authError }                       = require('../shared/auth');
const { wrapHandler }                                   = require('../shared/logger');
const { getListItem, getListItems, updateListItem, createListItem } = require('../shared/msLists');
const { sendEmail, scheduleChangeTemplate }             = require('../shared/email');

module.exports = wrapHandler('mgmt-update-schedule', async function (context, req) {
  let adminPayload;
  try { adminPayload = await requireAdmin(req); } catch (err) { authError(context, err); return; }

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

    context.log.info(`mgmt-update-schedule: updated service ${serviceNumber} by ${adminPayload?.email}`);

    // Send email to all admins (fire-and-forget)
    const changedBy = adminPayload?.email || adminPayload?.name || 'Admin';
    notifyAdmins(context, serviceNumber, times, dropoffOnlyStops, changedBy).catch(e =>
      context.log.warn('mgmt-update-schedule: admin notify failed:', e.message)
    );

    context.res = { status: 200, body: { updated: true, serviceNumber, times, dropoffOnlyStops } };
  } catch (err) {
    context.log.error('mgmt-update-schedule:', err.message);
    context.res = { status: 500, body: { error: 'Schedule update failed.' } };
    throw err;
  }
});

async function notifyAdmins(context, serviceNumber, times, dropoffOnlyStops, changedBy) {
  const admins = await getListItems('ShuttleUsers', "IsAdmin eq 1", 'id,Title,Name', 200);
  if (!admins.length) return;
  const subject = `Hughes Shuttle — Service No.${serviceNumber} schedule updated`;
  const html    = scheduleChangeTemplate(serviceNumber, times, dropoffOnlyStops || [], changedBy);
  await Promise.all(
    admins.map(a => sendEmail(a.Title, subject, html).catch(e =>
      context.log.warn(`Notify failed for ${a.Title}:`, e.message)
    ))
  );
  context.log.info(`mgmt-update-schedule: notified ${admins.length} admin(s)`);
}
