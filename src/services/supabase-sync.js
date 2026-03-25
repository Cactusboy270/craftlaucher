const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../../.env');

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};

  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  const values = {};

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    values[key] = value;
  });

  return values;
}

function getConfig() {
  const env = readEnvFile();
  return {
    url: process.env.SUPABASE_URL || env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.url && (config.anonKey || config.serviceRoleKey));
}

function buildHeaders(useServiceRole = false, extraHeaders = {}) {
  const config = getConfig();
  const apiKey = useServiceRole && config.serviceRoleKey ? config.serviceRoleKey : (config.anonKey || config.serviceRoleKey);
  if (!config.url || !apiKey) {
    throw new Error('Supabase non configure');
  }

  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extraHeaders,
  };
}

async function request(tableOrPath, { method = 'GET', query = '', body, useServiceRole = false, rawPath = false } = {}) {
  const config = getConfig();
  const pathPart = rawPath ? tableOrPath : `/rest/v1/${tableOrPath}`;
  const url = `${config.url}${pathPart}${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    method,
    headers: buildHeaders(useServiceRole),
    body: body == null ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erreur HTTP ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getAdminUUIDs() {
  if (!isConfigured()) return [];

  const rows = await request('admins', {
    query: 'select=uuid,enabled&enabled=eq.true',
  });

  return (rows || []).map(row => row.uuid).filter(Boolean);
}

async function enrichSessionWithRemoteAdmin(session) {
  if (!session) return session;

  try {
    const admins = await getAdminUUIDs();
    return { ...session, isAdmin: session.isAdmin || admins.includes(session.uuid) };
  } catch {
    return session;
  }
}

function serializePublishedInstance(instance, publishedBy) {
  return {
    id: instance.id,
    name: instance.name,
    version: instance.version,
    modLoader: instance.modLoader || null,
    releaseType: instance.releaseType || 'release',
    ram: instance.ram || '6G',
    icon: instance.icon || '📦',
    importedFrom: instance.importedFrom || null,
    published_by_admin: true,
    published_by_uuid: publishedBy || null,
    game_dir: instance.gameDir || null,
    mods_path: instance.modsPath || null,
    java_path: instance.javaPath || null,
    window_width: instance.windowWidth || 1280,
    window_height: instance.windowHeight || 720,
    custom_jvm_args: instance.customJVMArgs || '',
  };
}

function mapPublishedRow(row) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    modLoader: row.modLoader,
    releaseType: row.releaseType || 'release',
    ram: row.ram || '6G',
    icon: row.icon || '📦',
    importedFrom: row.importedFrom,
    publishedByAdmin: true,
    publishedByUUID: row.publishedByUUID || null,
    windowWidth: row.windowWidth || 1280,
    windowHeight: row.windowHeight || 720,
    customJVMArgs: row.customJVMArgs || '',
    isRemotePublished: true,
  };
}

async function publishInstance(instance, session) {
  if (!isConfigured()) return null;

  const payload = serializePublishedInstance(instance, session?.uuid);
  const rows = await request('published_instances', {
    method: 'POST',
    query: 'on_conflict=id',
    body: payload,
    useServiceRole: true,
  });

  return mapPublishedRow(Array.isArray(rows) ? rows[0] : rows);
}

async function removePublishedInstance(instanceId) {
  if (!isConfigured()) return false;

  await request('published_instances', {
    method: 'DELETE',
    query: `id=eq.${encodeURIComponent(instanceId)}`,
    useServiceRole: true,
  });

  return true;
}

async function listPublishedInstances() {
  if (!isConfigured()) return [];

  const rows = await request('published_instances', {
    query: 'select=id,name,version,modLoader:mod_loader,releaseType:release_type,ram,icon,importedFrom:imported_from,publishedByUUID:published_by_uuid,windowWidth:window_width,windowHeight:window_height,customJVMArgs:custom_jvm_args&order=created_at.desc',
  });

  return (rows || []).map(mapPublishedRow);
}

module.exports = {
  getConfig,
  isConfigured,
  getAdminUUIDs,
  enrichSessionWithRemoteAdmin,
  publishInstance,
  removePublishedInstance,
  listPublishedInstances,
};
