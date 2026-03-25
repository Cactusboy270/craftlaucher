/**
 * src/core/launcher.js
 * Forge 1.17+ lancé directement (module-path correct)
 * Vanilla / Fabric / Quilt via minecraft-launcher-core
 */

const { Client } = require('minecraft-launcher-core');
const { spawn }  = require('child_process');
const path       = require('path');
const os         = require('os');
const fs         = require('fs');
const axios      = require('axios');
const { exec, execSync } = require('child_process');
const AdmZip     = require('adm-zip');

const ROOT     = path.join(os.homedir(), '.craftlauncher');
const JAVA_DIR = path.join(ROOT, 'java');

async function launchMinecraft({ instance, session, onProgress, onLog, onClose }) {
  if (!instance) return { success: false, error: 'Instance introuvable' };
  if (!session)  return { success: false, error: 'Non connecté' };

  const gameDir = instance.gameDir || path.join(ROOT, 'instances', instance.id);
  const modsDir = path.join(gameDir, 'mods');
  const shaderpacksDir = path.join(gameDir, 'shaderpacks');
  const resourcepacksDir = path.join(gameDir, 'resourcepacks');
  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(modsDir, { recursive: true });
  fs.mkdirSync(shaderpacksDir, { recursive: true });
  fs.mkdirSync(resourcepacksDir, { recursive: true });
  sanitizeVanillaOptions(instance, gameDir, onLog);

  const javaVersion = getRequiredJavaVersion(instance.version);
  onLog?.({ type: 'info', msg: `[JAVA] Version requise : Java ${javaVersion}` });

  let javaPath = instance.javaPath || findJavaOnSystem(javaVersion);
  if (!javaPath) {
    onLog?.({ type: 'info', msg: `[JAVA] Téléchargement Java ${javaVersion}...` });
    try { javaPath = await downloadJava(javaVersion, onLog, onProgress); }
    catch (e) { return { success: false, error: `Java ${javaVersion} introuvable : ${e.message}` }; }
  }
  onLog?.({ type: 'info', msg: `[JAVA] ✓ ${javaPath}` });

  const loader  = (instance.modLoader || '').toLowerCase();
  const isForge = loader === 'forge' || loader === 'neoforge';
  const minor   = parseInt(instance.version.split('.')[1]) || 0;
  let customVersionId = null;

  if (loader && loader !== 'vanilla') {
    try {
      if (isForge)                  customVersionId = await installForge(instance.version, javaPath, onLog, onProgress);
      else if (loader === 'fabric') customVersionId = await installFabric(instance.version, onLog, onProgress);
      else if (loader === 'quilt')  customVersionId = await installQuilt(instance.version, onLog, onProgress);
    } catch (e) {
      return { success: false, error: `Impossible d'installer ${loader} : ${e.message}` };
    }
  }

  if (instance.modsPath && fs.existsSync(instance.modsPath)) {
    const files = fs.readdirSync(instance.modsPath).filter(f => f.endsWith('.jar'));
    files.forEach(f => {
      const dest = path.join(modsDir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(instance.modsPath, f), dest);
    });
    onLog?.({ type: 'info', msg: `[MODS] ${files.length} mod(s) prêts` });
  }

  if (isForge && minor >= 17 && customVersionId) {
    return launchForgeDirect({ instance, session, javaPath, customVersionId, gameDir, onProgress, onLog, onClose });
  }
  return launchViaMCLC({ instance, session, javaPath, customVersionId, gameDir, onProgress, onLog, onClose });
}

function sanitizeVanillaOptions(instance, gameDir, onLog) {
  if ((instance.modLoader || 'vanilla') !== 'vanilla') return;

  const optionsPath = path.join(gameDir, 'options.txt');
  if (!fs.existsSync(optionsPath)) return;

  const original = fs.readFileSync(optionsPath, 'utf8');
  const lines = original.split(/\r?\n/);
  let changed = false;

  const nextLines = lines.map(line => {
    if (line.startsWith('resourcePacks:') && line !== 'resourcePacks:[]') {
      changed = true;
      return 'resourcePacks:[]';
    }
    if (line.startsWith('incompatibleResourcePacks:') && line !== 'incompatibleResourcePacks:[]') {
      changed = true;
      return 'incompatibleResourcePacks:[]';
    }
    if (line.startsWith('soundCategory_master:')) {
      const value = parseFloat(line.split(':')[1]);
      if (!Number.isFinite(value) || value <= 0) {
        changed = true;
        return 'soundCategory_master:1.0';
      }
    }
    return line;
  });

  if (!changed) return;

  fs.writeFileSync(optionsPath, nextLines.join('\n'), 'utf8');
  onLog?.({ type: 'info', msg: '[VANILLA] Options audio/resource packs reinitialisees pour l instance vanilla' });
}

