// POST /api/migrate-segments?dryRun=true
// Seeds ShuttleSegments from existing confirmed future bookings
// For bookings without AlightingStop, assumes last active stop of that service
const { requireAdmin, authError } = require('../shared/auth');
const { wrapHandler }             = require('../shared/logger');
const { getListItems, updateListItem } = require('../shared/msLists');
const { bookSeat }                = require('../shared/tableStorage');

module.exports = wrapHandler('migrate-segments', async function (context, req) {
  try { await requireAdmin(req); } catch (err) { authError(context, err); return; }

  const dryRun = req.query?.dryRun === 'true';
  context.log.info(`migrate-segments: starting (dryRun=${dryRun})`);

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Get all confirmed future bookings
    const bookings = await getListItems(
      'ShuttleBookings',
      `Status eq 'Confirmed' and TravelDate ge '${today}'`,
      'ID,Title,ServiceNumber,StopNumber,AlightingStop,TravelDate,Status',
      500
    );
    context.log.info(`migrate-segments: found ${bookings.length} confirmed future bookings`);

    // Get all services to determine last active stop per service
    const services = await getListItems(
      'ShuttleServices', '',
      'ID,ServiceNumber,Stop1Time,Stop2Time,Stop3Time,Stop4Time,Stop5Time,Stop6Time,Stop7Time',
      20
    );

    const lastStopMap = {};
    for (const svc of services) {
      const times = [
        svc.Stop1Time, svc.Stop2Time, svc.Stop3Time, svc.Stop4Time,
        svc.Stop5Time, svc.Stop6Time, svc.Stop7Time
      ];
      let last = 1;
      times.forEach((t, i) => { if (t && t !== '*N/S') last = i + 1; });
      lastStopMap[svc.ServiceNumber] = last;
    }

    const results = { processed: 0, skipped: 0, errors: [], dryRun, lastStopMap };

    for (const b of bookings) {
      const boarding   = +b.StopNumber;
      const alighting  = +b.AlightingStop || lastStopMap[b.ServiceNumber] || 7;
      const svcNum     = +b.ServiceNumber;
      const travelDate = b.TravelDate;

      if (!boarding || !alighting || boarding >= alighting) {
        context.log.warn(`migrate-segments: skipping ${b.Title} — invalid stops ${boarding}→${alighting}`);
        results.skipped++;
        continue;
      }

      if (dryRun) {
        context.log.info(`dryRun: would book svc${svcNum} stop${boarding}→${alighting} on ${travelDate} (${b.Title})`);
        results.processed++;
        continue;
      }

      try {
        const result = await bookSeat(travelDate, svcNum, boarding, alighting);
        if (!result.success) {
          results.errors.push(`${b.Title}: bookSeat failed (${result.reason})`);
        } else {
          // If booking had no AlightingStop recorded, update it
          if (!b.AlightingStop) {
            await updateListItem('ShuttleBookings', b.ID, { AlightingStop: alighting }).catch(() => {});
          }
          results.processed++;
        }
      } catch (e) {
        results.errors.push(`${b.Title}: ${e.message}`);
      }
    }

    context.log.info(`migrate-segments: done — processed=${results.processed} skipped=${results.skipped} errors=${results.errors.length}`);
    context.res = { status: 200, body: results };
  } catch (err) {
    context.log.error('migrate-segments:', err.message);
    context.res = { status: 500, body: { error: err.message } };
    throw err;
  }
});
