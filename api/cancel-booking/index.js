// POST /api/cancel-booking
// { ref } → cancels booking and frees segments
const { verifyToken, authError }       = require('../shared/auth');
const { wrapHandler }                  = require('../shared/logger');
const { getListItem, updateListItem }  = require('../shared/msLists');
const { cancelSeat }                   = require('../shared/tableStorage');

module.exports = wrapHandler('cancel-booking', async function (context, req) {
  let payload;
  try { payload = await verifyToken(req); }
  catch (err) { authError(context, err); return; }

  const { ref } = req.body || {};
  if (!ref) { context.res = { status: 400, body: { error: 'ref is required.' } }; return; }

  try {
    const booking = await getListItem('ShuttleBookings', `Title eq '${ref}'`);
    if (!booking) {
      context.res = { status: 404, body: { error: 'Booking not found.' } }; return;
    }
    if (booking.UserEmail?.toLowerCase() !== payload.email) {
      context.res = { status: 403, body: { error: 'Not authorised to cancel this booking.' } }; return;
    }
    if (booking.Status === 'Cancelled') {
      context.res = { status: 409, body: { error: 'Booking is already cancelled.' } }; return;
    }

    const boardingStop  = +booking.StopNumber;
    const alightingStop = +booking.AlightingStop;
    const travelDate    = booking.TravelDate;
    const serviceNumber = +booking.ServiceNumber;

    // Mark as cancelled in SharePoint
    await updateListItem('ShuttleBookings', booking.ID, {
      Status:      'Cancelled',
      CancelledAt: new Date().toISOString(),
    });

    // Free segments if we have valid stop data
    if (boardingStop && alightingStop && boardingStop < alightingStop) {
      await cancelSeat(travelDate, serviceNumber, boardingStop, alightingStop);
    }

    context.log.info(`cancel-booking: ${ref} cancelled by ${payload.email}`);
    context.res = { status: 200, body: { cancelled: true, ref } };

  } catch (err) {
    context.log.error('cancel-booking:', err.message);
    context.res = { status: 500, body: { error: 'Cancellation failed. Please try again.' } };
    throw err;
  }
});
