// GET /api/get-stops
// Returns stop name/address overrides from ShuttleStops table
// Falls back to defaults if no overrides stored
const { wrapHandler }            = require('../shared/logger');
const { verifyToken, authError } = require('../shared/auth');
const { TableClient }            = require('@azure/data-tables');
const { getSecret }              = require('../shared/keyVault');

const STOPS_TABLE = process.env.STOPS_TABLE_NAME || 'ShuttleStops';

const DEFAULTS = [
  { num:1, name:'Adelaide University Village', addr:'210 Grote St' },
  { num:2, name:'City Campus West',            addr:'Medical School' },
  { num:3, name:'Bus Interchange Centre',      addr:'Stop W2 King William St - West side' },
  { num:4, name:'Bus Interchange Centre',      addr:'Stop C3 King William St - East side' },
  { num:5, name:'City Campus East',            addr:'Business School' },
  { num:6, name:'Central Market & Chinatown',  addr:'Stop W2 Grote St - South side' },
  { num:7, name:'Adelaide University Village', addr:'Return - 210 Grote St' },
];

async function getStopsClient() {
  const conn = await getSecret('azure-storage-connection');
  const client = TableClient.fromConnectionString(conn, STOPS_TABLE);
  try { await client.createTable(); } catch(e) { /* exists */ }
  return client;
}

module.exports = wrapHandler('get-stops', async function (context, req) {
  try { await verifyToken(req); } catch(err) { authError(context, err); return; }
  try {
    const client = await getStopsClient();
    const overrides = {};
    for await (const entity of client.listEntities()) {
      overrides[+entity.rowKey] = { name: entity.name, addr: entity.addr };
    }
    const stops = DEFAULTS.map(s => ({
      num:  s.num,
      name: overrides[s.num]?.name ?? s.name,
      addr: overrides[s.num]?.addr ?? s.addr,
    }));
    context.res = { status: 200, body: { stops } };
  } catch (err) {
    context.log.error('get-stops:', err.message);
    context.res = { status: 200, body: { stops: DEFAULTS } };
  }
});
