// POST /api/cancel-booking
// { ref } — student cancels their own booking, returns seat to Table Storage
const { verifyToken, authError }      = require('../shared/auth');
const { getListItem, updateListItem } = require('../shared/msLists');
const { releaseSeat }                 = require('../shared/tableStorage');

module.exports = async function (context, req) {
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
    await updateListItem('ShuttleBookings', booking.ID, {
      Status:      'Cancelled',
      CancelledAt: new Date().toISOString(),
    });
    // Return seat to Azure Table Storage
    await releaseSeat(booking.TravelDate, booking.ServiceNumber);
    context.log.info(`cancel-booking: ${payload.email} cancelled ${ref}`);
    context.res = { status: 200, body: { cancelled: true, ref } };
  } catch (err) {
    context.log.error('cancel-booking:', err.message);
    context.res = { status: 500, body: { error: 'Cancellation failed. Please try again.' } };
  }
};
