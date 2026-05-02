// POST /api/confirm-booking
// { serviceNumber, boardingStop, alightingStop, travelDate }
const { verifyToken, authError }      = require('../shared/auth');
const { wrapHandler }                 = require('../shared/logger');
const { getListItem, createListItem } = require('../shared/msLists');
const { bookSeat }                    = require('../shared/tableStorage');
const { sendEmail, bookingConfirmTemplate } = require('../shared/email');

const STOPS = [
  { num:1, name:'Adelaide University Village', addr:'210 Grote St' },
  { num:2, name:'City Campus West',            addr:'Medical School' },
  { num:3, name:'Bus Interchange Centre',      addr:'Stop W2 King William St - West side' },
  { num:4, name:'Bus Interchange Centre',      addr:'Stop C3 King William St - East side' },
  { num:5, name:'City Campus East',            addr:'Business School' },
  { num:6, name:'Central Market & Chinatown',  addr:'Stop W2 Grote St - South side' },
  { num:7, name:'Adelaide University Village', addr:'Return - 210 Grote St' },
];

module.exports = wrapHandler('confirm-booking', async function (context, req) {
  let payload;
  try { payload = await verifyToken(req); }
  catch (err) { authError(context, err); return; }

  const { serviceNumber, boardingStop, alightingStop, travelDate } = req.body || {};
  if (!serviceNumber || !boardingStop || !alightingStop || !travelDate) {
    context.res = { status: 400, body: { error: 'serviceNumber, boardingStop, alightingStop and travelDate are required.' } }; return;
  }
  if (+boardingStop >= +alightingStop) {
    context.res = { status: 400, body: { error: 'Alighting stop must be after boarding stop.' } }; return;
  }

  const email     = payload.email;
  const studentId = payload.studentId;
  const name      = payload.name;

  try {
    // Check 7-day advance booking limit
    const today   = new Date(); today.setHours(0,0,0,0);
    const travel  = new Date(travelDate + 'T00:00:00');
    const diffDays = Math.round((travel - today) / (1000 * 60 * 60 * 24));
    if (diffDays > 7) {
      context.res = { status: 400, body: { error: 'Bookings can only be made up to 7 days in advance.' } }; return;
    }

    // Check duplicate booking
    const existing = await getListItem(
      'ShuttleBookings',
      `UserEmail eq '${email}' and ServiceNumber eq ${serviceNumber} and TravelDate eq '${travelDate}' and Status ne 'Cancelled'`
    );
    if (existing) {
      context.res = { status: 409, body: { error: 'You already have a booking on this service for that date.' } }; return;
    }

    // Get departure time from ShuttleServices
    const svcItem    = await getListItem('ShuttleServices', `ServiceNumber eq ${serviceNumber}`);
    const stopKey    = `Stop${boardingStop}Time`;
    const depTime    = svcItem ? (svcItem[stopKey] || '—') : '—';
    const boarding   = STOPS[+boardingStop - 1] || { name: `Stop ${boardingStop}` };
    const alighting  = STOPS[+alightingStop - 1] || { name: `Stop ${alightingStop}` };

    // Atomic segment booking
    const result = await bookSeat(travelDate, serviceNumber, +boardingStop, +alightingStop);

    if (!result.success) {
      const msg = result.reason === 'full'
        ? `Sorry, no seats available between your stops.`
        : 'Unable to secure your seat — please try again.';
      context.res = { status: 409, body: { error: msg } }; return;
    }

    // Create booking record
    const ref = 'SHT-' + Math.floor(1000 + Math.random() * 9000);

    let roomNumber = '';
    try {
      const userRecord = await getListItem('ShuttleUsers', `Title eq '${email}'`);
      roomNumber = userRecord?.RoomNumber || '';
    } catch (e) { /* non-fatal */ }

    await createListItem('ShuttleBookings', {
      Title:         ref,
      UserEmail:     email,
      StudentID:     studentId,
      Name:          name,
      RoomNumber:    roomNumber,
      ServiceNumber: serviceNumber,
      StopNumber:    boardingStop,
      AlightingStop: alightingStop,
      DepartureTime: depTime,
      TravelDate:    travelDate,
      Status:        'Confirmed',
      BookedAt:      new Date().toISOString(),
    });

    // Send confirmation email
    const cancelUrl = `https://book.hughesshuttle.com.au?cancel=${ref}`;
    sendEmail(
      email,
      `Booking confirmed — Hughes Shuttle Service No.${serviceNumber} on ${travelDate.split('-').reverse().join('/')}`,
      bookingConfirmTemplate(name, ref, serviceNumber, boarding.name, alighting.name, depTime, travelDate, cancelUrl)
    ).catch(e => context.log.warn('Confirm email failed:', e.message));

    context.log.info(`confirm-booking: ${email} svc${serviceNumber} stop${boardingStop}→${alightingStop} on ${travelDate} — ${ref}`);
    context.res = {
      status: 200,
      body: { ref, serviceNumber, boardingStop, alightingStop, travelDate, depTime, status: 'Confirmed', seatsLeft: result.seatsLeft }
    };

  } catch (err) {
    context.log.error('confirm-booking:', err.message);
    context.res = { status: 500, body: { error: 'Booking failed. Please try again.' } };
    throw err;
  }
});
