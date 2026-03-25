const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

const ROOT = path.join(os.homedir(), '.craftlauncher');
const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getInstanceBaseDir(instance) {
  return instance?.gameDir || path.join(ROOT, 'instances', instance.id);
}

function getContentTargetDir(instance, type) {
  const baseDir = getInstanceBaseDir(instance);
  if (type === 'mod') return ensureDir(path.join(baseDir, 'mods'));
  if (type === 'shader') return ensureDir(path.join(baseDir, 'shaderpacks'));
  if (type === 'resourcepack') return ensureDir(path.join(baseDir, 'resourcepacks'));
  throw new Error(`Type de contenu non supporte : ${type}`);
}

function getAllowedExtensions(type) {
  if (type === 'mod') return ['.jar', '.zip'];
  if (type === 'shader' || type === 'resourcepack') return ['.zip', '.jar'];
  return [];
}

function formatVersionGroups(versions) {
  const grouped = new Map();

  versions.forEach(version => {
    const parts = version.id.split('.');
    const key = parts.length >= 2 ? `${parts[0]}.${parts[1]}.x` : 'Autres';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(version.id);
  });

  const entries = Array.from(grouped.entries()).sort((a, b) => {
    const aValue = parseFloat(a[0]);
    const bValue = parseFloat(b[0]);
    return Number.isNaN(bValue - aValue) ? 0 : bValue - aValue;
  });

  return entries.map(([label, items]) => ({ label, versions: items }));
}

async function getMinecraftVersionGroups() {
  const { data } = await axios.get(VERSION_MANIFEST_URL, { timeout: 15000 });
  const releases = (data.versions || []).filter(version => version.type === 'release');
  const snapshots = (data.versions || []).filter(version => version.type === 'snapshot').slice(0, 12);

  return {
    latest: data.latest || {},
    releaseGroups: formatVersionGroups(releases),
    snapshots: snapshots.map(version => version.id),
  };
}

function copyFilesToTarget(filePaths, targetDir, type) {
  const allowedExtensions = getAllowedExtensions(type);
  const copied = [];

  filePaths.forEach(filePath => {
    const ext = path.extname(filePath).toLowerCase();
    if (!allowedExtensions.includes(ext)) return;

    const fileName = path.basename(filePath);
    const destination = path.join(targetDir, fileName);
    fs.copyFileSync(filePath, destination);
    copied.push(fileName);
  });

  return copied;
}

function pickModrinthVersion(versions, instance, type) {
  const matchingVersion = versions.find(version => {
    const matchesGameVersion = !instance?.version || (version.game_versions || []).includes(instance.version);
    const loaders = version.loaders || [];

    if (type === 'mod') {
      if (!instance?.modLoader || instance.modLoader === 'vanilla') return matchesGameVersion;
      return matchesGameVersion && (loaders.includes(instance.modLoader) || loaders.includes('minecraft'));
    }

    return matchesGameVersion;
  });

  return matchingVersion || versions[0] || null;
}

function pickPrimaryFile(version, type) {
  const allowedExtensions = getAllowedExtensions(type);
  const files = version?.files || [];
  return files.find(file => file.primary && allowedExtensions.includes(path.extname(file.filename).toLowerCase()))
    || files.find(file => allowedExtensions.includes(path.extname(file.filename).toLowerCase()))
    || null;
}

async function downloadFile(url, destination) {
  const writer = fs.createWriteStream(destination);
  const response = await axios.get(url, { responseType: 'stream', timeout: 30000 });

  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function installFromModrinth(instance, projectId, type) {
  if (!projectId) throw new Error('Projet Modrinth manquant');

  const versionsResponse = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, { timeout: 20000 });
  const selectedVersion = pickModrinthVersion(versionsResponse.data || [], instance, type);
  if (!selectedVersion) throw new Error('Aucune version compatible trouvee');

  const file = pickPrimaryFile(selectedVersion, type);
  if (!file?.url || !file?.filename) throw new Error('Aucun fichier telechargeable trouve');

  const targetDir = getContentTargetDir(instance, type);
  const destination = path.join(targetDir, file.filename);
  await downloadFile(file.url, destination);

  return {
    fileName: file.filename,
    versionName: selectedVersion.name,
    targetDir,
  };
}

module.exports = {
  getMinecraftVersionGroups,
  getContentTargetDir,
  copyFilesToTarget,
  installFromModrinth,
};
