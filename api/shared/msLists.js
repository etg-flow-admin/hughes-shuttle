// api/shared/msLists.js
// Microsoft Graph API — uses list IDs from app settings

const fetch = require('node-fetch');

const TENANT_ID  = process.env.SHAREPOINT_TENANT_ID;
const CLIENT_ID  = process.env.SHAREPOINT_CLIENT_ID;
const SITE_ID    = 'equitytransportgroup.sharepoint.com,7d2ff47a-ce6d-480d-ba80-0338c1eece11,0908d58e-4a2a-4a75-b2c2-6b1aefb88c5c';

const LIST_IDS = {
  ShuttleUsers:    process.env.SHAREPOINT_LIST_USERS,
  ShuttleBookings: process.env.SHAREPOINT_LIST_BOOKINGS,
  ShuttleServices: process.env.SHAREPOINT_LIST_SERVICES,
};

const GRAPH_BASE = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists`;

// Explicit field selects for each list — required to retrieve hidden fields
const LIST_FIELDS = {
  ShuttleUsers:    'id,Title,Name,StudentID,RoomNumber,PasswordHash,EmailVerified,OTPCode,OTPExpiry,Status,IsAdmin,Mobile,LastLoginAt,CreatedAt,TwoFactorCode,TwoFactorExpiry,TrustedDevices',
  ShuttleBookings: 'id,Title,UserEmail,Name,StudentID,RoomNumber,ServiceNumber,StopNumber,AlightingStop,DepartureTime,TravelDate,Status,BookedAt,CancelledAt',
  ShuttleServices: 'id,Title,ServiceNumber,Stop1Time,Stop2Time,Stop3Time,Stop4Time,Stop5Time,Stop6Time,Stop7Time,IsDisabled,DropoffOnlyStops,UpdatedAt',
};

let _tokenCache = { token: null, expiry: 0 };

async function getGraphToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiry - 60000) return _tokenCache.token;
  const { getSecret } = require('./keyVault');
  const clientSecret  = await getSecret('sharepoint-client-secret');
  const url  = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });
  const res  = await fetch(url, { method: 'POST', body });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Graph token: ' + JSON.stringify(data));
  _tokenCache = { token: data.access_token, expiry: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function getListId(listName) {
  const id = LIST_IDS[listName];
  if (!id) throw new Error(`List ID not configured for '${listName}'. Check SHAREPOINT_LIST_* app settings.`);
  return id;
}

async function getListItems(listName, filter = '', select = '', top = 500) {
  const token    = await getGraphToken();
  const listId   = getListId(listName);
  const fields   = select || LIST_FIELDS[listName] || '';
  const expand   = fields ? `fields($select=${fields})` : 'fields';
  const graphFilter = filter ? filter.replace(/(\w+)\s+(eq|ne|lt|gt|le|ge|startswith)/gi, 'fields/$1 $2') : '';
  let url = `${GRAPH_BASE}/${listId}/items?$expand=${expand}&$top=${top}`;
  if (graphFilter) url += `&$filter=${encodeURIComponent(graphFilter)}`;
  const res  = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`getListItems(${listName}) failed: ${JSON.stringify(data)}`);
  return (data.value || []).map(item => ({ ID: item.id, ...item.fields }));
}

async function getListItem(listName, filter) {
  const items = await getListItems(listName, filter, '', 1);
  return items[0] || null;
}

async function createListItem(listName, fields) {
  const token  = await getGraphToken();
  const listId = getListId(listName);
  const url    = `${GRAPH_BASE}/${listId}/items`;
  const res    = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`createListItem(${listName}) failed: ${JSON.stringify(data)}`);
  return { ID: data.id, ...data.fields };
}

async function updateListItem(listName, itemId, fields) {
  const token  = await getGraphToken();
  const listId = getListId(listName);
  const url    = `${GRAPH_BASE}/${listId}/items/${itemId}/fields`;
  const res    = await fetch(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`updateListItem(${listName}, ${itemId}) failed: ${text}`);
  }
  return true;
}

module.exports = { getListItems, getListItem, createListItem, updateListItem };
