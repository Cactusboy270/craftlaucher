/**
 * instance-manager.js
 * Gestion des instances Minecraft (création, suppression, listing).
 * Les instances sont stockées dans appData/CraftLauncher/instances.json
 */

const { app } = require('electron');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');

const DATA_DIR    = path.join(app.getPath('appData'), 'CraftLauncher');
const CONFIG_PATH = path.join(DATA_DIR, 'instances.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(CONFIG_PATH)) return [];
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function save(instances) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(instances, null, 2));
}

function list() {
  return load();
}

function get(id) {
  return load().find(i => i.id === id) || null;
}

function create(data) {
  const instances = load();
  const instance = {
    id:        crypto.randomUUID(),
    name:      data.name      || 'Nouvelle instance',
    mcVersion: data.mcVersion || '1.21.4',
    type:      data.type      || 'release',   // release | snapshot | forge | fabric
    ram:       data.ram       || '4G',
    javaPath:  data.javaPath  || 'java',
    jvmArgs:   data.jvmArgs   || ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled'],
    icon:      data.icon      || '🌿',
    modpackUrl: data.modpackUrl || null,
    createdAt: new Date().toISOString(),
    lastPlayed: null,
    playTime:  0,
  };
  instances.push(instance);
  save(instances);
  return instance;
}

function update(id, data) {
  const instances = load();
  const idx = instances.findIndex(i => i.id === id);
  if (idx === -1) throw new Error('Instance introuvable');
  instances[idx] = { ...instances[idx], ...data };
  save(instances);
  return instances[idx];
}

function deleteInstance(id) {
  const instances = load().filter(i => i.id !== id);
  save(instances);
  // Optionnel : supprimer le dossier de l'instance
  const instDir = path.join(DATA_DIR, 'instances', id);
  if (fs.existsSync(instDir)) fs.rmSync(instDir, { recursive: true });
  return { success: true };
}

module.exports = { list, get, create, update, delete: deleteInstance };