// ══════════════════════════════════════════════════════════════════════════
// FORGE DIRECT
// ══════════════════════════════════════════════════════════════════════════
async function launchForgeDirect({ instance, session, javaPath, customVersionId, gameDir, onProgress, onLog, onClose }) {
  onLog?.({ type: 'info', msg: '[FORGE] Préparation du lancement direct...' });

  const libDir    = path.join(ROOT, 'libraries');
  const assetsDir = path.join(ROOT, 'assets');
  const versionJson = path.join(ROOT, 'versions', customVersionId, `${customVersionId}.json`);
  if (!fs.existsSync(versionJson)) return { success: false, error: `Version JSON introuvable : ${versionJson}` };

  const launcher = new Client();
  const authorization = session.mclc || {
    access_token: session.mcToken, client_token: session.uuid,
    uuid: session.uuid, name: session.username,
    user_properties: '{}', meta: { type: 'msa', demo: false },
  };

  onLog?.({ type: 'info', msg: '[FORGE] Téléchargement des assets/libraries...' });
  await new Promise((resolve) => {
    launcher.on('progress', e => onProgress?.({
      type: e.type, task: e.task, total: e.total,
      percent: e.total > 0 ? Math.round(e.task / e.total * 100) : 0,
    }));
    launcher.on('debug', () => {});
    launcher.launch({
      authorization, root: ROOT,
      version: { number: instance.version, type: 'release', custom: customVersionId },
      memory: { max: '512M', min: '256M' },
      javaPath, overrides: { gameDirectory: gameDir },
    }).then(resolve).catch(resolve);
    setTimeout(resolve, 15000);
  });

  onLog?.({ type: 'info', msg: '[FORGE] Construction des arguments de lancement...' });

  // Télécharger le JSON vanilla MC si absent (nécessaire pour le classpath)
  const mcVersionDir2  = path.join(ROOT, 'versions', instance.version);
  const mcVersionJson2 = path.join(mcVersionDir2, instance.version + '.json');
  if (!fs.existsSync(mcVersionJson2)) {
    try {
      fs.mkdirSync(mcVersionDir2, { recursive: true });
      onLog?.({ type: 'info', msg: '[FORGE] Téléchargement JSON vanilla MC...' });
      const manifest = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      const vEntry   = manifest.data.versions.find(v => v.id === instance.version);
      if (vEntry) {
        const vJson = await axios.get(vEntry.url);
        fs.writeFileSync(mcVersionJson2, JSON.stringify(vJson.data, null, 2));
        onLog?.({ type: 'info', msg: '[FORGE] JSON vanilla téléchargé' });
      }
    } catch (e3) { console.warn('[FORGE] JSON vanilla download error:', e3.message); }
  }

  const args = buildForgeArgs({ instance, session, customVersionId, gameDir, libDir, assetsDir });
  if (!args) return { success: false, error: 'Impossible de construire les arguments Forge' };

  onLog?.({ type: 'info', msg: '[FORGE] Lancement de Minecraft avec Forge...' });
  spawnMinecraft(javaPath, args, gameDir, onLog, onClose);
  return { success: true };
}

