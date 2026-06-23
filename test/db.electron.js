// Veritabanı + senkron birleştirme testleri (Electron altında çalışır)
// Çalıştır: electron test/db.electron.js
const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name); }
}
function eq(name, a, b) { check(name + ` (${JSON.stringify(a)} == ${JSON.stringify(b)})`, a === b); }

app.whenReady().then(() => {
  // İzole geçici veri klasörü (gerçek DB'ye dokunma)
  const tmp = path.join(os.tmpdir(), 'hi-test-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  app.setPath('userData', tmp);

  const db = require('../database');
  db.initDatabase();

  // 1) Boş başlangıç
  eq('init: boş başlangıç', db.getAll().length, 0);

  // 2) add
  const a = db.add({ firma: 'Vodafone', jahr: '2025', status: 'nicht_angerufen', kundenname: 'Alice', aktivierung: '01.01.2024' });
  check('add: uid atandı', !!a.uid);
  check('add: updated_at atandı', !!a.updated_at);
  eq('add: getAll = 1', db.getAll().length, 1);

  // 3) update
  const u = db.update(a.id, { ...a, kundenname: 'Alice B.' });
  eq('update: alan değişti', u.kundenname, 'Alice B.');
  check('update: updated_at arttı', u.updated_at >= a.updated_at);

  // 4) updateStatus
  const s = db.updateStatus(a.id, 'bestaetigt');
  eq('updateStatus', s.status, 'bestaetigt');

  // 5) remove = soft delete (tombstone)
  db.remove(a.id);
  eq('remove: getAll gizler', db.getAll().length, 0);
  eq('remove: getAllForSync tombstone tutar', db.getAllForSync().length, 1);
  eq('remove: deleted=1', db.getAllForSync()[0].deleted, 1);

  // 6) bulkInsert
  const ins = db.bulkInsert([
    { firma: 'O2', jahr: '2025', status: 'nicht_angerufen', kundenname: 'Bob' },
    { firma: 'O2', jahr: '2025', status: 'ueberlegt', kundenname: 'Carol' },
  ]);
  eq('bulkInsert: 2 satır döndü', ins.length, 2);
  check('bulkInsert: uid var', ins.every((r) => r.uid));
  eq('bulkInsert: getAll = 2', db.getAll().length, 2);

  // 7) getCompanies
  const comp = db.getCompanies();
  const o2 = comp.find((c) => c.firma === 'O2');
  eq('getCompanies: O2 = 2', o2 && o2.adet, 2);

  // 8) ayarlar
  const def = db.getSettings();
  eq('settings: varsayılan reminderDays', def.reminderDays, 90);
  db.setSettings({ reminderDays: 30 });
  eq('settings: kaydedildi', db.getSettings().reminderDays, 30);
  db.setSettingRaw('passwordHash', 'secret');
  eq('settings: ham erişim', db.getSettingRaw('passwordHash'), 'secret');
  check('settings: gizli anahtar sızmıyor', !('passwordHash' in db.getSettings()));

  // 9) yedek
  const bf = path.join(tmp, 'backup.db');
  db.backupTo(bf);
  check('backup: dosya oluştu', fs.existsSync(bf) && fs.statSync(bf).size > 0);

  // 10) senkron birleştirme (LWW)
  const r1 = db.mergeFromSync([{ uid: 'X1', updated_at: 1000, deleted: 0, firma: 'Telekom', kundenname: 'Remote', status: 'nicht_angerufen' }]);
  eq('merge: yeni kayıt uygulandı', r1.applied, 1);
  check('merge: kayıt görünür', db.getAll().some((r) => r.uid === 'X1'));

  const r2 = db.mergeFromSync([{ uid: 'X1', updated_at: 500, deleted: 0, firma: 'ESKI', kundenname: 'Eski' }]);
  eq('merge: eski timestamp yok sayıldı', r2.applied, 0);
  eq('merge: değer korundu', db.getAll().find((r) => r.uid === 'X1').firma, 'Telekom');

  const r3 = db.mergeFromSync([{ uid: 'X1', updated_at: 2000, deleted: 0, firma: 'YENI', kundenname: 'Yeni' }]);
  eq('merge: yeni timestamp uygulandı', r3.applied, 1);
  eq('merge: değer güncellendi', db.getAll().find((r) => r.uid === 'X1').firma, 'YENI');

  db.mergeFromSync([{ uid: 'X1', updated_at: 3000, deleted: 1, firma: 'YENI' }]);
  check('merge: tombstone gizler', !db.getAll().some((r) => r.uid === 'X1'));

  console.log(`\nSONUÇ: ${pass} PASS, ${fail} FAIL`);
  app.exit(fail > 0 ? 1 : 0);
});
