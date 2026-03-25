const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getSession: () => ipcRenderer.invoke('auth:getSession'),
  },
  instances: {
    list: () => ipcRenderer.invoke('instances:list'),
    create: data => ipcRenderer.invoke('instances:create', data),
    delete: id => ipcRenderer.invoke('instances:delete', id),
    update: (id, data) => ipcRenderer.invoke('instances:update', id, data),
  },
  mc: {
    launch: id => ipcRenderer.invoke('mc:launch', id),
    versions: () => ipcRenderer.invoke('mc:versions'),
    onProgress: cb => ipcRenderer.on('mc:progress', (_, data) => cb(data)),
    onLog: cb => ipcRenderer.on('mc:log', (_, log) => cb(log)),
    onClose: cb => ipcRenderer.on('mc:closed', (_, code) => cb(code)),
  },
  modpack: {
    import: payload => ipcRenderer.invoke('modpack:import', payload),
  },
  content: {
    importLocal: (instanceId, type) => ipcRenderer.invoke('content:import-local', instanceId, type),
    installModrinth: (instanceId, projectId, type) => ipcRenderer.invoke('content:install-modrinth', instanceId, projectId, type),
  },
  shared: {
    status: () => ipcRenderer.invoke('shared:status'),
    listPublished: () => ipcRenderer.invoke('shared:list-published'),
    removePublished: instanceId => ipcRenderer.invoke('shared:remove-published', instanceId),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onAvailable: cb => ipcRenderer.on('update:available', (_, data) => cb(data)),
    onProgress: cb => ipcRenderer.on('update:progress', (_, data) => cb(data)),
    onDownloaded: cb => ipcRenderer.on('update:downloaded', () => cb()),
    onError: cb => ipcRenderer.on('update:error', (_, error) => cb(error)),
  },
});
