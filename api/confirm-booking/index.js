// POST /api/confirm-booking
// { serviceNumber, stopNumber, travelDate }
// Books exactly 1 seat using Azure Table Storage atomic ETag concurrency
const { verifyToken, authError }      = require('../shared/auth');
const { getListItem, createListItem } = require('../shared/msLists');
const { bookSeat }                    = require('../shared/tableStorage');
const { sendEmail, bookingConfirmTemplate } = require('../shared/email');

const STOPS = [
  { num:1, name:'Adelaide University Village', addr:'210 Grote St' },
  { num:2, name:'City Campus West',            addr:'Medical School' },
  { num:3, name:'Bus Interchange Centre',       addr:'Stop W2 King William St - West side' },
  { num:4, name:'Bus Interchange Centre',       addr:'Stop C3 King William St - East side' },
  { num:5, name:'City Campus East',             addr:'Business School' },
  { num:6, name:'Central Market & Chinatown',   addr:'Stop W2 Grote St - South side' },
];

module.exports = async function (context, req) {
  let payload;
  try { payload = await verifyToken(req); }
  catch (err) { authError(context, err); return; }

  const { serviceNumber, stopNumber, travelDate } = req.body || {};
  if (!serviceNumber || !stopNumber || !travelDate) {
    context.res = { status: 400, body: { error: 'serviceNumber, stopNumber and travelDate are required.' } }; return;
  }

  const email     = payload.email;
  const studentId = payload.studentId;
  const name      = payload.name;

  try {
    // Check student hasn't already booked this service on this date
    const existing = await getListItem(
      'ShuttleBookings',
      `UserEmail eq '${email}' and ServiceNumber eq ${serviceNumber} and TravelDate eq '${travelDate}' and Status ne 'Cancelled'`
    );
    if (existing) {
      context.res = { status: 409, body: { error: 'You already have a booking on this service for that date.' } }; return;
    }

    // Get departure time from ShuttleServices list
    const svcItem = await getListItem('ShuttleServices', `ServiceNumber eq ${serviceNumber}`);
    const stopKey = `Stop${stopNumber}Time`;
    const depTime = svcItem ? (svcItem[stopKey] || '—') : '—';
    const stop    = STOPS[+stopNumber - 1] || { name: `Stop ${stopNumber}` };

    // ── Atomic seat booking via Azure Table Storage ──
    const result = await bookSeat(travelDate, serviceNumber);

    if (!result.success) {
      const msg = result.reason === 'full'
        ? 'Sorry, this service is now full.'
        : 'Unable to secure your seat — please try again.';
      context.res = { status: 409, body: { error: msg } }; return;
    }

    // Create booking record in Microsoft Lists
    const ref = 'SHT-' + Math.floor(1000 + Math.random() * 9000);
    await createListItem('ShuttleBookings', {
      Title:         ref,
      UserEmail:     email,
      StudentID:     studentId,
      Name:          name,
      ServiceNumber: serviceNumber,
      StopNumber:    stopNumber,
      DepartureTime: depTime,
      TravelDate:    travelDate,
      Status:        'Confirmed',
      BookedAt:      new Date().toISOString(),
    });

    // Send confirmation email (fire-and-forget)
    sendEmail(
      email,
      `Booking confirmed — Hughes Shuttle Service No.${serviceNumber} on ${travelDate}`,
      bookingConfirmTemplate(name, ref, serviceNumber, stop.name, depTime, travelDate)
    ).catch(e => context.log.warn('Confirm email failed:', e.message));

    context.log.info(`confirm-booking: ${email} booked svc ${serviceNumber} on ${travelDate} — ${ref}`);
    context.res = { status: 200, body: { ref, serviceNumber, stopNumber, travelDate, depTime, status: 'Confirmed', seatsLeft: result.seatsLeft } };

  } catch (err) {
    context.log.error('confirm-booking:', err.message);
    context.res = { status: 500, body: { error: 'Booking failed. Please try again.' } };
  }
};
