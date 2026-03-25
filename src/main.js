const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const Store = require('electron-store');

const { login, logout, refreshSession } = require('./auth/microsoft-auth');
const { launchMinecraft, importModpackFromFile } = require('./core/launcher');
const { getInstances, createInstance, deleteInstance, updateInstance } = require('./instances/manager');
const {
  getMinecraftVersionGroups,
  getContentTargetDir,
  copyFilesToTarget,
  installFromModrinth,
} = require('./services/content-service');
const {
  isConfigured: isSupabaseConfigured,
  enrichSessionWithRemoteAdmin,
  publishInstance,
  removePublishedInstance,
  listPublishedInstances,
} = require('./services/supabase-sync');

const store = new Store({ encryptionKey: 'craftlauncher-secret-key' });
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#080b0f',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

function setupAutoUpdater() {
  if (process.argv.includes('--dev')) return;

  try {
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-available', info => mainWindow.webContents.send('update:available', { version: info.version }));
    autoUpdater.on('download-progress', progress => mainWindow.webContents.send('update:progress', { percent: Math.round(progress.percent) }));
    autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('update:downloaded'));
    autoUpdater.on('error', error => console.error('AutoUpdater error:', error.message));
  } catch (error) {
    console.warn('AutoUpdater non disponible en dev:', error.message);
  }
}

function getInstanceOrThrow(instanceId) {
  const instance = getInstances(store).find(item => item.id === instanceId);
  if (!instance) throw new Error('Instance introuvable');
  return instance;
}

function getDialogFiltersForType(type) {
  if (type === 'mod') {
    return [{ name: 'Mods', extensions: ['jar', 'zip'] }];
  }

  if (type === 'shader') {
    return [{ name: 'Shaders', extensions: ['zip'] }];
  }

  if (type === 'resourcepack') {
    return [{ name: 'Resource Packs', extensions: ['zip'] }];
  }

  throw new Error(`Type de contenu non supporte : ${type}`);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
ipcMain.on('window:close', () => mainWindow.close());

ipcMain.handle('auth:login', async () => {
  try {
    const session = await enrichSessionWithRemoteAdmin(await login(mainWindow, store));
    store.set('auth.session', session);
    return { success: true, session };
  } catch (error) {
    console.error('AUTH ERROR:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  await logout(store);
  return { success: true };
});

ipcMain.handle('auth:getSession', async () => {
  try {
    const saved = store.get('auth.session');
    if (!saved) return { success: false };

    refreshSession(store)
      .then(fresh => {
        if (fresh) store.set('auth.session', fresh);
      })
      .catch(() => {});

    const enriched = await enrichSessionWithRemoteAdmin(saved);
    if (enriched) store.set('auth.session', enriched);
    return { success: true, session: enriched };
  } catch {
    return { success: false };
  }
});

ipcMain.handle('instances:list', async () => getInstances(store));
ipcMain.handle('instances:create', async (_, data) => createInstance(store, data));
ipcMain.handle('instances:delete', async (_, id) => deleteInstance(store, id));
ipcMain.handle('instances:update', async (_, id, data) => updateInstance(store, id, data));

ipcMain.handle('mc:versions', async () => {
  try {
    return { success: true, data: await getMinecraftVersionGroups() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('shared:status', async () => ({
  success: true,
  configured: isSupabaseConfigured(),
}));

ipcMain.handle('shared:list-published', async () => {
  try {
    return { success: true, items: await listPublishedInstances() };
  } catch (error) {
    return { success: false, error: error.message, items: [] };
  }
});

ipcMain.handle('mc:launch', async (_, instanceId) => {
  const session = store.get('auth.session');
  if (!session) return { success: false, error: 'Non connecte - veuillez vous reconnecter' };

  const instance = getInstances(store).find(item => item.id === instanceId);
  if (!instance) return { success: false, error: 'Instance introuvable' };

  console.log(`\n=== LANCEMENT MC ===`);
  console.log(`Joueur  : ${session.username} (${session.uuid})`);
  console.log(`Instance: ${instance.name} - ${instance.modLoader || 'vanilla'} ${instance.version}`);
  console.log(`RAM     : ${instance.ram || '4G'}`);
  console.log(`====================\n`);

  return launchMinecraft({
    instance,
    session,
    onProgress: data => mainWindow.webContents.send('mc:progress', data),
    onLog: log => {
      if (log.type === 'error') console.error(`[MC ERROR] ${log.msg}`);
      else console.log(`[MC ${log.type || 'log'}] ${log.msg}`);
      mainWindow.webContents.send('mc:log', log);
    },
    onClose: code => {
      console.log(`\n[MC] Ferme avec code ${code}`);
      mainWindow.webContents.send('mc:closed', code);
    },
  });
});

ipcMain.handle('modpack:import', async (_, payload) => {
  const options = typeof payload === 'string' || payload == null
    ? { name: payload || null, publish: false }
    : payload;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selectionnez un modpack',
    filters: [{ name: 'Modpacks', extensions: ['zip', 'mrpack'] }],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths.length) {
    return { success: false, error: 'Annule' };
  }

  const filePath = result.filePaths[0];

  try {
    const instance = await importModpackFromFile(
      filePath,
      options.name || path.basename(filePath, path.extname(filePath)),
      store,
      data => mainWindow.webContents.send('mc:progress', data),
      log => {
        console.log(`[IMPORT] ${log.msg}`);
        mainWindow.webContents.send('mc:log', log);
      },
      { publish: Boolean(options.publish) },
    );

    if (options.publish) {
      try {
        await publishInstance(instance, store.get('auth.session'));
      } catch (error) {
        return { success: false, error: `Import local OK mais publication distante impossible: ${error.message}` };
      }
    }

    return { success: true, instance };
  } catch (error) {
    console.error('IMPORT ERROR:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('content:import-local', async (_, instanceId, type) => {
  try {
    const instance = getInstanceOrThrow(instanceId);
    const dialogResult = await dialog.showOpenDialog(mainWindow, {
      title: `Importer ${type}`,
      filters: getDialogFiltersForType(type),
      properties: ['openFile', 'multiSelections'],
    });

    if (dialogResult.canceled || !dialogResult.filePaths.length) {
      return { success: false, error: 'Annule' };
    }

    const targetDir = getContentTargetDir(instance, type);
    const copied = copyFilesToTarget(dialogResult.filePaths, targetDir, type);

    if (!copied.length) {
      return { success: false, error: 'Aucun fichier compatible selectionne' };
    }

    return { success: true, copied, targetDir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('content:install-modrinth', async (_, instanceId, projectId, type) => {
  try {
    const instance = getInstanceOrThrow(instanceId);
    const result = await installFromModrinth(instance, projectId, type);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('shared:remove-published', async (_, instanceId) => {
  try {
    return { success: await removePublishedInstance(instanceId) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update:check', () => {
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch {}
});

ipcMain.handle('update:install', () => {
  try {
    autoUpdater.quitAndInstall();
  } catch {}
});
