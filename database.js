// Veritabanı modülü (ana süreçte çalışır)
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { ALL_KEYS } = require('./fields');

let db;

// Senkron için ek meta kolonlar
const SYNC_COLS = ['uid', 'updated_at', 'deleted'];
const INSERT_COLS = [...ALL_KEYS, ...SYNC_COLS];

// Veritabanını başlat. Dosya kullanıcının uygulama verisi klasörüne yazılır.
function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'app.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const colDefs = ALL_KEYS.map((k) => `"${k}" TEXT`).join(',\n      ');
  db.exec(`
    CREATE TABLE IF NOT EXISTS vertraege (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${colDefs},
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Migration: eksik veri kolonlarını ekle
  const existing = new Set(
    db.prepare('PRAGMA table_info(vertraege)').all().map((c) => c.name)
  );
  for (const k of ALL_KEYS) {
    if (!existing.has(k)) db.exec(`ALTER TABLE vertraege ADD COLUMN "${k}" TEXT`);
  }
  // Senkron kolonları
  if (!existing.has('uid')) db.exec(`ALTER TABLE vertraege ADD COLUMN uid TEXT`);
  if (!existing.has('updated_at')) db.exec(`ALTER TABLE vertraege ADD COLUMN updated_at INTEGER`);
  if (!existing.has('deleted')) db.exec(`ALTER TABLE vertraege ADD COLUMN deleted INTEGER DEFAULT 0`);

  // Eski kayıtlara uid/updated_at ata
  const now = Date.now();
  const missing = db.prepare(`SELECT id FROM vertraege WHERE uid IS NULL OR uid = ''`).all();
  if (missing.length) {
    const setUid = db.prepare(
      `UPDATE vertraege SET uid = ?, updated_at = COALESCE(updated_at, ?), deleted = COALESCE(deleted, 0) WHERE id = ?`
    );
    db.transaction((rows) => {
      for (const r of rows) setUid.run(crypto.randomUUID(), now, r.id);
    })(missing);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vertraege_uid ON vertraege(uid)`);

  // Ayarlar tablosu (anahtar-değer)
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

  return db;
}

// ---- Ayarlar ----
const DEFAULT_SETTINGS = {
  reminderDays: 90,
  notifyOnStartup: true,
  firmaReminderDays: { vodafone: 30 },
};

const SECRET_KEYS = new Set(['passwordHash', 'passwordSalt']); // renderer'a sızdırma

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS, firmaReminderDays: { ...DEFAULT_SETTINGS.firmaReminderDays } };
  for (const r of rows) {
    if (SECRET_KEYS.has(r.key)) continue;
    if (r.key === 'reminderDays') out.reminderDays = parseInt(r.value, 10) || DEFAULT_SETTINGS.reminderDays;
    else if (r.key === 'notifyOnStartup') out.notifyOnStartup = r.value === 'true';
    else if (r.key === 'firmaReminderDays') {
      try { out.firmaReminderDays = JSON.parse(r.value) || {}; } catch { /* varsayılanı koru */ }
    } else out[r.key] = r.value;
  }
  return out;
}

// Ham ayar erişimi (şifre hash'i gibi gizli değerler için)
function getSettingRaw(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSettingRaw(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, String(value));
  }
}

// Veritabanının temiz bir kopyasını al (açıkken güvenli)
function backupTo(filePath) {
  db.exec(`VACUUM INTO '${String(filePath).replace(/'/g, "''")}'`);
  return filePath;
}

function setSettings(obj) {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  db.transaction((entries) => {
    for (const [k, v] of entries) {
      const val = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
      stmt.run(k, val);
    }
  })(Object.entries(obj));
  return getSettings();
}

// ---- Kayıtlar ----
// Görünür kayıtlar (silinmemiş)
function getAll() {
  return db
    .prepare(`SELECT * FROM vertraege WHERE COALESCE(deleted,0) = 0 ORDER BY firma COLLATE NOCASE ASC, id DESC`)
    .all();
}

