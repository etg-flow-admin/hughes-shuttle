// api/shared/tableStorage.js
// Azure Table Storage — used exclusively for seat counters
// Provides atomic optimistic-concurrency seat booking safe for 2000+ concurrent users
//
// Table: ShuttleSeats
// PartitionKey: travelDate  (e.g. "2026-05-12")
// RowKey:       serviceNumber as string (e.g. "3")
// SeatsBooked:  number
// Capacity:     number (always 22)

const { TableClient, odata } = require('@azure/data-tables');
const { getSecret }          = require('./keyVault');

const TABLE_NAME = 'ShuttleSeats';
const CAPACITY   = 22;
const MAX_RETRIES = 5;

let _client = null;

async function getClient() {
  if (_client) return _client;
  const connStr = await getSecret('azure-storage-connection');
  _client = TableClient.fromConnectionString(connStr, TABLE_NAME);
  // Create table if it doesn't exist (safe to call repeatedly)
  try { await _client.createTable(); } catch (e) { /* already exists */ }
  return _client;
}

// Get current seat entity — creates it at 0 if it doesn't exist yet
async function getOrCreateSeatEntity(travelDate, serviceNumber) {
  const client = await getClient();
  const pk = String(travelDate);
  const rk = String(serviceNumber);
  try {
    const entity = await client.getEntity(pk, rk);
    return entity;
  } catch (err) {
    if (err.statusCode === 404) {
      // First booking for this service on this date — create the row
      try {
        await client.createEntity({
          partitionKey: pk,
          rowKey:       rk,
          SeatsBooked:  0,
          Capacity:     CAPACITY,
        });
      } catch (createErr) {
        // Another concurrent request may have created it — that's fine
      }
      return await client.getEntity(pk, rk);
    }
    throw err;
  }
}

// Atomically increment seat count — returns { success, seatsBooked, seatsLeft }
// Uses ETag optimistic concurrency with retry loop
async function bookSeat(travelDate, serviceNumber) {
  const client = await getClient();
  const pk = String(travelDate);
  const rk = String(serviceNumber);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const entity = await getOrCreateSeatEntity(travelDate, serviceNumber);
    const current = entity.SeatsBooked || 0;

    if (current >= CAPACITY) {
      return { success: false, reason: 'full', seatsBooked: current, seatsLeft: 0 };
    }

    try {
      await client.updateEntity(
        { partitionKey: pk, rowKey: rk, SeatsBooked: current + 1, Capacity: CAPACITY },
        'Replace',
        { etag: entity.etag }
      );
      return { success: true, seatsBooked: current + 1, seatsLeft: CAPACITY - (current + 1) };
    } catch (err) {
      if (err.statusCode === 412) {
        // ETag conflict — another booking landed first, retry
        const delay = 50 * attempt;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  return { success: false, reason: 'conflict', seatsBooked: -1, seatsLeft: -1 };
}

// Decrement seat count (for cancellations) — also uses ETag retry
async function releaseSeat(travelDate, serviceNumber) {
  const client = await getClient();
  const pk = String(travelDate);
  const rk = String(serviceNumber);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let entity;
    try { entity = await client.getEntity(pk, rk); }
    catch (e) { return { success: true }; } // Entity doesn't exist — nothing to release

    const current = entity.SeatsBooked || 0;
    const newVal  = Math.max(0, current - 1);

    try {
      await client.updateEntity(
        { partitionKey: pk, rowKey: rk, SeatsBooked: newVal, Capacity: CAPACITY },
        'Replace',
        { etag: entity.etag }
      );
      return { success: true, seatsBooked: newVal, seatsLeft: CAPACITY - newVal };
    } catch (err) {
      if (err.statusCode === 412) {
        await new Promise(r => setTimeout(r, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
  return { success: false, reason: 'conflict' };
}

// Get seat availability for a date — returns map of { serviceNumber: { booked, left } }
async function getAvailabilityForDate(travelDate) {
  const client = await getClient();
  const entities = client.listEntities({
    queryOptions: { filter: odata`PartitionKey eq ${String(travelDate)}` }
  });
  const result = {};
  for await (const entity of entities) {
    const svcNum = entity.rowKey;
    const booked = entity.SeatsBooked || 0;
    result[svcNum] = { booked, left: CAPACITY - booked };
  }
  return result;
}

// Seed a new travel date with all 9 services at 0 booked
// Call this when an admin sets up a new day
async function seedDate(travelDate) {
  const client = await getClient();
  for (let svc = 1; svc <= 9; svc++) {
    try {
      await client.createEntity({
        partitionKey: String(travelDate),
        rowKey:       String(svc),
        SeatsBooked:  0,
        Capacity:     CAPACITY,
      });
    } catch (e) { /* already exists */ }
  }
}

module.exports = { bookSeat, releaseSeat, getAvailabilityForDate, seedDate, CAPACITY };
