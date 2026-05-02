// POST /api/mgmt-update-stops
// { stops: [{ num, name, addr }] }
const { wrapHandler }             = require('../shared/logger');
const { requireAdmin, authError } = require('../shared/auth');
const { TableClient }             = require('@azure/data-tables');
const { getSecret }               = require('../shared/keyVault');

const STOPS_TABLE = process.env.STOPS_TABLE_NAME || 'ShuttleStops';

async function getStopsClient() {
  const conn = await getSecret('azure-storage-connection');
  const client = TableClient.fromConnectionString(conn, STOPS_TABLE);
  try { await client.createTable(); } catch(e) { /* exists */ }
  return client;
}

module.exports = wrapHandler('mgmt-update-stops', async function (context, req) {
  try { await requireAdmin(req); } catch(err) { authError(context, err); return; }

  const { stops } = req.body || {};
  if (!Array.isArray(stops) || !stops.length) {
    context.res = { status: 400, body: { error: 'stops array required.' } }; return;
  }
  try {
    const client = await getStopsClient();
    for (const stop of stops) {
      await client.upsertEntity({
        partitionKey: 'stops',
        rowKey:       String(stop.num),
        name:         stop.name || '',
        addr:         stop.addr || '',
      }, 'Replace');
    }
    context.log.info('mgmt-update-stops: updated ' + stops.length + ' stops');
    context.res = { status: 200, body: { updated: true } };
  } catch (err) {
    context.log.error('mgmt-update-stops:', err.message);
    context.res = { status: 500, body: { error: 'Failed to save stops.' } };
    throw err;
  }
});
