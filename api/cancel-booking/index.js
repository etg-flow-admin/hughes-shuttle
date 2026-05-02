// POST /api/cancel-booking
// { ref } — student cancels their own booking, frees segments in Table Storage
const { verifyToken, authError }      = require('../shared/auth');
const { wrapHandler }                 = require('../shared/logger');
const { getListItem, updateListItem } = require('../shared/msLists');
const { cancelSeat }                  = require('../shared/tableStorage');

module.exports = wrapHandler('cancel-booking', async function (context, req) {
  let payload;
  try { payload = await verifyToken(req); }
  catch (err) { authError(context, err); return; }

  const { ref } = req.body || {};
  if (!ref) { context.res = { status: 400, body: { error: 'Booking ref required.' } }; return; }

  try {
    const booking = await getListItem('ShuttleBookings', `Title eq '${ref}'`);
    if (!booking) { context.res = { status: 404, body: { error: 'Booking not found.' } }; return; }
    if (booking.UserEmail !== payload.email) {
      context.res = { status: 403, body: { error: 'You can only cancel your own bookings.' } }; return;
    }
    if (booking.Status === 'Cancelled') {
      context.res = { status: 400, body: { error: 'Booking is already cancelled.' } }; return;
    }

    // Mark as cancelled first — always succeeds
    await updateListItem('ShuttleBookings', booking.ID, {
      Status:      'Cancelled',
      CancelledAt: new Date().toISOString(),
    });

    // Free segments — only if both stops are known (new segment-based bookings)
    const boardingStop  = +booking.StopNumber;
    const alightingStop = +booking.AlightingStop;
    if (boardingStop && alightingStop && boardingStop < alightingStop) {
      try {
        await cancelSeat(booking.TravelDate, +booking.ServiceNumber, boardingStop, alightingStop);
        context.log.info(`cancel-booking: freed segments svc${booking.ServiceNumber} stop${boardingStop}→${alightingStop} on ${booking.TravelDate}`);
      } catch (segErr) {
        // Non-fatal — booking is already cancelled in SharePoint
        context.log.warn('cancel-booking: segment release failed (non-fatal):', segErr.message);
      }
    } else {
      context.log.info(`cancel-booking: ${ref} cancelled — no segments to free (legacy booking)`);
    }

    context.log.info(`cancel-booking: ${payload.email} cancelled ${ref}`);
    context.res = { status: 200, body: { cancelled: true, ref } };
  } catch (err) {
    context.log.error('cancel-booking:', err.message);
    context.res = { status: 500, body: { error: 'Cancellation failed. Please try again.' } };
    throw err;
  }
});