function getCompanies() {
  return db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(firma), ''), '(kein Anbieter)') AS firma, COUNT(*) AS adet
       FROM vertraege WHERE COALESCE(deleted,0) = 0 GROUP BY firma ORDER BY firma COLLATE NOCASE ASC`
    )
    .all();
}

const byId = (id) => db.prepare('SELECT * FROM vertraege WHERE id = ?').get(id);
const getByUid = (uid) => db.prepare('SELECT * FROM vertraege WHERE uid = ?').get(uid);

// Tek bir kaydı INSERT et (uid/updated_at/deleted dahil)
function insertRow(record, uid, updatedAt, deleted) {
  const placeholders = INSERT_COLS.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO vertraege (${INSERT_COLS.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
  );
  const vals = INSERT_COLS.map((c) => {
    if (c === 'uid') return uid;
    if (c === 'updated_at') return updatedAt;
    if (c === 'deleted') return deleted;
    return record[c] ?? null;
  });
  const info = stmt.run(...vals);
  return byId(info.lastInsertRowid);
}

// Yeni kayıt ekle (yerel)
function add(record) {
  return insertRow(record, crypto.randomUUID(), Date.now(), 0);
}

// Mevcut kaydı güncelle (yerel)
function update(id, record) {
  const setClause = ALL_KEYS.map((c) => `"${c}" = ?`).join(', ');
  db.prepare(`UPDATE vertraege SET ${setClause}, updated_at = ? WHERE id = ?`).run(
    ...ALL_KEYS.map((c) => record[c] ?? null),
    Date.now(),
    id
  );
  return byId(id);
}

// Sadece durum güncelle
function updateStatus(id, status) {
  db.prepare('UPDATE vertraege SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  return byId(id);
}

// Kayıt sil -> tombstone (deleted=1), senkronla yayılsın diye
function remove(id) {
  db.prepare('UPDATE vertraege SET deleted = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  return byId(id);
}

// TÜM kayıtları kalıcı sil (yalnızca yerel; ağa yayılmaz)
function clearAll() {
  const info = db.prepare('DELETE FROM vertraege').run();
  return info.changes;
}

// Toplu ekle (Excel). Eklenen satırları (uid'li) döndürür.
function bulkInsert(records) {
  const placeholders = INSERT_COLS.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO vertraege (${INSERT_COLS.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
  );
  const now = Date.now();
  const inserted = [];
  db.transaction((rows) => {
    for (const r of rows) {
      const uid = crypto.randomUUID();
      const vals = INSERT_COLS.map((c) => {
        if (c === 'uid') return uid;
        if (c === 'updated_at') return now;
        if (c === 'deleted') return 0;
        return r[c] ?? null;
      });
      const info = stmt.run(...vals);
      inserted.push(byId(info.lastInsertRowid));
    }
  })(records);
  return inserted;
}

// ---- Senkron ----
// Tüm kayıtlar (silinmiş tombstone'lar dahil) — eşlere gönderilir
function getAllForSync() {
  return db.prepare('SELECT * FROM vertraege').all();
}

// Uzaktan gelen kaydı LWW (en yeni kazanır) ile birleştir.
// Döner: { applied: bool, visibleChange: bool }
function upsertFromSync(r) {
  if (!r || !r.uid) return { applied: false, visibleChange: false };
  const local = getByUid(r.uid);
  const incomingTs = Number(r.updated_at) || 0;
  if (!local) {
    insertRow(r, r.uid, incomingTs, r.deleted ? 1 : 0);
    return { applied: true, visibleChange: !r.deleted };
  }
  const localTs = Number(local.updated_at) || 0;
  if (incomingTs <= localTs) return { applied: false, visibleChange: false };
  // En yeni kazanır -> yereldeki kaydı güncelle
  const setClause = ALL_KEYS.map((c) => `"${c}" = ?`).join(', ');
  db.prepare(`UPDATE vertraege SET ${setClause}, updated_at = ?, deleted = ? WHERE uid = ?`).run(
    ...ALL_KEYS.map((c) => r[c] ?? null),
    incomingTs,
    r.deleted ? 1 : 0,
    r.uid
  );
  const wasVisible = !local.deleted;
  const nowVisible = !r.deleted;
  return { applied: true, visibleChange: wasVisible !== nowVisible || nowVisible };
}

// Birden çok uzak kaydı birleştir; özet döndür
function mergeFromSync(records) {
  let applied = 0;
  let newVisible = 0;
  db.transaction((rows) => {
    for (const r of rows) {
      const res = upsertFromSync(r);
      if (res.applied) applied++;
      if (res.visibleChange) newVisible++;
    }
  })(records || []);
  return { applied, newVisible };
}

module.exports = {
  initDatabase, getAll, getCompanies, add, update, remove, updateStatus, bulkInsert, clearAll,
  getSettings, setSettings, getSettingRaw, setSettingRaw, backupTo,
  getAllForSync, mergeFromSync,
};
