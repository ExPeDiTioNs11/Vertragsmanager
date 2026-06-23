const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');
const db = require('./database');
const sync = require('./sync');
const logic = require('./logic');
const { FIELDS, GROUPS, FIRMA_FIELD, YEAR_FIELD, STATUS_FIELD, STATUSES, DEFAULT_STATUS, BRAND_ALIASES } = require('./fields');
const { parseWorkbook } = require('./excelParser');

const extractYearFromName = logic.extractYearFromName;

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

let mainWindow;
let tray;
let isQuitting = false; // gerçek çıkış mı, yoksa tepsiye mi inecek

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    show: false, // hazır olunca maximize edip göstereceğiz (titreme olmasın)
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();

  // Açılışta tam ekran (maximized) — pencere kontrolleri durur, alta alınabilir
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Pencere kapatıldığında (X) uygulamayı kapatma; arka planda çalışsın, tepsiye in
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  let img = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Handy Island Vertragsmanager');

  const menu = Menu.buildFromTemplate([
    { label: 'Anzeigen', click: showWindow },
    { type: 'separator' },
    { label: 'Beenden', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  // Tek tıkla pencereyi göster
  tray.on('click', showWindow);
}

// ---- IPC: alan tanımları ----
ipcMain.handle('fields:get', () => ({ fields: FIELDS, groups: GROUPS, firma: FIRMA_FIELD, year: YEAR_FIELD, status: STATUS_FIELD, statuses: STATUSES, defaultStatus: DEFAULT_STATUS, brandAliases: BRAND_ALIASES }));

// ---- IPC: ayarlar ----
ipcMain.handle('settings:get', () => db.getSettings());
ipcMain.handle('settings:set', (_e, obj) => {
  const s = db.setSettings(obj);
  manageBackupTimer(); // ayar değişince yedek zamanlayıcısını güncelle
  return s;
});

// ---- IPC: hatırlatma bildirimi (renderer hesaplar, ana süreç gösterir) ----
ipcMain.handle('reminder:notify', (_e, count) => {
  if (!count || !Notification.isSupported()) return false;
  const n = new Notification({
    title: 'Vertragserinnerung',
    body:
      count === 1
        ? '1 Vertrag läuft bald ab. Zum Anzeigen klicken.'
        : `${count} Verträge laufen bald ab. Zum Anzeigen klicken.`,
    icon: ICON_PATH,
  });
  n.on('click', () => {
    showWindow();
    if (mainWindow) mainWindow.webContents.send('reminder:show');
  });
  n.show();
  return true;
});

// ---- IPC: CRUD ----
ipcMain.handle('vertraege:get', () => db.getAll());
ipcMain.handle('vertraege:companies', () => db.getCompanies());
// Yerel değişikliği ağa yayınla
function broadcastRows(rows) {
  const arr = Array.isArray(rows) ? rows : [rows];
  sync.broadcast(arr.filter(Boolean));
}

// Senkronizasyonu başlat (P2P mesh)
function startSync() {
  sync.start({
    getSnapshot: () => db.getAllForSync(),
    applyRemote: (records) => db.mergeFromSync(records),
    onApplied: (summary) => {
      // Uzaktan değişiklik geldi: arayüzü tazele + bildir
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('data:changed', summary);
      }
      if (summary.newVisible > 0 && Notification.isSupported()) {
        const n = new Notification({
          title: 'Synchronisiert',
          body:
            summary.newVisible === 1
              ? 'Ein neuer Eintrag von einem anderen PC.'
              : `${summary.newVisible} neue Einträge von einem anderen PC.`,
          icon: ICON_PATH,
          silent: true,
        });
        n.on('click', showWindow);
        n.show();
      }
    },
    onPeersChanged: (count) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:peers', count);
      }
    },
    log: (m) => console.log(m),
  });
}

ipcMain.handle('vertraege:add', (_e, record) => {
  const row = db.add(record);
  broadcastRows(row);
  return row;
});
ipcMain.handle('vertraege:update', (_e, id, record) => {
  const row = db.update(id, record);
  broadcastRows(row);
  return row;
});
ipcMain.handle('vertraege:delete', (_e, id) => {
  const row = db.remove(id); // tombstone
  broadcastRows(row);
  return true;
});
ipcMain.handle('vertraege:status', (_e, id, status) => {
  const row = db.updateStatus(id, status);
  broadcastRows(row);
  return row;
});
ipcMain.handle('vertraege:clear', () => db.clearAll()); // yalnızca yerel
ipcMain.handle('sync:peers', () => sync.peerCount());

