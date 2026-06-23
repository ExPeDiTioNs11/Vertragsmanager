// Bölümlü Excel ayrıştırıcı:
// Tek sayfada alt alta firma firma ayrılmış tabloları okur.
// Tipik yapı:
//   Vodafone                 <- firma başlığı (tek hücre)
//   Datum | Kundenname | ...  <- başlık satırı
//   ...veriler...
//   (boş satır)
//   O2                        <- yeni firma başlığı
//   Datum | Kundenname | ...
//   ...veriler...
const XLSX = require('xlsx');
const { buildHeaderMap, detectHeaderRow, normalize } = require('./fields');

// Tarihi gg.aa.yyyy biçimine getir (yerelden bağımsız, doğru)
function formatDateDE(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function rowToStrings(row) {
  return (row || []).map((v) => {
    if (v == null) return '';
    if (v instanceof Date) return formatDateDE(v); // gerçek tarih -> gg.aa.yyyy
    return String(v).trim();
  });
}

// Bazı Excel'lerde sayfa aralığı (!ref) gerçekte dolu olandan çok daha büyük ilan edilir
// (ör. A1:XFD1048575 = ~17 milyar hücre). Bu, sheet_to_json'ı dondurur/belleği şişirir.
// Bu fonksiyon gerçekten dolu hücrelere bakıp !ref'i o aralığa kırpar.
function trimSheetRange(ws) {
  let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue; // !ref, !merges gibi meta anahtarları atla
    const c = XLSX.utils.decode_cell(key);
    if (c.r < minR) minR = c.r;
    if (c.c < minC) minC = c.c;
    if (c.r > maxR) maxR = c.r;
    if (c.c > maxC) maxC = c.c;
  }
  if (maxR < 0) {
    ws['!ref'] = 'A1'; // hiç dolu hücre yok
    return;
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
}

// Tek hücreli bir değer gerçek bir marka (firma) adı mı, yoksa bayi numarası gibi mi?
// Marka adları harf içerir; bayi/numara değerleri sadece rakam-ayraç ya da "Bayi-Nr: 123" gibidir.
function looksLikeFirma(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  // Sadece rakam ve ayraçlardan (boşluk . - / : #) oluşuyorsa -> bayi no, firma değil
  if (/^[\d\s.\-/:#]+$/.test(v)) return false;
  // "Bayi", "Händler", "BNR", "Nummer" gibi etiket + rakam içeriyorsa -> firma değil
  if (/\d/.test(v) && /(bayi|h[äa]ndler|hdl|bnr|nummer|filiale)/i.test(v)) return false;
  return true;
}

function parseSheet(ws, defaultCompany, headerMap) {
  trimSheetRange(ws); // şişmiş aralıkları gerçek dolu alana indir (donmayı önler)
  // raw:true -> tarihler gerçek Date nesnesi gelir (cellDates ile), yerel format belirsizliği olmaz.
  // "1/7/21" gibi M/D/YY değerleri doğru çözülür (07.01.2021).
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const records = [];
  const unmatched = new Set();

  let currentCompany = defaultCompany || '';
  let colMap = null; // aktif tablo bloğunun kolon haritası

  for (let i = 0; i < aoa.length; i++) {
    const row = rowToStrings(aoa[i]);
    const filledIdx = row.map((v, idx) => (v ? idx : -1)).filter((x) => x >= 0);
    if (filledIdx.length === 0) continue; // boş satır

    // 1) Başlık satırı mı?
    const det = detectHeaderRow(row, headerMap);
    if (det.count >= 3) {
      colMap = det.colMap;
      row.forEach((c) => {
        if (c && !headerMap[normalize(c)]) unmatched.add(c);
      });
      continue;
    }

    // 2) Firma başlığı mı? (tek dolu hücre)
    if (filledIdx.length === 1) {
      const value = row[filledIdx[0]];
      // Sonraki anlamlı satır başlık satırıysa, bu kesin bir firma başlığıdır
      let nextIsHeader = false;
      for (let j = i + 1; j < Math.min(aoa.length, i + 5); j++) {
        const peek = rowToStrings(aoa[j]);
        if (peek.every((c) => !c)) continue;
        nextIsHeader = detectHeaderRow(peek, headerMap).count >= 3;
        break;
      }
      // Henüz tablo başlamadıysa da (colMap yok) bunu firma başlığı adayı say
      if (nextIsHeader || !colMap) {
        // Bayi numarası gibi marka OLMAYAN tek hücreli satırları firma sayma, atla.
        // (Gerçek marka sayfa adından / asıl firma başlığından gelir.)
        if (looksLikeFirma(value)) currentCompany = value;
        continue; // her durumda bu satır veri değildir
      }
      // aksi halde tek kolonlu veri satırı olarak aşağıda işlenir
    }

    // 3) Veri satırı
    if (colMap) {
      const rec = { firma: currentCompany };
      let hasValue = false;
      for (const [idx, key] of Object.entries(colMap)) {
        const val = row[idx] ?? '';
        rec[key] = val === '' ? null : val;
        if (rec[key]) hasValue = true;
      }
      if (hasValue) records.push(rec);
    }
    // colMap yoksa başıboş metin -> yok say
  }

  return { records, unmatched };
}

function parseWorkbook(wb) {
  const headerMap = buildHeaderMap();
  const multiSheet = wb.SheetNames.length > 1;
  const allRecords = [];
  const unmatched = new Set();

  for (const name of wb.SheetNames) {
    // Birden fazla sayfa varsa, firma başlığı bulunmayan bloklar için sayfa adı varsayılan firma olur
    // (sayfa adındaki baş/son boşluklar kırpılır: "   o2   " -> "o2")
    const def = multiSheet ? name.trim() : '';
    const { records, unmatched: u } = parseSheet(wb.Sheets[name], def, headerMap);
    allRecords.push(...records);
    u.forEach((x) => unmatched.add(x));
  }

  return { records: allRecords, unmatched: [...unmatched] };
}

module.exports = { parseWorkbook };
