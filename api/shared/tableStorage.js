// api/shared/tableStorage.js
// Segment-based seat booking using Azure Table Storage
// RowKey format: "{serviceNumber}-{stopNumber}"
// Each row tracks passengers ON BOARD departing that stop

const { TableClient, TableServiceClient } = require('@azure/data-tables');
const { getSecret } = require('./keyVault');

const TABLE_NAME = process.env.SEGMENTS_TABLE_NAME || 'ShuttleSegments';
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

async function getServiceSegments(travelDate, serviceNumber) {
  const client = await getClient();
  const prefix = `${serviceNumber}-`;
  const result = {};
  const iter   = client.listEntities({ queryOptions: {
    filter: `PartitionKey eq '${travelDate}' and RowKey ge '${prefix}' and RowKey lt '${prefix}~'`
  }});
  for await (const entity of iter) {
    const stopNum = parseInt(entity.rowKey.split('-')[1]);
    result[stopNum] = entity.onBoard || 0;
  }
  return result;
}

async function getAvailabilityForDate(travelDate) {
  const client = await getClient();
  const iter   = client.listEntities({ queryOptions: {
    filter: `PartitionKey eq '${travelDate}'`
  }});
  const raw = {};
  for await (const entity of iter) {
    const [svcNum, stopNum] = entity.rowKey.split('-').map(Number);
    if (!raw[svcNum]) raw[svcNum] = {};
    raw[svcNum][stopNum] = entity.onBoard || 0;
  }
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

async function getStopAvailability(travelDate, serviceNumber, activeStops) {
  const segments = await getServiceSegments(travelDate, serviceNumber);
  const result   = {};
  const lastStop  = Math.max(...activeStops);
  for (const stop of activeStops) {
    let maxOccupancy = 0;
    for (let s = stop; s < lastStop; s++) {
      maxOccupancy = Math.max(maxOccupancy, segments[s] || 0);
    }
    result[stop] = Math.max(0, CAPACITY - maxOccupancy);
  }
  return result;
}

async function bookSeat(travelDate, serviceNumber, boardingStop, alightingStop) {
  await ensureTable();
  const client   = await getClient();
  const pk       = travelDate;
  const segStops = [];
  for (let s = boardingStop; s < alightingStop; s++) segStops.push(s);

  // First pass: read all segments and check capacity
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entities = {};
    for (const stop of segStops) {
      try {
        entities[stop] = await client.getEntity(pk, `${serviceNumber}-${stop}`);
      } catch (e) {
        if (e.statusCode === 404) entities[stop] = null;
        else throw e;
      }
    }
    // Check capacity across all segments
    for (const stop of segStops) {
      if ((entities[stop]?.onBoard || 0) >= CAPACITY) {
        return { success: false, reason: 'full', fullAtStop: stop };
      }
    }
    // Increment each segment individually
    let allOk = true;
    for (const stop of segStops) {
      const rk      = `${serviceNumber}-${stop}`;
      const onBoard = (entities[stop]?.onBoard || 0) + 1;
      try {
        if (entities[stop]) {
          await client.updateEntity({ partitionKey: pk, rowKey: rk, onBoard }, 'Merge');
        } else {
          await client.createEntity({ partitionKey: pk, rowKey: rk, onBoard });
        }
      } catch (e) {
        if (e.statusCode === 412 || e.statusCode === 409) { allOk = false; break; }
        throw e;
      }
    }
    if (allOk) {
      const seatsLeft = CAPACITY - Math.max(...segStops.map(s => (entities[s]?.onBoard || 0) + 1));
      return { success: true, seatsLeft: Math.max(0, seatsLeft) };
    }
    // Retry on conflict
  }
  return { success: false, reason: 'conflict' };
}

async function cancelSeat(travelDate, serviceNumber, boardingStop, alightingStop) {
  const client   = await getClient();
  const pk       = travelDate;
  const segStops = [];
  for (let s = boardingStop; s < alightingStop; s++) segStops.push(s);

  if (segStops.length === 0) return { success: true };

  // Use individual updateEntity calls — more reliable than batch for cancellations
  // and gives clearer error messages per segment
  for (const stop of segStops) {
    const rk = `${serviceNumber}-${stop}`;
    const MAX_RETRIES = 5;
    let decremented = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let entity;
      try {
        entity = await client.getEntity(pk, rk);
      } catch (e) {
        if (e.statusCode === 404) { decremented = true; break; } // row doesn't exist — nothing to decrement
        throw e;
      }
      const current = entity.onBoard || 0;
      if (current <= 0) { decremented = true; break; } // already 0
      try {
        await client.updateEntity(
          { partitionKey: pk, rowKey: rk, onBoard: current - 1 },
          'Merge'
        );
        decremented = true;
        break;
      } catch (e) {
        if (e.statusCode === 412) continue; // ETag conflict — retry
        throw e;
      }
    }
    if (!decremented) return { success: false, reason: 'conflict', stop };
  }
  return { success: true };
}

module.exports = { bookSeat, cancelSeat, getAvailabilityForDate, getStopAvailability, getServiceSegments, CAPACITY };
