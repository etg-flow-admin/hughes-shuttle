// GET /api/mgmt-get-bookings?date=YYYY-MM-DD&serviceNumber=1&status=Confirmed
const { requireAdmin, authError } = require('../shared/auth');
const { wrapHandler }    = require('../shared/logger');
const { getListItems }            = require('../shared/msLists');

module.exports = wrapHandler('mgmt-get-bookings', async function (context, req) {
  try { await requireAdmin(req); }
  catch (err) { authError(context, err); return; }
  try {
    const { date, serviceNumber, status } = req.query || {};
    const filters = [];
    if (date)          filters.push(`TravelDate eq '${date}'`);
    if (serviceNumber) filters.push(`ServiceNumber eq ${serviceNumber}`);
    if (status)        filters.push(`Status eq '${status}'`);
    const items = await getListItems(
      'ShuttleBookings', filters.join(' and '),
      'ID,Title,UserEmail,Name,StudentID,RoomNumber,ServiceNumber,StopNumber,DepartureTime,TravelDate,Status,BookedAt,CancelledAt',
      5000
    );
    const bookings = items
      .sort((a, b) => new Date(b.BookedAt) - new Date(a.BookedAt))
      .map(b => ({
        id:            b.ID,
        ref:           b.Title,
        userEmail:     b.UserEmail,
        name:          b.Name,
        studentId:     b.StudentID,
        roomNumber:    b.RoomNumber || '',
        serviceNumber: b.ServiceNumber,
        stopNumber:    b.StopNumber,
        departureTime: b.DepartureTime,
        travelDate:    b.TravelDate,
        status:        b.Status,
        bookedAt:      b.BookedAt,
        cancelledAt:   b.CancelledAt || null,
      }));
    context.res = { status: 200, body: { bookings } };
  } catch (err) {
    context.log.error('mgmt-get-bookings:', err.message);
    context.res = { status: 500, body: { error: 'Failed to load bookings.' } };
    throw err;
  }
});
