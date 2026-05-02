// GET /api/get-services?date=YYYY-MM-DD&includeDisabled=true
const { verifyToken, authError }  = require('../shared/auth');
const { wrapHandler }             = require('../shared/logger');
const { getListItems }            = require('../shared/msLists');
const { getAvailabilityForDate, getStopAvailability, CAPACITY } = require('../shared/tableStorage');

module.exports = wrapHandler('get-services', async function (context, req) {
  try { await verifyToken(req); } catch (err) { authError(context, err); return; }

  const travelDate      = req.query && req.query.date;
  const includeDisabled = req.query && req.query.includeDisabled === 'true';

  if (!travelDate) {
    context.res = { status: 400, body: { error: 'date query parameter required (YYYY-MM-DD).' } }; return;
  }

  try {
    const scheduleItems = await getListItems(
      'ShuttleServices', '',
      'ID,Title,ServiceNumber,Stop1Time,Stop2Time,Stop3Time,Stop4Time,Stop5Time,Stop6Time,Stop7Time,IsDisabled,DropoffOnlyStops',
      20
    );

    const availability = await getAvailabilityForDate(travelDate);

    const services = await Promise.all(
      scheduleItems
        .filter(s => includeDisabled || !s.IsDisabled)
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
          const dropoffOnlyStops = (s.DropoffOnlyStops || '')
            .split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));

          const activeStops = times.map((t, i) => t !== '*N/S' ? i + 1 : null).filter(Boolean);
          const avail       = availability[svcNum] || { segments: {}, maxOnBoard: 0 };
          const stopAvail   = activeStops.length > 0
            ? await getStopAvailability(travelDate, svcNum, activeStops)
            : {};

          return {
            id:               svcNum,
            serviceNumber:    svcNum,
            title:            s.Title || ('Service No.' + svcNum),
            times,
            booked:           avail.maxOnBoard || 0,
            seatsLeft:        Math.max(0, CAPACITY - (avail.maxOnBoard || 0)),
            capacity:         CAPACITY,
            stopAvailability: stopAvail,
            segments:         avail.segments || {},
            dropoffOnlyStops,
            disabled:         s.IsDisabled === true,
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
