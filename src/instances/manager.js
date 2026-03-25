/**
 * src/instances/manager.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(os.homedir(), '.craftlauncher');

function getInstanceDir(instanceOrId) {
  if (instanceOrId && typeof instanceOrId === 'object') {
    if (instanceOrId.gameDir) return instanceOrId.gameDir;
    if (instanceOrId.modsPath) return path.dirname(instanceOrId.modsPath);
    if (instanceOrId.id) return path.join(ROOT, 'instances', instanceOrId.id);
  }

  return path.join(ROOT, 'instances', instanceOrId);
}

function normalizeRam(value, fallback = '4G') {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.endsWith('G')) return trimmed;

    const parsed = parseInt(trimmed, 10);
    if (parsed > 0) return `${parsed}G`;
  }

  const parsed = parseInt(value, 10);
  if (parsed > 0) return `${parsed}G`;
  return fallback;
}

function normalizeInstancePayload(data = {}, current = {}) {
  const id = current.id || data.id || crypto.randomUUID();
  const gameDir = data.gameDir || current.gameDir || getInstanceDir(id);

  const instance = {
    ...current,
    ...data,
    id,
    name: typeof data.name === 'string' ? (data.name.trim() || current.name || 'Nouvelle instance') : (current.name || 'Nouvelle instance'),
    version: data.version || current.version || '1.20.1',
    modLoader: Object.prototype.hasOwnProperty.call(data, 'modLoader') ? (data.modLoader || null) : (current.modLoader || null),
    releaseType: data.releaseType || current.releaseType || 'release',
    ram: normalizeRam(data.ram, normalizeRam(current.ram, '4G')),
    icon: data.icon || current.icon || '🌿',
    customJVMArgs: typeof data.customJVMArgs === 'string' ? data.customJVMArgs : (current.customJVMArgs || ''),
    windowWidth: parseInt(data.windowWidth, 10) || current.windowWidth || 1280,
    windowHeight: parseInt(data.windowHeight, 10) || current.windowHeight || 720,
    importedFrom: Object.prototype.hasOwnProperty.call(data, 'importedFrom') ? data.importedFrom : (current.importedFrom || null),
    publishedByAdmin: Object.prototype.hasOwnProperty.call(data, 'publishedByAdmin') ? Boolean(data.publishedByAdmin) : Boolean(current.publishedByAdmin),
    javaPath: Object.prototype.hasOwnProperty.call(data, 'javaPath') ? (data.javaPath || null) : (current.javaPath || null),
    createdAt: current.createdAt || Date.now(),
    gameDir,
  };

  instance.modsPath = data.modsPath || current.modsPath || path.join(gameDir, 'mods');
  return instance;
}

function getInstances(store) {
  return store.get('instances', []);
}

function createInstance(store, data) {
  const instances = getInstances(store);
  const instance = normalizeInstancePayload(data);

  fs.mkdirSync(instance.gameDir, { recursive: true });
  fs.mkdirSync(instance.modsPath, { recursive: true });

  instances.push(instance);
  store.set('instances', instances);
  return instance;
}

function updateInstance(store, id, data) {
  const instances = getInstances(store);
  const idx = instances.findIndex(i => i.id === id);
  if (idx === -1) return null;

  const updated = normalizeInstancePayload(data, instances[idx]);

  fs.mkdirSync(updated.gameDir, { recursive: true });
  fs.mkdirSync(updated.modsPath, { recursive: true });

  instances[idx] = updated;
  store.set('instances', instances);
  return updated;
}

function deleteInstance(store, id) {
  const instances = getInstances(store);
  const instance = instances.find(i => i.id === id);
  if (!instance) return false;

  const instanceDir = getInstanceDir(instance);
  if (fs.existsSync(instanceDir)) {
    try {
      deleteFolderRecursive(instanceDir);
      console.log(`[MANAGER] Dossier supprime : ${instanceDir}`);
    } catch (err) {
      console.error(`[MANAGER] Erreur suppression dossier : ${err.message}`);
      return false;
    }
  }

  store.set('instances', instances.filter(i => i.id !== id));
  return true;
}

function deleteFolderRecursive(folderPath) {
  if (!fs.existsSync(folderPath)) return;

  try {
    fs.rmSync(folderPath, { recursive: true, force: true });
  } catch {
    fs.readdirSync(folderPath).forEach(file => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(folderPath);
  }
}

module.exports = { getInstances, createInstance, updateInstance, deleteInstance };
