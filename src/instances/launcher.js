/**
 * src/core/launcher.js
 * Lance Minecraft via minecraft-launcher-core avec la session msmc
 */

const { Client } = require('minecraft-launcher-core');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const ROOT = path.join(os.homedir(), '.craftlauncher');

async function launchMinecraft({ instance, session, onProgress, onLog, onClose }) {
  if (!instance) return { success: false, error: 'Instance introuvable' };
  if (!session)  return { success: false, error: 'Non connecté' };

  const launcher = new Client();
  const gameDir  = path.join(ROOT, 'instances', instance.id);
  fs.mkdirSync(gameDir, { recursive: true });

  // L'objet authorization vient directement de msmc via session.mclc
  // Si mclc est dispo on l'utilise, sinon on le construit manuellement
  const authorization = session.mclc || {
    access_token:    session.mcToken,
    client_token:    session.uuid,
    uuid:            session.uuid,
    name:            session.username,
    user_properties: '{}',
    meta: { type: 'msa', demo: false },
  };

  console.log('Auth object:', JSON.stringify(authorization, null, 2));

  const opts = {
    authorization,
    root: gameDir,
    version: {
      number:   instance.version,
      type:     instance.releaseType || 'release',
      custom:   instance.modLoader && instance.modLoader !== 'vanilla'
                ? `${instance.modLoader}-${instance.version}`
                : undefined,
    },
    memory: {
      max: instance.ram || '4G',
      min: '512M',
    },
    window: {
      width:      instance.windowWidth  || 1280,
      height:     instance.windowHeight || 720,
      fullscreen: instance.fullscreen   || false,
    },
    javaPath:   instance.javaPath || detectJava(instance.version),
    customArgs: buildJVMArgs(instance),
    overrides: {
      gameDirectory: gameDir,
      assetRoot:     path.join(ROOT, 'assets'),
      libraryRoot:   path.join(ROOT, 'libraries'),
      versionRoot:   path.join(ROOT, 'versions'),
    },
  };

  launcher.on('debug',    msg => onLog?.({ type: 'debug', msg: String(msg) }));
  launcher.on('data',     msg => onLog?.({ type: 'log',   msg: String(msg) }));
  launcher.on('progress', e   => onProgress?.({
    type:    e.type,
    task:    e.task,
    total:   e.total,
    percent: e.total > 0 ? Math.round((e.task / e.total) * 100) : 0,
  }));
  launcher.on('close', code => onClose?.(code));

  try {
    await launcher.launch(opts);
    return { success: true };
  } catch (err) {
    console.error('Launch error:', err);
    onLog?.({ type: 'error', msg: err.message });
    return { success: false, error: err.message };
  }
}

function detectJava(mcVersion) {
  const parts = mcVersion.split('.');
  const minor = parseInt(parts[1]) || 0;
  const patch = parseInt(parts[2]) || 0;
  if (minor > 20 || (minor === 20 && patch >= 5)) return findJava(21) || findJava(17) || 'java';
  if (minor >= 17) return findJava(17) || findJava(16) || 'java';
  return findJava(8) || 'java';
}

function findJava(version) {
  const candidates = {
    win32: [
      `C:\\Program Files\\Eclipse Adoptium\\jdk-${version}\\bin\\javaw.exe`,
      `C:\\Program Files\\Java\\jdk-${version}\\bin\\javaw.exe`,
      `C:\\Program Files\\Microsoft\\jdk-${version}.0\\bin\\javaw.exe`,
    ],
    darwin: [
      `/Library/Java/JavaVirtualMachines/jdk-${version}.jdk/Contents/Home/bin/java`,
      `/opt/homebrew/opt/openjdk@${version}/bin/java`,
    ],
    linux: [
      `/usr/lib/jvm/java-${version}-openjdk-amd64/bin/java`,
      `/usr/lib/jvm/java-${version}-openjdk/bin/java`,
    ],
  };
  const list = candidates[process.platform] || [];
  return list.find(p => fs.existsSync(p)) || null;
}

function buildJVMArgs(instance) {
  const base = [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
  ];
  if (instance.customJVMArgs) {
    base.push(...instance.customJVMArgs.split(' ').filter(Boolean));
  }
  return base;
}

module.exports = { launchMinecraft };