function buildForgeArgs({ instance, session, customVersionId, gameDir, libDir, assetsDir }) {
  try {
    const versionJson = path.join(ROOT, 'versions', customVersionId, `${customVersionId}.json`);
    const vData = JSON.parse(fs.readFileSync(versionJson, 'utf8'));
    const sep   = path.delimiter;

    // Lire et résoudre TOUS les args JVM du JSON Forge
    // Le JSON contient -p, --add-modules ALL-MODULE-PATH, --add-opens, --add-exports
    const resolvedJvmArgs = [];
    (vData.arguments?.jvm || []).forEach(arg => {
      if (typeof arg === 'string') {
        resolvedJvmArgs.push(
          arg.replace(/\${library_directory}/g, libDir)
             .replace(/\${classpath_separator}/g, sep)
             .replace(/\${version_name}/g, customVersionId)
        );
      } else if (arg && arg.value) {
        const vals = Array.isArray(arg.value) ? arg.value : [arg.value];
        vals.forEach(v => resolvedJvmArgs.push(
          v.replace(/\${library_directory}/g, libDir)
           .replace(/\${classpath_separator}/g, sep)
           .replace(/\${version_name}/g, customVersionId)
        ));
      }
    });

    // Classpath depuis les libraries du JSON Forge + JSON Minecraft vanilla (parent)
    // Forge ne liste pas log4j, slf4j, jopt-simple — ils viennent du JSON vanilla
    const collectLibJars = (libraries) => {
      const jars = [];
      (libraries || []).forEach(lib => {
        if (!lib.name) return;
        // Ignorer les natives pures
        if (lib.natives) return;
        const parts = lib.name.split(':');
        if (parts.length < 3) return;
        const [group, artifact, ver, classifier] = parts;
        const jarName = classifier
          ? artifact + '-' + ver + '-' + classifier + '.jar'
          : artifact + '-' + ver + '.jar';
        const jarPath = path.join(libDir, ...group.split('.'), artifact, ver, jarName);
        if (fs.existsSync(jarPath)) jars.push(jarPath);
      });
      return jars;
    };

    const cpJars = collectLibJars(vData.libraries);

    // Lire le JSON vanilla MC (peut être dans versions/1.20.1/ ou dans le JSON Forge via inheritsFrom)
    const mcVersionPaths = [
      path.join(ROOT, 'versions', instance.version, instance.version + '.json'),
      path.join(ROOT, 'versions', instance.version, instance.version + '-client.json'),
    ];
    // Aussi chercher via inheritsFrom dans le JSON Forge
    const inheritVersion = vData.inheritsFrom || instance.version;
    mcVersionPaths.push(path.join(ROOT, 'versions', inheritVersion, inheritVersion + '.json'));

    let mcJsonLoaded = false;
    for (const mcVersionJson of mcVersionPaths) {
      if (!fs.existsSync(mcVersionJson)) continue;
      try {
        const mcData = JSON.parse(fs.readFileSync(mcVersionJson, 'utf8'));
        const mcJars = collectLibJars(mcData.libraries);
        const seen = new Set(cpJars.map(j => path.basename(j)));
        mcJars.forEach(j => { if (!seen.has(path.basename(j))) { cpJars.push(j); seen.add(path.basename(j)); } });
        console.log('[FORGE] MC vanilla libs added:', mcJars.length, 'from', mcVersionJson);
        mcJsonLoaded = true;
        break;
      } catch (e2) { console.warn('[FORGE] MC vanilla JSON error:', e2.message); }
    }

    // Si le JSON vanilla n'est pas encore téléchargé, forcer les JARs log4j/slf4j directement
    if (!mcJsonLoaded) {
      console.log('[FORGE] JSON vanilla non trouvé — ajout forcé des JARs manquants');
      const forceLibs = [
        ['org/apache/logging/log4j/log4j-api',        '2.19.0'],
        ['org/apache/logging/log4j/log4j-core',       '2.19.0'],
        ['org/apache/logging/log4j/log4j-slf4j2-impl','2.19.0'],
        ['org/slf4j/slf4j-api',                        null],
        ['net/sf/jopt-simple/jopt-simple',             '5.0.4'],
        ['com/github/oshi/oshi-core',                  null],
        ['com/google/code/gson/gson',                  null],
        ['com/google/guava/guava',                     null],
        ['com/mojang/authlib',                         null],
        ['com/mojang/datafixerupper',                  null],
        ['com/mojang/logging',                         null],
        ['commons-io/commons-io',                      null],
        ['commons-logging/commons-logging',            null],
        ['io/netty/netty-common',                      null],
        ['io/netty/netty-buffer',                      null],
        ['io/netty/netty-codec',                       null],
        ['io/netty/netty-handler',                     null],
        ['io/netty/netty-transport',                   null],
        ['net/java/dev/jna/jna',                       null],
        ['net/java/dev/jna/jna-platform',              null],
        // LWJGL — bibliothèque graphique requise par Forge/MC
        ['org/lwjgl/lwjgl',                            null],
        ['org/lwjgl/lwjgl-glfw',                       null],
        ['org/lwjgl/lwjgl-opengl',                     null],
        ['org/lwjgl/lwjgl-stb',                        null],
        ['org/lwjgl/lwjgl-jemalloc',                   null],
        ['org/lwjgl/lwjgl-openal',                     null],
        ['org/lwjgl/lwjgl-tinyfd',                     null],
        ['org/joml/joml',                              null],
        ['com/mojang/blocklist',                       null],
        ['com/mojang/brigadier',                       null],
        ['com/mojang/patchy',                          null],
        ['com/mojang/text2speech',                     null],
        ['com/ibm/icu/icu4j',                          null],
        ['org/apache/commons/commons-lang3',           null],
        ['org/apache/commons/commons-compress',        null],
        ['org/apache/httpcomponents/httpclient',       null],
        ['org/apache/httpcomponents/httpcore',         null],
        ['commons-codec/commons-codec',                null],
      ];
      const seen = new Set(cpJars.map(j => path.basename(j)));
      for (const [artifactPath, forcedVer] of forceLibs) {
        const fullPath = path.join(libDir, ...artifactPath.split('/'));
        if (!fs.existsSync(fullPath)) continue;
        try {
          const versions = fs.readdirSync(fullPath)
            .filter(f => { try { return fs.statSync(path.join(fullPath, f)).isDirectory(); } catch { return false; } })
            .sort();
          if (!versions.length) continue;
          let ver;
          if (forcedVer && versions.includes(forcedVer)) {
            ver = forcedVer;
          } else {
            const stable = versions.filter(v => !/alpha|beta|rc/i.test(v));
            ver = stable.length ? stable[stable.length - 1] : versions[versions.length - 1];
          }
          const verDir = path.join(fullPath, ver);
          const files = fs.readdirSync(verDir).filter(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('javadoc'));
          if (files.length) {
            const jarPath = path.join(verDir, files[0]);
            if (!seen.has(path.basename(jarPath))) { cpJars.push(jarPath); seen.add(path.basename(jarPath)); }
          }
        } catch {}
      }
      console.log('[FORGE] CP après ajout forcé:', cpJars.length);
      } // fin if (!mcJsonLoaded)

    const forgeJar = path.join(ROOT, 'versions', customVersionId, customVersionId + '.jar');
    if (fs.existsSync(forgeJar)) cpJars.push(forgeJar);

    const assetsDir2 = path.join(ROOT, 'assets');
    const assetIndex = vData.assetIndex && vData.assetIndex.id ? vData.assetIndex.id : instance.version;
    const forgeVersion = customVersionId.split('-forge-')[1] || '47.4.10';
    let mcpVersion = '20230612.114412';
    try {
      const gameArgsList = vData.arguments && vData.arguments.game ? vData.arguments.game : [];
      const ix = gameArgsList.findIndex(function(a) { return a === '--fml.mcpVersion'; });
      if (ix >= 0) mcpVersion = gameArgsList[ix + 1];
    } catch (e2) {}

    const uuid    = (session.uuid || '').replace(/-/g, '');
    const mcToken = session.mcToken || (session.mclc && session.mclc.access_token) || 'null';

    const args = [
      '-Xmx' + (instance.ram || '4G'),
      '-Xms512M',
    ];

    // Ajouter EXACTEMENT les args JVM du JSON Forge
    // Ceci inclut: -p <module-path>, --add-modules ALL-MODULE-PATH,
    // --add-opens, --add-exports, -DignoreList, -DmergeModules, etc.
    args.push.apply(args, resolvedJvmArgs);

    // Args perf supplémentaires
    args.push('-XX:+UseG1GC');
    args.push('-XX:+ParallelRefProcEnabled');
    args.push('-XX:MaxGCPauseMillis=200');
    args.push('-XX:+UnlockExperimentalVMOptions');
    args.push('-XX:+DisableExplicitGC');
    args.push('-Dfml.ignoreInvalidMinecraftCertificates=true');
    args.push('-Dfml.ignorePatchDiscrepancies=true');
    args.push('-Djava.library.path=' + path.join(ROOT, 'natives', instance.version));

    // Classpath
    args.push('-cp', cpJars.join(sep));

    // Main class Forge
    args.push('cpw.mods.bootstraplauncher.BootstrapLauncher');

    // Args Forge
    args.push('--launchTarget',     'forgeclient');
    args.push('--fml.forgeVersion', forgeVersion);
    args.push('--fml.mcVersion',    instance.version);
    args.push('--fml.forgeGroup',   'net.minecraftforge');
    args.push('--fml.mcpVersion',   mcpVersion);

    // Args Minecraft
    args.push('--username',    session.username);
    args.push('--version',     instance.version);
    args.push('--gameDir',     gameDir);
    args.push('--assetsDir',   assetsDir2);
    args.push('--assetIndex',  assetIndex);
    args.push('--uuid',        uuid);
    args.push('--accessToken', mcToken);
    args.push('--clientId',    '');
    args.push('--xuid',        '');
    args.push('--userType',    'msa');
    args.push('--versionType', 'release');
    args.push('--width',       String(instance.windowWidth  || 1280));
    args.push('--height',      String(instance.windowHeight || 720));

    console.log('[FORGE] JVM args from JSON:', resolvedJvmArgs.length, '| CP jars:', cpJars.length);
    return args;
  } catch (e) {
    console.error('[FORGE] buildForgeArgs error:', e.message, e.stack);
    return null;
  }
}

