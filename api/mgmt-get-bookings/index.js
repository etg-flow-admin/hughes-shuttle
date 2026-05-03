// GET /api/mgmt-get-bookings
// Ensure AlightingStop is included in the response
const { requireAdmin, authError } = require('../shared/auth');
const { wrapHandler }             = require('../shared/logger');
const { getListItems }            = require('../shared/msLists');

module.exports = wrapHandler('mgmt-get-bookings', async function (context, req) {
  try { await requireAdmin(req); } catch (err) { authError(context, err); return; }

  const date          = req.query?.date || '';
  const serviceNumber = req.query?.serviceNumber || '';
  const status        = req.query?.status || '';

  let filter = '';
  const filters = [];
  if (date)          filters.push(`TravelDate eq '${date}'`);
  if (serviceNumber) filters.push(`ServiceNumber eq ${serviceNumber}`);
  if (status)        filters.push(`Status eq '${status}'`);
  if (filters.length) filter = filters.join(' and ');

  try {
    // Use empty select to use LIST_FIELDS default which includes AlightingStop
    const items = await getListItems('ShuttleBookings', filter, '', 500);
    const bookings = items
      .sort((a, b) => new Date(b.TravelDate) - new Date(a.TravelDate) || b.ID - a.ID)
      .map(b => ({
        id:            b.ID,
        ref:           b.Title,
        userEmail:     b.UserEmail,
        name:          b.Name,
        studentId:     b.StudentID,
        roomNumber:    b.RoomNumber,
        serviceNumber: b.ServiceNumber,
        stopNumber:    b.StopNumber,
        alightingStop: b.AlightingStop || null,
        departureTime: b.DepartureTime,
        travelDate:    b.TravelDate,
        status:        b.Status,
        bookedAt:      b.BookedAt,
        cancelledAt:   b.CancelledAt,
      }));
    context.res = { status: 200, body: { bookings } };
  } catch (err) {
    context.log.error('mgmt-get-bookings:', err.message);
    context.res = { status: 500, body: { error: 'Failed to load bookings.' } };
    throw err;
  }
});
