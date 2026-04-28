// GET /api/get-services?date=YYYY-MM-DD
// Returns schedule + live seat availability from Table Storage
const { verifyToken, authError }  = require('../shared/auth');
const { getListItems }            = require('../shared/msLists');
const { getAvailabilityForDate, CAPACITY } = require('../shared/tableStorage');

module.exports = async function (context, req) {
  try { await verifyToken(req); }
  catch (err) { authError(context, err); return; }

  const travelDate = req.query && req.query.date;
  if (!travelDate) {
    context.res = { status: 400, body: { error: 'date query parameter required (YYYY-MM-DD).' } }; return;
  }

  try {
    // Get schedule from Microsoft Lists
    const scheduleItems = await getListItems(
      'ShuttleServices', '', 
      'ID,ServiceNumber,Stop1Time,Stop2Time,Stop3Time,Stop4Time,Stop5Time,Stop6Time',
      20
    );

    // Get live seat counts from Azure Table Storage
    const availability = await getAvailabilityForDate(travelDate);

    const services = scheduleItems
      .sort((a, b) => a.ServiceNumber - b.ServiceNumber)
      .map(s => {
        const svcNum = String(s.ServiceNumber);
        const avail  = availability[svcNum] || { booked: 0, left: CAPACITY };
        return {
          id:            s.ID,
          serviceNumber: s.ServiceNumber,
          times: [
            s.Stop1Time || '*N/S',
            s.Stop2Time || '*N/S',
            s.Stop3Time || '*N/S',
            s.Stop4Time || '*N/S',
            s.Stop5Time || '*N/S',
            s.Stop6Time || '*N/S',
          ],
          booked:   avail.booked,
          seatsLeft: avail.left,
          capacity:  CAPACITY,
        };
      });

    context.res = { status: 200, body: { travelDate, services } };
  } catch (err) {
    context.log.error('get-services:', err.message);
    context.res = { status: 500, body: { error: 'Failed to load services.' } };
  }
};
