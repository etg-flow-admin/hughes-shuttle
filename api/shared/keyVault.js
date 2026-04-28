// api/shared/keyVault.js
const { SecretClient }           = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const KEY_VAULT_URL = process.env.KEY_VAULT_URL;
const _cache = {};
let _client = null;

function getClient() {
  if (!_client && KEY_VAULT_URL) {
    _client = new SecretClient(KEY_VAULT_URL, new DefaultAzureCredential());
  }
  return _client;
}

async function getSecret(name) {
  if (_cache[name]) return _cache[name];
  try {
    const client = getClient();
    if (client) {
      const secret = await client.getSecret(name);
      _cache[name] = secret.value;
      return secret.value;
    }
  } catch (err) {
    // Fall through to env var fallback
  }
  // Local dev fallback — map secret name to env var
  const envMap = {
    'jwt-secret':                    process.env.JWT_SECRET,
    'sharepoint-client-secret':      process.env.SHAREPOINT_CLIENT_SECRET,
    'comm-services-connection':      process.env.COMM_SERVICES_CONNECTION,
    'azure-storage-connection':      process.env.AZURE_STORAGE_CONNECTION_STRING,
  };
  const val = envMap[name] || process.env[name.toUpperCase().replace(/-/g, '_')];
  if (val) { _cache[name] = val; return val; }
  throw new Error(`Secret '${name}' not found in Key Vault or environment.`);
}

module.exports = { getSecret };