function findLibJar(libDir, subPath) {
  const full = path.join(libDir, ...subPath.split('/'));
  if (!fs.existsSync(full)) return null;
  try {
    const versions = fs.readdirSync(full)
      .filter(f => fs.statSync(path.join(full, f)).isDirectory())
      .sort();
    if (!versions.length) return null;
    // Préférer une version stable (sans alpha/beta/rc) si disponible
    const stable = versions.filter(v => !v.includes('alpha') && !v.includes('beta') && !v.includes('rc'));
    const ver    = stable.length ? stable[stable.length - 1] : versions[versions.length - 1];
    const files  = fs.readdirSync(path.join(full, ver))
      .filter(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('javadoc'));
    return files.length ? path.join(full, ver, files[0]) : null;
  } catch { return null; }
}

function spawnMinecraft(javaPath, args, cwd, onLog, onClose) {
  onLog?.({ type: 'info', msg: '[MC] Démarrage...' });
  const proc = spawn(javaPath, args, { cwd, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', d => onLog?.({ type: 'log',   msg: String(d).trim() }));
  proc.stderr?.on('data', d => onLog?.({ type: 'log',   msg: String(d).trim() }));
  proc.on('close', code => onClose?.(code));
  proc.on('error', err  => onLog?.({ type: 'error', msg: err.message }));
}

// ══════════════════════════════════════════════════════════════════════════
// MCLC (Vanilla, Fabric, Quilt, Forge < 1.17)
// ══════════════════════════════════════════════════════════════════════════
async function launchViaMCLC({ instance, session, javaPath, customVersionId, gameDir, onProgress, onLog, onClose }) {
  const launcher = new Client();
  const authorization = session.mclc || {
    access_token: session.mcToken, client_token: session.uuid,
    uuid: session.uuid, name: session.username,
    user_properties: '{}', meta: { type: 'msa', demo: false },
  };
  const opts = {
    authorization, root: ROOT,
    version: { number: instance.version, type: instance.releaseType || 'release', custom: customVersionId || undefined },
    memory:  { max: instance.ram || '4G', min: '512M' },
    window:  { width: instance.windowWidth || 1280, height: instance.windowHeight || 720 },
    javaPath,
    customArgs: ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch'],
    overrides: {
      gameDirectory: gameDir,
      assetRoot: path.join(ROOT, 'assets'),
      libraryRoot: path.join(ROOT, 'libraries'),
      versionRoot: path.join(ROOT, 'versions'),
    },
  };
  launcher.on('debug',    msg => onLog?.({ type: 'debug', msg: String(msg) }));
  launcher.on('data',     msg => onLog?.({ type: 'log',   msg: String(msg) }));
  launcher.on('progress', e   => onProgress?.({ type: e.type, task: e.task, total: e.total, percent: e.total > 0 ? Math.round(e.task / e.total * 100) : 0 }));
  launcher.on('close',    code => onClose?.(code));
  try { await launcher.launch(opts); return { success: true }; }
  catch (err) { onLog?.({ type: 'error', msg: err.message }); return { success: false, error: err.message }; }
}

// ══════════════════════════════════════════════════════════════════════════
// INSTALL FORGE
// ══════════════════════════════════════════════════════════════════════════
async function installForge(mcVersion, javaPath, onLog, onProgress) {
  onLog?.({ type: 'info', msg: '[FORGE] Recherche de la version recommandée...' });
  const { data } = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  const forgeVer = data.promos[`${mcVersion}-recommended`] || data.promos[`${mcVersion}-latest`];
  if (!forgeVer) throw new Error(`Forge non disponible pour MC ${mcVersion}`);
  const fullVer = `${mcVersion}-${forgeVer}`, versionId = `${mcVersion}-forge-${forgeVer}`;
  const vDir = path.join(ROOT, 'versions', versionId);
  if (fs.existsSync(path.join(vDir, `${versionId}.json`))) { onLog?.({ type: 'info', msg: `[FORGE] Déjà installé : ${versionId}` }); return versionId; }
  const profilesPath = path.join(ROOT, 'launcher_profiles.json');
  if (!fs.existsSync(profilesPath)) {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(profilesPath, JSON.stringify({ profiles: { forge: { name: 'CraftLauncher', type: 'custom', lastVersionId: mcVersion } }, selectedProfile: 'forge', clientToken: require('crypto').randomUUID(), authenticationDatabase: {}, settings: {}, version: 3 }, null, 2));
  }
  onLog?.({ type: 'info', msg: `[FORGE] Téléchargement Forge ${fullVer}...` });
  const installerUrl  = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVer}/forge-${fullVer}-installer.jar`;
  const installerPath = path.join(ROOT, `forge-installer-${fullVer}.jar`);
  await downloadFile(installerUrl, installerPath, p => onProgress?.({ type: 'forge', task: p, total: 100, percent: Math.round(p * 0.5) }));
  onLog?.({ type: 'info', msg: '[FORGE] Installation (1-2 min)...' });
  const javaExe = javaPath.endsWith('javaw.exe') ? javaPath.replace('javaw.exe', 'java.exe') : javaPath;
  await new Promise((resolve, reject) => {
    exec(`"${javaExe}" -jar "${installerPath}" --installClient "${ROOT}"`, { timeout: 300000, cwd: ROOT }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message)); else resolve();
    });
  });
  try { fs.unlinkSync(installerPath); } catch {}
  onLog?.({ type: 'info', msg: '[FORGE] ✓ Installé' });
  onProgress?.({ type: 'forge', task: 1, total: 1, percent: 100 });
  return versionId;
}

// ══════════════════════════════════════════════════════════════════════════
// INSTALL FABRIC
// ══════════════════════════════════════════════════════════════════════════
async function installFabric(mcVersion, onLog, onProgress) {
  onLog?.({ type: 'info', msg: '[FABRIC] Récupération du loader...' });
  const { data: loaders } = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
  if (!loaders?.length) throw new Error(`Fabric non disponible pour MC ${mcVersion}`);
  const loaderVer = loaders[0].loader.version, versionId = `fabric-loader-${loaderVer}-${mcVersion}`;
  const vDir = path.join(ROOT, 'versions', versionId);
  if (fs.existsSync(path.join(vDir, `${versionId}.json`))) { onLog?.({ type: 'info', msg: '[FABRIC] Déjà installé' }); return versionId; }
  const { data: profile } = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVer}/profile/json`);
  fs.mkdirSync(vDir, { recursive: true });
  fs.writeFileSync(path.join(vDir, `${versionId}.json`), JSON.stringify(profile, null, 2));
  onLog?.({ type: 'info', msg: '[FABRIC] ✓ Installé' });
  return versionId;
}

