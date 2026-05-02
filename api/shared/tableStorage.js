// api/shared/tableStorage.js
// Segment-based seat booking using Azure Table Storage
// RowKey format: "{serviceNumber}-{stopNumber}"
// Each row tracks passengers ON BOARD departing that stop
// Booking Stop A → Stop B touches segments A, A+1, ... B-1

const { TableClient, TableServiceClient } = require('@azure/data-tables');
const { getSecret } = require('./keyVault');

const isSandbox  = process.env.ENVIRONMENT === 'sandbox';
const TABLE_NAME = isSandbox
  ? (process.env.SEGMENTS_TABLE_NAME_SANDBOX || 'ShuttleSegmentsSandbox')
  : (process.env.SEGMENTS_TABLE_NAME         || 'ShuttleSegments');
const CAPACITY   = 22;

let _connStr = null;
async function getConnStr() {
  if (_connStr) return _connStr;
  _connStr = await getSecret('azure-storage-connection');
  return _connStr;
}

async function getClient() {
  const conn = await getConnStr();
  return TableClient.fromConnectionString(conn, TABLE_NAME);
}

async function ensureTable() {
  const conn = await getConnStr();
  try {
    const svc = TableServiceClient.fromConnectionString(conn);
    await svc.createTable(TABLE_NAME);
  } catch (e) {
    if (!e.message?.includes('TableAlreadyExists')) throw e;
  }
}

// ── Get all segment counts for a service on a date ──
// Returns object: { stopNum: onBoard, ... }
async function getServiceSegments(travelDate, serviceNumber) {
  const client  = getClient();
  const pk      = travelDate;
  const prefix  = `${serviceNumber}-`;
  const result  = {};
  const iter    = client.listEntities({ queryOptions: {
    filter: `PartitionKey eq '${pk}' and RowKey ge '${prefix}' and RowKey lt '${prefix}~'`
  }});
  for await (const entity of iter) {
    const stopNum = parseInt(entity.rowKey.split('-')[1]);
    result[stopNum] = entity.onBoard || 0;
  }
  return result;
}

// ── Get availability for a date — all services ──
// Returns: { serviceNumber: { segments: {stopNum: onBoard}, maxOnBoard, seatsLeft } }
async function getAvailabilityForDate(travelDate) {
  const client = getClient();
  const iter   = client.listEntities({ queryOptions: {
    filter: `PartitionKey eq '${travelDate}'`
  }});
  const raw = {};
  for await (const entity of iter) {
    const [svcNum, stopNum] = entity.rowKey.split('-').map(Number);
    if (!raw[svcNum]) raw[svcNum] = {};
    raw[svcNum][stopNum] = entity.onBoard || 0;
  }
  // Build per-service summary
  const result = {};
  for (const [svcNum, segments] of Object.entries(raw)) {
    const values     = Object.values(segments);
    const maxOnBoard = values.length ? Math.max(...values) : 0;
    result[svcNum]   = {
      segments,
      maxOnBoard,
      booked:    maxOnBoard,
      seatsLeft: Math.max(0, CAPACITY - maxOnBoard),
    };
  }
  return result;
}

// ── Get per-stop availability for a specific service ──
// Returns: { stopNum: seatsAvailableIfBoardingHere }
// "seats available if boarding at stop N riding to last stop"
async function getStopAvailability(travelDate, serviceNumber, activeStops) {
  const segments = await getServiceSegments(travelDate, serviceNumber);
  const result   = {};
  const lastStop  = Math.max(...activeStops);
  for (const stop of activeStops) {
    // Max occupancy from this stop to last stop
    let maxOccupancy = 0;
    for (let s = stop; s < lastStop; s++) {
      maxOccupancy = Math.max(maxOccupancy, segments[s] || 0);
    }
    result[stop] = Math.max(0, CAPACITY - maxOccupancy);
  }
  return result;
}

// ── Book a seat: A → B ──
// Atomically increments segments A, A+1, ... B-1
// Uses optimistic concurrency with ETags per entity
async function bookSeat(travelDate, serviceNumber, boardingStop, alightingStop) {
  await ensureTable();
  const client = getClient();
  const pk     = travelDate;

  const segStops = [];
  for (let s = boardingStop; s < alightingStop; s++) segStops.push(s);

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Read all segment entities
    const entities = {};
    for (const stop of segStops) {
      const rk = `${serviceNumber}-${stop}`;
      try {
        const entity = await client.getEntity(pk, rk);
        entities[stop] = entity;
      } catch (e) {
        if (e.statusCode === 404) {
          entities[stop] = null; // doesn't exist yet — onBoard = 0
        } else throw e;
      }
    }

    // Check capacity across all segments
    for (const stop of segStops) {
      const onBoard = entities[stop]?.onBoard || 0;
      if (onBoard >= CAPACITY) {
        return { success: false, reason: 'full', fullAtStop: stop };
      }
    }

    // Attempt batch upsert with ETag concurrency
    try {
      const actions = segStops.map(stop => {
        const rk       = `${serviceNumber}-${stop}`;
        const onBoard  = (entities[stop]?.onBoard || 0) + 1;
        const entity   = { partitionKey: pk, rowKey: rk, onBoard };
        if (entities[stop]) {
          // Update with ETag check
          return ['update', entity, { etag: entities[stop].etag, mode: 'Replace' }];
        } else {
          // Insert new
          return ['create', entity];
        }
      });

      await client.submitTransaction(actions);

      // Return updated availability
      const seatsLeft = CAPACITY - Math.max(...segStops.map(s => (entities[s]?.onBoard || 0) + 1));
      return { success: true, seatsLeft: Math.max(0, seatsLeft) };

    } catch (e) {
      if (e.statusCode === 412 || e.message?.includes('UpdateConditionNotSatisfied')) {
        // ETag conflict — retry
        continue;
      }
      throw e;
    }
  }
  return { success: false, reason: 'conflict' };
}

// ── Cancel a seat: A → B ──
// Decrements segments A, A+1, ... B-1 (floor at 0)
async function cancelSeat(travelDate, serviceNumber, boardingStop, alightingStop) {
  const client = getClient();
  const pk     = travelDate;

  const segStops = [];
  for (let s = boardingStop; s < alightingStop; s++) segStops.push(s);

  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entities = {};
    for (const stop of segStops) {
      const rk = `${serviceNumber}-${stop}`;
      try {
        entities[stop] = await client.getEntity(pk, rk);
      } catch (e) {
        if (e.statusCode === 404) entities[stop] = null;
        else throw e;
      }
    }

    try {
      const actions = segStops
        .filter(stop => entities[stop] && (entities[stop].onBoard || 0) > 0)
        .map(stop => {
          const rk      = `${serviceNumber}-${stop}`;
          const onBoard = Math.max(0, (entities[stop].onBoard || 0) - 1);
          return ['update', { partitionKey: pk, rowKey: rk, onBoard }, { etag: entities[stop].etag, mode: 'Replace' }];
        });

      if (actions.length) await client.submitTransaction(actions);
      return { success: true };

    } catch (e) {
      if (e.statusCode === 412 || e.message?.includes('UpdateConditionNotSatisfied')) continue;
      throw e;
    }
  }
  return { success: false, reason: 'conflict' };
}

module.exports = { bookSeat, cancelSeat, getAvailabilityForDate, getStopAvailability, getServiceSegments, CAPACITY };
