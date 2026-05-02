// GET /api/get-services?date=YYYY-MM-DD
// Returns schedule + per-stop seat availability from ShuttleSegments table
const { verifyToken, authError }  = require('../shared/auth');
const { wrapHandler }             = require('../shared/logger');
const { getListItems }            = require('../shared/msLists');
const { getAvailabilityForDate, getStopAvailability, CAPACITY } = require('../shared/tableStorage');

const STOP_COUNT = 7;

module.exports = wrapHandler('get-services', async function (context, req) {
  try { await verifyToken(req); }
  catch (err) { authError(context, err); return; }

  const travelDate = req.query && req.query.date;
  if (!travelDate) {
    context.res = { status: 400, body: { error: 'date query parameter required (YYYY-MM-DD).' } }; return;
  }

  try {
    const scheduleItems = await getListItems(
      'ShuttleServices', '',
      'ID,ServiceNumber,Stop1Time,Stop2Time,Stop3Time,Stop4Time,Stop5Time,Stop6Time,Stop7Time,IsDisabled',
      20, req
    );

    // Get all segment data for this date in one query
    const availability = await getAvailabilityForDate(travelDate, req);

    const services = await Promise.all(
      scheduleItems
        .filter(s => !s.IsDisabled)
        .sort((a, b) => a.ServiceNumber - b.ServiceNumber)
        .map(async s => {
          const svcNum = s.ServiceNumber;
          const times  = [
            s.Stop1Time || '*N/S',
            s.Stop2Time || '*N/S',
            s.Stop3Time || '*N/S',
            s.Stop4Time || '*N/S',
            s.Stop5Time || '*N/S',
            s.Stop6Time || '*N/S',
            s.Stop7Time || '*N/S',
          ];

          // Active stop numbers (1-based)
          const activeStops = times
            .map((t, i) => t !== '*N/S' ? i + 1 : null)
            .filter(Boolean);

          // Per-stop availability
          const avail      = availability[svcNum] || { segments: {}, maxOnBoard: 0 };
          const stopAvail  = await getStopAvailability(travelDate, svcNum, activeStops, req);

          return {
            id:            svcNum,
            serviceNumber: svcNum,
            times,
            disabled:      s.IsDisabled === true,
            // Overall booked = max occupancy across all segments
            booked:        avail.maxOnBoard || 0,
            seatsLeft:     Math.max(0, CAPACITY - (avail.maxOnBoard || 0)),
            capacity:      CAPACITY,
            // Per-stop: seats available if boarding at this stop (riding to last stop)
            stopAvailability: stopAvail,
            // Segments: raw onBoard per stop (for admin)
            segments: avail.segments || {},
          };
        })
    );

    context.res = { status: 200, body: { travelDate, services } };
  } catch (err) {
    context.log.error('get-services:', err.message);
    context.res = { status: 500, body: { error: 'Failed to load services.' } };
    throw err;
  }
});