// ══════════════════════════════════════════════════════════════════════════
// INSTALL QUILT
// ══════════════════════════════════════════════════════════════════════════
async function installQuilt(mcVersion, onLog, onProgress) {
  onLog?.({ type: 'info', msg: '[QUILT] Récupération du loader...' });
  const { data: loaders } = await axios.get(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`);
  if (!loaders?.length) throw new Error(`Quilt non disponible pour MC ${mcVersion}`);
  const loaderVer = loaders[0].loader.version, versionId = `quilt-loader-${loaderVer}-${mcVersion}`;
  const vDir = path.join(ROOT, 'versions', versionId);
  if (fs.existsSync(path.join(vDir, `${versionId}.json`))) { onLog?.({ type: 'info', msg: '[QUILT] Déjà installé' }); return versionId; }
  const { data: profile } = await axios.get(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}/${loaderVer}/profile/json`);
  fs.mkdirSync(vDir, { recursive: true });
  fs.writeFileSync(path.join(vDir, `${versionId}.json`), JSON.stringify(profile, null, 2));
  onLog?.({ type: 'info', msg: '[QUILT] ✓ Installé' });
  return versionId;
}

// ══════════════════════════════════════════════════════════════════════════
// JAVA
// ══════════════════════════════════════════════════════════════════════════
function getRequiredJavaVersion(mcVersion) {
  const minor = parseInt(mcVersion.split('.')[1]) || 0;
  const patch = parseInt(mcVersion.split('.')[2]) || 0;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}