// ---- Güvenlik: şifre kilidi ----
function hashPw(pw, salt) {
  return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
}
ipcMain.handle('auth:status', () => ({ enabled: !!db.getSettingRaw('passwordHash') }));
ipcMain.handle('auth:check', (_e, pw) => {
  const hash = db.getSettingRaw('passwordHash');
  const salt = db.getSettingRaw('passwordSalt') || '';
  if (!hash) return { ok: true }; // şifre yok
  return { ok: hashPw(pw || '', salt) === hash };
});
ipcMain.handle('auth:set', (_e, oldPw, newPw) => {
  const hash = db.getSettingRaw('passwordHash');
  const salt = db.getSettingRaw('passwordSalt') || '';
  if (hash) {
    if (hashPw(oldPw || '', salt) !== hash) return { ok: false, reason: 'wrong-old' };
  }
  if (!newPw) {
    // şifreyi kaldır
    db.setSettingRaw('passwordHash', null);
    db.setSettingRaw('passwordSalt', null);
    return { ok: true, enabled: false };
  }
  const newSalt = crypto.randomBytes(8).toString('hex');
  db.setSettingRaw('passwordSalt', newSalt);
  db.setSettingRaw('passwordHash', hashPw(newPw, newSalt));
  return { ok: true, enabled: true };
});

// ---- Yedekleme ----
function backupDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function autoBackup() {
  try {
    const dir = backupDir();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const file = path.join(dir, `app-${today}.db`);
    if (!fs.existsSync(file)) db.backupTo(file);
    // Son 14 yedeği tut
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
    while (files.length > 14) {
      try { fs.unlinkSync(path.join(dir, files.shift())); } catch {}
    }
  } catch (e) { console.log('autoBackup hata: ' + e.message); }
}

// Otomatik yedek zamanlayıcısını ayara göre başlat/durdur
let backupTimer = null;
function manageBackupTimer() {
  const enabled = db.getSettings().autoBackup;
  if (enabled && !backupTimer) {
    autoBackup(); // hemen bir yedek
    backupTimer = setInterval(autoBackup, 24 * 60 * 60 * 1000); // 24 saatte bir
  } else if (!enabled && backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}
ipcMain.handle('backup:now', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Backup speichern',
    defaultPath: `vertraege-backup-${today}.db`,
    filters: [{ name: 'SQLite-Datenbank', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  db.backupTo(filePath);
  return { canceled: false, file: path.basename(filePath) };
});

// wa.me ile WhatsApp sohbetini hazır metinle aç
ipcMain.handle('wa:open', (_e, phone, text) => {
  const num = logic.toWhatsAppNumber(phone);
  if (!num) return { ok: false, reason: 'no-number' };
  const url = `https://wa.me/${num}?text=${encodeURIComponent(text || '')}`;
  shell.openExternal(url);
  return { ok: true, number: num };
});

const sleep0 = () => new Promise((r) => setImmediate(r)); // event-loop'u serbest bırak

// ---- IPC: Excel içeri aktar (bölümlü / firma firma, dosya adından yıl, ilerlemeli) ----
ipcMain.handle('excel:import', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Excel-Datei wählen (Mehrfachauswahl möglich)',
    filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths.length) return { canceled: true };

  const send = (percent, label) =>
    event.sender.send('import:progress', { percent: Math.max(0, Math.min(100, percent)), label });

  const allRecords = [];
  const unmatchedSet = new Set();
  const perFirma = {};
  const perYear = {};
  const noYearFiles = [];

  // 1) Okuma/ayrıştırma aşaması (0 -> %20)
  send(0, 'Dateien werden gelesen...');
  for (let fi = 0; fi < filePaths.length; fi++) {
    const fp = filePaths[fi];
    const base = path.basename(fp);
    const jahr = extractYearFromName(base);
    if (!jahr) noYearFiles.push(base);

    send(Math.round((fi / filePaths.length) * 20), `Lesen: ${base} (${fi + 1}/${filePaths.length})`);
    await sleep0();

    const wb = XLSX.readFile(fp, { cellDates: true });
    const { records, unmatched } = parseWorkbook(wb);
    unmatched.forEach((u) => unmatchedSet.add(u));

    for (const r of records) {
      r.jahr = jahr;
      if (!r.status) r.status = DEFAULT_STATUS; // içe aktarılanlar: "henüz aranmadı"
      if (r.iban) r.iban = logic.last4(r.iban); // IBAN'ı son 4 haneye indir
      allRecords.push(r);
      const f = r.firma || '(kein Anbieter)';
      perFirma[f] = (perFirma[f] || 0) + 1;
      const y = jahr || '(kein Jahr)';
      perYear[y] = (perYear[y] || 0) + 1;
    }
    await sleep0();
  }

  // 2) Yazma aşaması — parçalı (chunk) ekleme + ağa yayın, %20 -> %100
  const total = allRecords.length;
  const CHUNK = 500;
  let done = 0;
  send(20, `${total} Einträge werden geschrieben...`);
  for (let i = 0; i < total; i += CHUNK) {
    const inserted = db.bulkInsert(allRecords.slice(i, i + CHUNK));
    broadcastRows(inserted); // diğer bilgisayarlara da yayılsın
    done = Math.min(total, i + CHUNK);
    send(20 + Math.round((done / total) * 80), `${done} / ${total} Einträge geschrieben`);
    await sleep0(); // arayüz donmasın, bar akıcı güncellensin
  }
  send(100, 'Fertig');

  return {
    canceled: false,
    imported: total,
    fileCount: filePaths.length,
    perFirma,
    perYear,
    noYearFiles,
    unmatched: [...unmatchedSet],
  };
});

