// api/shared/tableStorage.js
// Segment-based seat booking using Azure Table Storage
// RowKey format: "{serviceNumber}-{stopNumber}"
// Each row tracks passengers ON BOARD departing that stop
// Booking Stop A to Stop B touches segments A, A+1, ... B-1

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
    for (const stop of segStops) {
      if ((entities[stop]?.onBoard || 0) >= CAPACITY) {
        return { success: false, reason: 'full', fullAtStop: stop };
      }
    }
    try {
      const actions = segStops.map(stop => {
        const rk     = `${serviceNumber}-${stop}`;
        const onBoard = (entities[stop]?.onBoard || 0) + 1;
        const entity  = { partitionKey: pk, rowKey: rk, onBoard };
        return entities[stop]
          ? ['update', entity, { etag: entities[stop].etag, mode: 'Replace' }]
          : ['create', entity];
      });
      await client.submitTransaction(actions);
      const seatsLeft = CAPACITY - Math.max(...segStops.map(s => (entities[s]?.onBoard || 0) + 1));
      return { success: true, seatsLeft: Math.max(0, seatsLeft) };
    } catch (e) {
      if (e.statusCode === 412 || e.message?.includes('UpdateConditionNotSatisfied')) continue;
      throw e;
    }
  }
  return { success: false, reason: 'conflict' };
}

async function cancelSeat(travelDate, serviceNumber, boardingStop, alightingStop) {
  const client   = await getClient();
  const pk       = travelDate;
  const segStops = [];
  for (let s = boardingStop; s < alightingStop; s++) segStops.push(s);

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
    try {
      const actions = segStops
        .filter(stop => entities[stop] && (entities[stop].onBoard || 0) > 0)
        .map(stop => {
          const onBoard = Math.max(0, (entities[stop].onBoard || 0) - 1);
          return ['update',
            { partitionKey: pk, rowKey: `${serviceNumber}-${stop}`, onBoard },
            { etag: entities[stop].etag, mode: 'Replace' }
          ];
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
