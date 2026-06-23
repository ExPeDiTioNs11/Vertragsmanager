// Saf mantık + fields + excelParser testleri (Electron gerekmez)
// Çalıştır: node --test test
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const XLSX = require('../node_modules/xlsx');

const logic = require('../logic');
const fields = require('../fields');
const { parseWorkbook } = require('../excelParser');

// ---------- logic: tarih ----------
test('toISO: Almanca tarihleri ISO yapar', () => {
  assert.equal(logic.toISO('20.06.2026'), '2026-06-20');
  assert.equal(logic.toISO('1.2.2026'), '2026-02-01');
  assert.equal(logic.toISO('2026-06-20'), '2026-06-20');
});
test('toISO: geçersiz tarihleri reddeder', () => {
  assert.equal(logic.toISO('31.02.2026'), ''); // 31 Şubat yok
  assert.equal(logic.toISO('abc'), '');
  assert.equal(logic.toISO(''), '');
});
test('toDE: ISO -> gg.aa.yyyy', () => {
  assert.equal(logic.toDE('2026-06-20'), '20.06.2026');
  assert.equal(logic.toDE(''), '');
});
test('contractEndDate: aktivasyon + 2 yıl', () => {
  const e = logic.contractEndDate('20.06.2024', 2);
  assert.equal(e.de, '20.06.2026');
  assert.equal(logic.contractEndDate('', 2), null);
  assert.equal(logic.contractEndDate('abc', 2), null);
});

// ---------- logic: IBAN / telefon ----------
test('last4: son 4 rakam', () => {
  assert.equal(logic.last4('DE12500105170648489890'), '9890');
  assert.equal(logic.last4('TR33 0006 1005 1978 6457 8413 26'), '1326');
  assert.equal(logic.last4(''), '');
});
test('formatGermanPhone: çeşitli girişler +49 formatına', () => {
  assert.equal(logic.formatGermanPhone('0171 1234567').formatted, '+49 171 1234567');
  assert.equal(logic.formatGermanPhone('+491711234567').formatted, '+49 171 1234567');
  assert.equal(logic.formatGermanPhone('0049 171 1234567').formatted, '+49 171 1234567');
  assert.equal(logic.formatGermanPhone('030 12345678').formatted, '+49 3012345678');
  assert.equal(logic.formatGermanPhone('abc').valid, false);
  assert.equal(logic.formatGermanPhone('123').valid, false);
});
test('toWhatsAppNumber: uluslararası rakam dizisi', () => {
  assert.equal(logic.toWhatsAppNumber('0171 1234567'), '491711234567');
  assert.equal(logic.toWhatsAppNumber('+49 171 1234567'), '491711234567');
  assert.equal(logic.toWhatsAppNumber('004915112345678'), '4915112345678');
  assert.equal(logic.toWhatsAppNumber('123'), null);
  assert.equal(logic.toWhatsAppNumber(''), null);
});

// ---------- logic: diğer ----------
test('normFirma: küçük harf + boşluksuz', () => {
  assert.equal(logic.normFirma(' Vodafone '), 'vodafone');
  assert.equal(logic.normFirma('O2'), 'o2');
});
test('extractYearFromName: dosya adındaki sondaki yıl', () => {
  assert.equal(logic.extractYearFromName('Vertrage_2024.xlsx'), '2024');
  assert.equal(logic.extractYearFromName('rapor_2020_v2_2024.xlsx'), '2024');
  assert.equal(logic.extractYearFromName('liste.xlsx'), null);
});

// ---------- fields ----------
test('fields: başlık eşleme (header + alias)', () => {
  const map = fields.buildHeaderMap();
  assert.equal(map[fields.normalize('Datum')], 'datum');
  assert.equal(map[fields.normalize('Kundenname / Firma')], 'kundenname');
  assert.equal(map[fields.normalize('Kundenname')], 'kundenname'); // alias
  assert.equal(map[fields.normalize('PK-Klasse')], 'pk_klasse'); // alias
});
test('fields: detectHeaderRow', () => {
  const cells = ['Datum', 'Kundenname / Firma', 'Tarif', 'N/VVL'];
  assert.ok(fields.detectHeaderRow(cells).count >= 3);
  assert.equal(fields.detectHeaderRow(['x', 'y']).count, 0);
});
test('fields: ALL_KEYS firma/jahr/status içerir', () => {
  assert.ok(fields.ALL_KEYS.includes('firma'));
  assert.ok(fields.ALL_KEYS.includes('jahr'));
  assert.ok(fields.ALL_KEYS.includes('status'));
});
test('fields: 3 statü ve otelo->Vodafone alias', () => {
  assert.equal(fields.STATUSES.length, 3);
  assert.equal(fields.BRAND_ALIASES.otelo, 'Vodafone');
});