// Excel sayfa adı kısıtları: en fazla 31 karakter, : \ / ? * [ ] yasak
function safeSheetName(name, used) {
  let s = (name || 'Firma').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Firma';
  let base = s;
  let i = 2;
  while (used.has(s.toLowerCase())) {
    const suffix = ` (${i++})`;
    s = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(s.toLowerCase());
  return s;
}

// ---- IPC: Excel dışarı aktar (her firma AYRI sayfa, içeri aktarımla aynı düzen) ----
ipcMain.handle('excel:export', async () => {
  const records = db.getAll();

  // Firmaya göre grupla
  const groups = new Map();
  for (const r of records) {
    const f = (r.firma || '').trim() || '(kein Anbieter)';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(r);
  }

  const headers = FIELDS.map((f) => f.header);
  const wb = XLSX.utils.book_new();
  const used = new Set();

  if (groups.size === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'Firma');
  } else {
    for (const [firma, rows] of groups) {
      const aoa = [headers, ...rows.map((r) => FIELDS.map((f) => r[f.key] ?? ''))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(firma, used));
    }
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Als Excel speichern',
    defaultPath: 'vertraege.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  XLSX.writeFile(wb, filePath);
  return { canceled: false, count: records.length, file: path.basename(filePath) };
});

// ---- IPC: boş şablon (her firma ayrı sayfa) ----
ipcMain.handle('excel:template', async () => {
  const headers = FIELDS.map((f) => f.header);
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const firma of ['Vodafone', 'O2', 'Ayyıldız']) {
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(firma, used));
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Vorlage speichern',
    defaultPath: 'vorlage.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  XLSX.writeFile(wb, filePath);
  return { canceled: false, file: path.basename(filePath) };
});

// Tek örnek kilidi: ikinci kez açılırsa yeni pencere açmak yerine mevcut olanı göster
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.handyisland.vertragsmanager'); // Windows bildirimleri için
    Menu.setApplicationMenu(null); // üst menü çubuğunu (File/Edit/View...) kaldır
    db.initDatabase();
    manageBackupTimer(); // ayar açıksa: başlangıçta + 24 saatte bir otomatik yedek
    createWindow();
    createTray();
    startSync();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

// Gerçek çıkışta bayrağı işaretle (pencere 'close' engelini kaldırır)
app.on('before-quit', () => {
  isQuitting = true;
});

// Pencere kapansa bile uygulama arka planda (tepside) çalışmaya devam etsin.
// Bu yüzden window-all-closed'da uygulamayı KAPATMIYORUZ.
// (Çıkış yalnızca tepsi menüsündeki "Çıkış" ile yapılır.)
app.on('window-all-closed', () => {
  // bilerek boş — tray uygulaması arka planda kalır
});
