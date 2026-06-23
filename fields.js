// TEK KAYNAK: Tüm alan adları burada tanımlı.
// header  -> Excel kolon başlığı ve arayüz etiketi (BİREBİR korunur)
// key     -> veritabanı kolon adı (iç kullanım)
// aliases -> Excel içeri aktarmada kabul edilen alternatif başlıklar
// group -> formda hangi bölümde gösterileceği
const FIELDS = [
  { key: 'datum',         header: 'Datum',               type: 'date',  group: 'tarife',  aliases: [] },
  { key: 'kundenname',    header: 'Kundenname / Firma',  type: 'text',  group: 'musteri', aliases: ['Kundenname', 'Firma', 'Kunde'] },
  { key: 'tarif',         header: 'Tarif',               type: 'text',  group: 'tarife',  aliases: [] },
  { key: 'n_vvl',         header: 'N/VVL',               type: 'text',  group: 'tarife',  aliases: ['N / VVL', 'NVVL', 'N-VVL'] },
  { key: 'pk_klasse',     header: 'PK Klasse',           type: 'text',  group: 'tarife',  onlyFirma: ['O2'], aliases: ['PK-Klasse', 'PKKlasse', 'PK'] },
  { key: 'aktivierung',   header: 'Aktivierungs',        type: 'date',  group: 'tarife',  aliases: ['Aktivierung', 'Aktivierungsdatum', 'Aktivierungs-datum'] },
  { key: 'rufnummer',     header: 'Rufnummer',           type: 'phone', group: 'musteri', aliases: ['Rufnr', 'Telefonnummer', 'Nummer', 'Aktivierungs Rufnummer', 'Aktivierungsrufnummer', 'Aktivierungs-Rufnummer'] },
  { key: 'iban',          header: 'IBAN',                type: 'iban',  group: 'musteri', aliases: [] },
  { key: 'kundenkennwort',header: 'Kundenkennwort',      type: 'text',  group: 'musteri', aliases: ['Kennwort', 'Passwort'] },
  { key: 'geburtsdatum',  header: 'Geburtsdatum',        type: 'date',  group: 'musteri', aliases: ['Geb.datum', 'Geb-datum', 'Geburt'] },
];

// Form bölümleri (gösterim sırası)
const GROUPS = [
  { key: 'musteri', label: 'Kundendaten' },
  { key: 'tarife',  label: 'Tarif / Vertrag' },
];

// Excel başlıklarını eşlemek için normalize fonksiyonu
// (büyük/küçük harf, boşluk, /, -, . farklılıklarını yok sayar)
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s/\-.]/g, '')
    .trim();
}

// normalize edilmiş başlık -> key  haritası (header + tüm aliases)
function buildHeaderMap() {
  const map = {};
  for (const f of FIELDS) {
    map[normalize(f.header)] = f.key;
    for (const a of f.aliases) map[normalize(a)] = f.key;
  }
  return map;
}

// Firma (operatör) — Excel'de bölüm başlığı olarak gelir, kayıt bazında saklanır
const FIRMA_FIELD = { key: 'firma', header: 'Firma' };

// Yıl (Jahr) — içe aktarılan Excel'in dosya adındaki yıldan türetilir, kayıt bazında saklanır
const YEAR_FIELD = { key: 'jahr', header: 'Jahr' };

// Durum (Status) — müşteri arama/onay durumu, 3 renkli aşama
const STATUS_FIELD = { key: 'status', header: 'Status' };
const STATUSES = [
  { key: 'nicht_angerufen', label: 'Noch nicht angerufen', bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' },
  { key: 'ueberlegt',       label: 'Überlegt noch',        bg: '#fef3c7', fg: '#b45309', border: '#fcd34d' },
  { key: 'bestaetigt',      label: 'Kunde bestätigt',      bg: '#dcfce7', fg: '#15803d', border: '#86efac' },
];
const DEFAULT_STATUS = 'nicht_angerufen';

// Marka birleştirme: alt markalar listede üst marka altında gruplanır.
// Anahtar normalize (küçük harf, boşluksuz) -> görünen üst marka.
// Örn: otelo, Vodafone'un alt markasıdır -> hep Vodafone altında listelenir.
const BRAND_ALIASES = { otelo: 'Vodafone' };

// Veritabanı kolon sırası: önce firma + yıl + durum, sonra tanımlı alanlar
const ALL_KEYS = [FIRMA_FIELD.key, YEAR_FIELD.key, STATUS_FIELD.key, ...FIELDS.map((f) => f.key)];

// Bir satır (hücre dizisi) başlık satırı mı? Eşleşen kolon sayısı >= 3 ise evet.
// Döner: { count, colMap }  (colMap: hücre indeksi -> alan key)
function detectHeaderRow(cells, headerMap = buildHeaderMap()) {
  const colMap = {};
  let count = 0;
  cells.forEach((c, i) => {
    const key = headerMap[normalize(c)];
    if (key) {
      colMap[i] = key;
      count++;
    }
  });
  return { count, colMap };
}

module.exports = { FIELDS, GROUPS, FIRMA_FIELD, YEAR_FIELD, STATUS_FIELD, STATUSES, DEFAULT_STATUS, BRAND_ALIASES, ALL_KEYS, normalize, buildHeaderMap, detectHeaderRow };
