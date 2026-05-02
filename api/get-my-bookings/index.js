// GET /api/get-my-bookings
const { verifyToken, authError } = require('../shared/auth');
const { wrapHandler }            = require('../shared/logger');
const { getListItems }           = require('../shared/msLists');

module.exports = wrapHandler('get-my-bookings', async function (context, req) {
  let payload;
  try { payload = await verifyToken(req); } catch (err) { authError(context, err); return; }

  try {
    // Use empty select so LIST_FIELDS default is used — ensures AlightingStop is fetched
    const items = await getListItems(
      'ShuttleBookings',
      `UserEmail eq '${payload.email}'`,
      '', // use LIST_FIELDS default which includes AlightingStop
      100
    );

    context.log.info('get-my-bookings sample fields:', JSON.stringify(items[0] ? Object.keys(items[0]) : []));

    const bookings = items
      .sort((a, b) => new Date(b.TravelDate) - new Date(a.TravelDate))
      .map(b => {
        context.log.info(`booking ${b.Title}: AlightingStop=${b.AlightingStop}`);
        return {
          id:            b.ID,
          ref:           b.Title,
          serviceNumber: b.ServiceNumber,
          stopNumber:    b.StopNumber,
          alightingStop: b.AlightingStop || null,
          departureTime: b.DepartureTime,
          travelDate:    b.TravelDate,
          status:        b.Status,
          bookedAt:      b.BookedAt,
        };
      });
    context.res = { status: 200, body: { bookings } };
  } catch (err) {
    context.log.error('get-my-bookings:', err.message);
    context.res = { status: 500, body: { error: 'Failed to load bookings.' } };
    throw err;
  }
});
