// api/shared/msLists.js
// Microsoft Lists (SharePoint REST API) — app-only auth via client credentials

const fetch = require('node-fetch');

const TENANT_ID     = process.env.SHAREPOINT_TENANT_ID;
const CLIENT_ID     = process.env.SHAREPOINT_CLIENT_ID;
const SITE_URL      = process.env.SHAREPOINT_SITE_URL;

let _tokenCache = { token: null, expiry: 0 };

async function getAccessToken() {
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
  if (!data.access_token) throw new Error('Failed to get SharePoint token: ' + JSON.stringify(data));
  _tokenCache = { token: data.access_token, expiry: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function getListItems(listName, filter = '', select = '', top = 500) {
  const token = await getAccessToken();
  let url = `${SITE_URL}/_api/lists/getbytitle('${encodeURIComponent(listName)}')/items?$top=${top}`;
  if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
  if (select) url += `&$select=${encodeURIComponent(select)}`;
  const res  = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json;odata=nometadata' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`getListItems(${listName}) failed: ${JSON.stringify(data)}`);
  return data.value || [];
}

async function getListItem(listName, filter) {
  const items = await getListItems(listName, filter, '', 1);
  return items[0] || null;
}

async function createListItem(listName, fields) {
  const token = await getAccessToken();
  const url   = `${SITE_URL}/_api/lists/getbytitle('${encodeURIComponent(listName)}')/items`;
  const res   = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      Accept:         'application/json;odata=nometadata',
      'Content-Type': 'application/json;odata=nometadata',
    },
    body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`createListItem(${listName}) failed: ${JSON.stringify(data)}`);
  return data;
}

async function updateListItem(listName, itemId, fields) {
  const token = await getAccessToken();
  const url   = `${SITE_URL}/_api/lists/getbytitle('${encodeURIComponent(listName)}')/items(${itemId})`;
  const res   = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:   `Bearer ${token}`,
      Accept:          'application/json;odata=nometadata',
      'Content-Type':  'application/json;odata=nometadata',
      'IF-MATCH':      '*',
      'X-HTTP-Method': 'MERGE',
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`updateListItem(${listName}, ${itemId}) failed: ${text}`);
  }
  return true;
}

module.exports = { getListItems, getListItem, createListItem, updateListItem };