function findJavaOnSystem(version) {
  const bundled = getBundledJavaPath(version); if (bundled) return bundled;
  for (const p of getMcLauncherJavaPaths()) { if (fs.existsSync(p)) return p; }
  for (const p of getSystemJavaPaths(version)) { if (fs.existsSync(p)) return p; }
  return findJavaViaWhere();
}
function getBundledJavaPath(version) {
  if (!fs.existsSync(JAVA_DIR)) return null;
  try {
    for (const d of fs.readdirSync(JAVA_DIR)) {
      if (d.includes(String(version))) {
        const exe = path.join(JAVA_DIR, d, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        if (fs.existsSync(exe)) { console.log(`[JAVA] Java ${version} déjà présent`); return exe; }
      }
    }
  } catch {}
  return null;
}
function getMcLauncherJavaPaths() {
  const rts = ['java-runtime-delta','java-runtime-gamma','java-runtime-beta','java-runtime-alpha'];
  const bases = ['C:\\Program Files (x86)\\Minecraft Launcher\\runtime','C:\\Program Files\\Minecraft Launcher\\runtime',process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Packages','Microsoft.4297127D64EC6_8wekyb3d8bbwe','LocalCache','Local','runtime'):''];
  const result = [];
  for (const base of bases) { if (!base) continue; for (const rt of rts) { result.push(path.join(base,rt,'windows-x64',rt,'bin','java.exe')); result.push(path.join(base,rt,'windows-x64',rt,'bin','javaw.exe')); } }
  return result;
}
function getSystemJavaPaths(version) {
  const bases = ['C:\\Program Files\\Java','C:\\Program Files\\Eclipse Adoptium','C:\\Program Files\\Microsoft','C:\\Program Files\\OpenJDK','C:\\Program Files (x86)\\Java'];
  const result = [];
  for (const base of bases) { try { if (!fs.existsSync(base)) continue; fs.readdirSync(base).filter(d=>d.includes(String(version))).forEach(d=>{result.push(path.join(base,d,'bin','java.exe'));result.push(path.join(base,d,'bin','javaw.exe'));}); } catch {} }
  return result;
}
function findJavaViaWhere() {
  for (const cmd of ['where java','where javaw']) { try { const r=execSync(cmd,{encoding:'utf8',timeout:3000}).trim(); const p=r.split('\n')[0].trim(); if(p&&fs.existsSync(p)) return p; } catch {} }
  return null;
}
async function downloadJava(version, onLog, onProgress) {
  const platform=process.platform==='win32'?'windows':process.platform==='darwin'?'mac':'linux';
  const arch=process.arch==='arm64'?'aarch64':'x64';
  onLog?.({type:'info',msg:`[JAVA] Téléchargement Java ${version} (${platform}-${arch})...`});
  const {data:releases}=await axios.get(`https://api.adoptium.net/v3/assets/latest/${version}/hotspot?architecture=${arch}&image_type=jre&os=${platform}&vendor=eclipse`);
  if (!releases?.length) throw new Error(`Java ${version} non disponible`);
  const binary=releases[0].binary, archivePath=path.join(JAVA_DIR,binary.package.name);
  fs.mkdirSync(JAVA_DIR,{recursive:true});
  onLog?.({type:'info',msg:`[JAVA] ${binary.package.name} (${Math.round(binary.package.size/1024/1024)} Mo)`});
  await downloadFile(binary.package.link,archivePath,p=>onProgress?.({type:'java-download',task:p,total:100,percent:Math.round(p*0.8)}));
  onLog?.({type:'info',msg:'[JAVA] Extraction...'});
  const zip=new AdmZip(archivePath), rootDir=zip.getEntries()[0]?.entryName.split('/')[0]||'';
  zip.extractAllTo(JAVA_DIR,true);
  try{fs.unlinkSync(archivePath);}catch{}
  const destDir=path.join(JAVA_DIR,rootDir);
  const javaExe=path.join(destDir,'bin',process.platform==='win32'?'java.exe':'java');
  if (!fs.existsSync(javaExe)) throw new Error(`Java extrait mais introuvable : ${javaExe}`);
  if (process.platform!=='win32'){try{fs.chmodSync(javaExe,0o755);}catch{}}
  onLog?.({type:'info',msg:`[JAVA] ✓ Java ${version} installé`});
  return javaExe;
}

// ══════════════════════════════════════════════════════════════════════════
// IMPORT MODPACK — supporte zip, mrpack ET dossier direct
// ══════════════════════════════════════════════════════════════════════════
async function importModpackFromFile(filePath, instanceName, store, onProgress, onLog, options = {}) {
  onLog?.({ type: 'info', msg: `[IMPORT] Lecture de ${path.basename(filePath)}...` });

  const instanceId = require('crypto').randomUUID();
  const destDir    = path.join(ROOT, 'instances', instanceId);
  fs.mkdirSync(destDir, { recursive: true });

  const zip     = new AdmZip(filePath);
  const entries = zip.getEntries();

  let mcVersion = '1.20.1';
  let modLoader = 'forge';
  let counts    = { mods: 0, resourcepacks: 0, shaderpacks: 0, configs: 0 };

  // ── Détecter le dossier racine dans le zip ─────────────────────────────
  // Certains zips ont un dossier racine (ex: "autre/mods/..."), d'autres non ("mods/...")
  let rootPrefix = '';
  const firstEntry = entries[0];
  if (firstEntry) {
    const parts = firstEntry.entryName.replace(/\\/g, '/').split('/');
    if (parts.length > 1 && entries.filter(e => e.entryName.startsWith(parts[0] + '/')).length > 3) {
      rootPrefix = parts[0] + '/';
    }
  }
  onLog?.({ type: 'info', msg: `[IMPORT] Dossier racine détecté : "${rootPrefix || '(racine)'}"` });

  // ── Lire le manifest CurseForge ────────────────────────────────────────
  const manifestEntry = entries.find(e =>
    e.entryName === 'manifest.json' ||
    e.entryName === rootPrefix + 'manifest.json'
  );
  if (manifestEntry) {
    try {
      const m = JSON.parse(manifestEntry.getData().toString('utf8'));
      mcVersion = m.minecraft?.version || mcVersion;
      const loaderId = m.minecraft?.modLoaders?.[0]?.id || '';
      modLoader = loaderId.split('-')[0] || modLoader;
      onLog?.({ type: 'info', msg: `[IMPORT] CurseForge manifest : MC ${mcVersion} ${modLoader}` });
    } catch (e) { console.warn('[IMPORT] manifest.json error:', e.message); }
  }

  // ── Lire modrinth.index.json ───────────────────────────────────────────
  const modrinthEntry = entries.find(e =>
    e.entryName === 'modrinth.index.json' ||
    e.entryName === rootPrefix + 'modrinth.index.json'
  );
  if (modrinthEntry) {
    try {
      const m = JSON.parse(modrinthEntry.getData().toString('utf8'));
      mcVersion = m.dependencies?.minecraft || mcVersion;
      if (m.dependencies?.forge)        modLoader = 'forge';
      else if (m.dependencies?.['neoforge']) modLoader = 'neoforge';
      else if (m.dependencies?.fabric)  modLoader = 'fabric';
      else if (m.dependencies?.quilt)   modLoader = 'quilt';
      onLog?.({ type: 'info', msg: `[IMPORT] Modrinth manifest : MC ${mcVersion} ${modLoader}` });
    } catch (e) { console.warn('[IMPORT] modrinth.index.json error:', e.message); }
  }

  // ── Lire minecraftinstance.json (CurseForge natif) ────────────────────
  const mcInstanceEntry = entries.find(e =>
    e.entryName === 'minecraftinstance.json' ||
    e.entryName === rootPrefix + 'minecraftinstance.json'
  );
  if (mcInstanceEntry) {
    try {
      const m = JSON.parse(mcInstanceEntry.getData().toString('utf8'));
      mcVersion = m.gameVersion || mcVersion;
      const baseModLoader = m.baseModLoader?.name || '';
      if (baseModLoader.toLowerCase().includes('forge')) modLoader = 'forge';
      else if (baseModLoader.toLowerCase().includes('fabric')) modLoader = 'fabric';
      onLog?.({ type: 'info', msg: `[IMPORT] minecraftinstance.json : MC ${mcVersion} ${modLoader}` });
    } catch (e) { console.warn('[IMPORT] minecraftinstance.json error:', e.message); }
  }

  // ── Extraire tous les fichiers vers les bons dossiers ──────────────────
  onProgress?.({ type: 'extract', task: 0, total: entries.length, percent: 0 });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.isDirectory) {
      onProgress?.({ type: 'extract', task: i+1, total: entries.length, percent: Math.round((i+1)/entries.length*100) });
      continue;
    }

    // Normaliser le chemin en retirant le préfixe racine
    let relPath = entry.entryName.replace(/\\/g, '/');
    if (rootPrefix && relPath.startsWith(rootPrefix)) {
      relPath = relPath.slice(rootPrefix.length);
    }

    if (!relPath) continue;

    // Ignorer les fichiers inutiles
    if (relPath.startsWith('logs/') || relPath.startsWith('.git') || relPath === '.curseclient') {
      onProgress?.({ type: 'extract', task: i+1, total: entries.length, percent: Math.round((i+1)/entries.length*100) });
      continue;
    }

    const destFile = path.join(destDir, relPath);
    const destDirF = path.dirname(destFile);

    try {
      fs.mkdirSync(destDirF, { recursive: true });
      fs.writeFileSync(destFile, entry.getData());

      // Compter par type
      if (relPath.startsWith('mods/') && relPath.endsWith('.jar')) counts.mods++;
      else if (relPath.startsWith('resourcepacks/')) counts.resourcepacks++;
      else if (relPath.startsWith('shaderpacks/')) counts.shaderpacks++;
      else if (relPath.startsWith('config/')) counts.configs++;
    } catch (e) {
      console.warn('[IMPORT] Erreur extraction', relPath, e.message);
    }

    onProgress?.({ type: 'extract', task: i+1, total: entries.length, percent: Math.round((i+1)/entries.length*100) });
  }

  onLog?.({ type: 'info', msg: `[IMPORT] ✓ Extrait : ${counts.mods} mods, ${counts.resourcepacks} resource packs, ${counts.shaderpacks} shaders, ${counts.configs} configs` });

  const { createInstance } = require('../instances/manager');
  const instance = createInstance(store, {
    id:          instanceId,
    name:        instanceName,
    version:     mcVersion,
    modLoader,
    releaseType: 'release',
    ram:         '6G',
    icon:        '📦',
    modsPath:    path.join(destDir, 'mods'),
    importedFrom: path.basename(filePath),
    publishedByAdmin: Boolean(options.publish),
  });

  onLog?.({ type: 'info', msg: `[IMPORT] ✓ Instance "${instanceName}" créée — ${mcVersion} ${modLoader}` });
  return instance;
}

