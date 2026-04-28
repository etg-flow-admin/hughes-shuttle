// POST /api/mgmt-update-schedule
// { serviceNumber, times: ['06:45','*N/S','06:55','*N/S','*N/S','*N/S'] }
const { requireAdmin, authError }     = require('../shared/auth');
const { getListItem, updateListItem, createListItem } = require('../shared/msLists');

module.exports = async function (context, req) {
  try { await requireAdmin(req); }
  catch (err) { authError(context, err); return; }

  const { serviceNumber, times } = req.body || {};
  if (!serviceNumber || !Array.isArray(times) || times.length !== 6) {
    context.res = { status: 400, body: { error: 'serviceNumber and times array (6 entries) are required.' } }; return;
  }
  const hasActive = times.some(t => t !== '*N/S' && t);
  if (!hasActive) {
    context.res = { status: 400, body: { error: 'At least one stop must be active.' } }; return;
  }
  try {
    const existing = await getListItem('ShuttleServices', `ServiceNumber eq ${serviceNumber}`);
    const fields = {
      ServiceNumber: serviceNumber,
      Stop1Time: times[0] || '*N/S',
      Stop2Time: times[1] || '*N/S',
      Stop3Time: times[2] || '*N/S',
      Stop4Time: times[3] || '*N/S',
      Stop5Time: times[4] || '*N/S',
      Stop6Time: times[5] || '*N/S',
      UpdatedAt: new Date().toISOString(),
    };
    if (existing) {
      await updateListItem('ShuttleServices', existing.ID, fields);
    } else {
      await createListItem('ShuttleServices', { Title: `Service ${serviceNumber}`, ...fields });
    }
    context.log.info(`mgmt-update-schedule: updated service ${serviceNumber}`);
    context.res = { status: 200, body: { updated: true, serviceNumber, times } };
  } catch (err) {
    context.log.error('mgmt-update-schedule:', err.message);
    context.res = { status: 500, body: { error: 'Schedule update failed.' } };
  }
};