// ---------- excelParser ----------
const H = ['Datum', 'Kundenname / Firma', 'Tarif', 'N/VVL', 'PK Klasse', 'Aktivierungs', 'Rufnummer', 'IBAN', 'Kundenkennwort', 'Geburtsdatum'];
function makeWb(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
  }
  return wb;
}
const row = (n) => ['20.06.2024', 'Kunde ' + n, 'Tarif', 'N', 'A', '20.06.2024', '0171' + n, 'DE' + n, 'pw', '01.01.1990'];

test('parser: çok sayfa -> firma = sayfa adı', () => {
  const wb = makeWb({ Vodafone: [H, row(1), row(2)], O2: [H, row(3)] });
  const { records } = parseWorkbook(wb);
  const per = {};
  for (const r of records) per[r.firma] = (per[r.firma] || 0) + 1;
  assert.deepEqual(per, { Vodafone: 2, O2: 1 });
});
test('parser: bayi numarası (tek hücre, sayısal) firma sayılmaz', () => {
  // çok sayfalı: sayfa adı firma olur, bayi no atlanır
  const wb = makeWb({ Vodafone: [['7001234'], H, row(1), row(2)], O2: [H, row(3)] });
  const { records } = parseWorkbook(wb);
  const vf = records.filter((r) => r.firma === 'Vodafone');
  assert.equal(vf.length, 2); // 2 kayıt Vodafone, bayi no firma olmadı
  assert.ok(!records.some((r) => r.firma === '7001234'));
});
test('parser: şişmiş aralık (!ref) donmadan ayrıştırılır', () => {
  const ws = XLSX.utils.aoa_to_sheet([H, row(1)]);
  ws['!ref'] = 'A1:XFD1048575'; // dev aralık ilan et
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vodafone');
  const t0 = Date.now();
  const { records } = parseWorkbook(wb);
  assert.equal(records.length, 1);
  assert.ok(Date.now() - t0 < 3000, 'hızlı bitmeli (donmamalı)');
});
test('parser: bilinmeyen kolon atlanır ve raporlanır', () => {
  const wb = makeWb({ Vodafone: [[...H, 'Notiz'], [...row(1), 'egal']] });
  const { records, unmatched } = parseWorkbook(wb);
  assert.equal(records.length, 1);
  assert.ok(unmatched.includes('Notiz'));
  assert.equal(records[0].kundenname, 'Kunde 1');
});
test('parser: sayfa adı boşlukları kırpılır', () => {
  // çok sayfalı ki sayfa adı firma olarak kullanılsın
  const wb = makeWb({ '   o2   ': [H, row(1)], Vodafone: [H, row(2)] });
  const { records } = parseWorkbook(wb);
  const r = records.find((x) => x.kundenname === 'Kunde 1');
  assert.equal(r.firma, 'o2');
});
test('parser: birleşik "Aktivierungs Rufnummer" başlığı rufnummer olur', () => {
  const H2 = ['Datum', 'Kundenname / Firma', 'Tarif', 'N/VVL', 'Aktivierungs  Rufnummer', 'IBAN'];
  const data = ['20.06.2024', 'Kunde X', 'Tarif', 'N', '015112345678', 'DE111'];
  const wb = makeWb({ Vodafone: [H2, data], O2: [H2, data] });
  const { records } = parseWorkbook(wb);
  assert.equal(records[0].rufnummer, '015112345678');
});
test('parser: gerçek tarih hücresi gg.aa.yyyy olur', () => {
  const aoa = [H, ['x', 'Kunde', 'Tarif', 'N', 'A', 'x', '0171', 'DE', 'pw', 'x']];
  aoa[1][0] = new Date(2021, 0, 7); // 7 Ocak 2021 (Datum)
  const wb = makeWb({ Vodafone: aoa });
  const { records } = parseWorkbook(wb);
  assert.equal(records[0].datum, '07.01.2021');
});