// ── Télécharger les mods CurseForge via leur API ───────────────────────────
async function downloadCurseForgeFiles(files, modsDir, onLog, onProgress) {
  const CFKEY = '$2a$10$p1xE6iLf/K2oFbbIgybBCeYkCuxmC4IKkg5vPTf3wn2IxE2qxBsq2';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      // Récupérer l'URL de téléchargement via l'API CurseForge
      const res = await axios.get(
        `https://api.curseforge.com/v1/mods/${file.projectID}/files/${file.fileID}`,
        { headers: { 'x-api-key': CFKEY } }
      );
      const dlUrl   = res.data?.data?.downloadUrl;
      const fileName = res.data?.data?.fileName;

      if (!dlUrl) {
        onLog?.({ type: 'info', msg: `[IMPORT] Mod ${file.projectID} — URL indisponible, skip` });
        continue;
      }

      const destPath = path.join(modsDir, fileName);
      onLog?.({ type: 'info', msg: `[IMPORT] (${i+1}/${files.length}) ${fileName}` });
      await downloadFile(dlUrl, destPath);
      onProgress?.({ type: 'mods-download', task: i+1, total: files.length, percent: Math.round((i+1)/files.length*100) });
    } catch (e) {
      onLog?.({ type: 'info', msg: `[IMPORT] Mod ${file.projectID}/${file.fileID} — erreur: ${e.message}` });
    }
  }
}
// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════
async function downloadFile(url, dest, onProgress) {
  const writer=fs.createWriteStream(dest);
  const {data,headers}=await axios.get(url,{responseType:'stream'});
  const total=parseInt(headers['content-length']||'0'); let downloaded=0;
  return new Promise((resolve,reject)=>{
    data.on('data',chunk=>{downloaded+=chunk.length;if(total>0&&onProgress)onProgress(Math.round(downloaded/total*100));});
    data.pipe(writer); writer.on('finish',resolve); writer.on('error',reject);
  });
}

module.exports = { launchMinecraft, importModpackFromFile };
