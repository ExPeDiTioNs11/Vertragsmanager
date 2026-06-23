// Preload - arayüz ile ana süreç arasında güvenli köprü
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});

contextBridge.exposeInMainWorld('api', {
  // alan tanımları
  getFields: () => ipcRenderer.invoke('fields:get'),
  // CRUD
  getAll: () => ipcRenderer.invoke('vertraege:get'),
  getCompanies: () => ipcRenderer.invoke('vertraege:companies'),
  add: (record) => ipcRenderer.invoke('vertraege:add', record),
  update: (id, record) => ipcRenderer.invoke('vertraege:update', id, record),
  remove: (id) => ipcRenderer.invoke('vertraege:delete', id),
  updateStatus: (id, status) => ipcRenderer.invoke('vertraege:status', id, status),
  clearAll: () => ipcRenderer.invoke('vertraege:clear'),
  openWhatsApp: (phone, text) => ipcRenderer.invoke('wa:open', phone, text),
  // Excel
  importExcel: () => ipcRenderer.invoke('excel:import'),
  onImportProgress: (cb) => ipcRenderer.on('import:progress', cb),
  exportExcel: () => ipcRenderer.invoke('excel:export'),
  downloadTemplate: () => ipcRenderer.invoke('excel:template'),
  // Ayarlar
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (obj) => ipcRenderer.invoke('settings:set', obj),
  // Hatırlatma
  notifyReminders: (count) => ipcRenderer.invoke('reminder:notify', count),
  onShowReminders: (cb) => ipcRenderer.on('reminder:show', cb),
  // Güvenlik
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authCheck: (pw) => ipcRenderer.invoke('auth:check', pw),
  authSet: (oldPw, newPw) => ipcRenderer.invoke('auth:set', oldPw, newPw),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  // Senkronizasyon
  getPeerCount: () => ipcRenderer.invoke('sync:peers'),
  onDataChanged: (cb) => ipcRenderer.on('data:changed', (_e, summary) => cb(summary)),
  onPeersChanged: (cb) => ipcRenderer.on('sync:peers', (_e, count) => cb(count)),
});
