// Arayüz mantığı — window.api köprüsü üzerinden çalışır

let FIELDS = [];
let GROUPS = [];
let FIRMA = { key: 'firma', header: 'Firma' };
let YEAR = { key: 'jahr', header: 'Jahr' };
let STATUS = { key: 'status', header: 'Status' };
let STATUSES = [];
let DEFAULT_STATUS = 'nicht_angerufen';
let BRAND_ALIASES = {}; // alt marka -> üst marka (ör. otelo -> Vodafone)
let allRecords = [];
let editingId = null;
let formStatusSelect = null; // formdaki statü select referansı
let activeFirma = '__ALL__'; // seçili firma sekmesi
let activeYear = '__ALL__'; // seçili yıl filtresi
let activeStatus = '__ALL__'; // seçili statü filtresi
let reminderOnly = false; // yalnızca yaklaşan sözleşmeleri göster
let settings = { reminderDays: 90, notifyOnStartup: true };

const CONTRACT_YEARS = 2; // tüm sözleşmeler 2 yıllık
const END_COL = { header: 'Vertragsende' }; // türetilmiş (sanal) sütun

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Hızlı ardışık çağrıları geciktir (arama performansı için)
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Saf mantık (logic.js): tarih/telefon/IBAN/eşleştirme — uygulama ve testler aynı kodu kullanır
const { toISO, toDE, last4, formatGermanPhone, normFirma, parseDE, dateToDE } = window.Logic;

// Kayıtlı farklı markalar (alias'lar üst markaya çevrilmiş, placeholder hariç), alfabetik
function getFirmaList() {
  const set = new Set();
  for (const r of allRecords) {
    const b = brandOf(r);
    if (b && b !== '(kein Anbieter)') set.add(b);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

function toast(msg, ok = true) {
  const t = $('toast');
  t.textContent = msg;
  t.style.borderLeftColor = ok ? '#059669' : '#e11d48';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4500);
}

const firmaOf = (r) => (r[FIRMA.key] || '').trim() || '(kein Anbieter)';
// Gruplama/sekme/filtre için marka: alt marka ise üst markaya çevrilir (otelo -> Vodafone)
const brandOf = (r) => {
  const raw = firmaOf(r);
  return BRAND_ALIASES[normFirma(raw)] || raw;
};
const yearOf = (r) => (r[YEAR.key] || '').toString().trim() || '(kein Jahr)';
const statusOf = (r) => r[STATUS.key] || DEFAULT_STATUS;
const statusInfo = (key) => STATUSES.find((s) => s.key === key) || STATUSES[0] || {};

// Statü select'inin rengini değerine göre boya
function applyStatusColor(sel) {
  const info = statusInfo(sel.value);
  sel.style.background = info.bg || '#fff';
  sel.style.color = info.fg || '#000';
  sel.style.borderColor = info.border || '#ccc';
}

// Renkli statü açılır listesi (tablo satırı veya form için)
function buildStatusSelect(currentKey, onChange) {
  const sel = document.createElement('select');
  sel.className = 'status-select';
  for (const s of STATUSES) {
    const opt = document.createElement('option');
    opt.value = s.key;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
  sel.value = currentKey || DEFAULT_STATUS;
  applyStatusColor(sel);
  sel.addEventListener('change', () => {
    applyStatusColor(sel);
    if (onChange) onChange(sel.value);
  });
  return sel;
}

// Kayıtlardaki farklı yıllar: gerçek yıllar yeni->eski, "(yıl yok)" en sonda
function getYearList() {
  const set = new Set();
  for (const r of allRecords) set.add(yearOf(r));
  const arr = [...set];
  const noYear = arr.filter((y) => y === '(kein Jahr)');
  const years = arr.filter((y) => y !== '(kein Jahr)').sort((a, b) => b.localeCompare(a, 'tr'));
  return [...years, ...noYear];
}

// Yıl filtresi açılır listesini doldur (her zaman tek yıl seçili; varsayılan en güncel yıl)
function renderYearFilter() {
  const sel = $('yearFilter');
  const years = getYearList();
  if (!years.length) {
    sel.innerHTML = '<option value="">Kein Jahr</option>';
    return;
  }
  // Geçerli bir yıl seçili değilse en güncel yıla geç
  if (!years.includes(activeYear)) activeYear = years[0];
  sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  sel.value = activeYear;
}

// ---- Sözleşme bitişi & hatırlatma ----
function todayMidnight() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}
// Bu kaydın markası için geçerli hatırlatma eşiği (gün).
// Markaya özel değer varsa onu, yoksa global varsayılanı kullanır.
function reminderDaysFor(record) {
  const map = settings.firmaReminderDays || {};
  const key = normFirma(brandOf(record)); // alt marka üst markanın eşiğini kullanır
  const v = map[key];
  return v != null && v !== '' ? parseInt(v, 10) || settings.reminderDays : settings.reminderDays;
}

// Aktivasyon + 2 yıl. Döner: { de, date, remaining, status, threshold } veya null
function contractEnd(record) {
  const act = parseDE(record.aktivierung);
  if (!act) return null;
  const end = new Date(act.getFullYear() + CONTRACT_YEARS, act.getMonth(), act.getDate());
  const remaining = Math.round((end - todayMidnight()) / 86400000);
  const threshold = reminderDaysFor(record);
  let status;
  if (remaining < 0) status = 'overdue';
  else if (remaining <= threshold) status = 'soon';
  else status = 'ok';
  return { de: dateToDE(end), date: end, remaining, status, threshold };
}
// Hatırlatma gerekir mi? (bitiş var ve 0..markaya özel eşik arası)
function needsReminder(record) {
  const e = contractEnd(record);
  return !!e && e.remaining >= 0 && e.remaining <= e.threshold;
}
function reminderCount() {
  return allRecords.filter(needsReminder).length;
}

// ---- Firma sekmeleri (aktif kapsama göre sayılır) ----
function renderTabs() {
  const base = reminderOnly
    ? allRecords.filter(needsReminder)
    : allRecords.filter((r) => activeYear === '__ALL__' || yearOf(r) === activeYear);
  const counts = new Map();
  for (const r of base) {
    const f = brandOf(r);
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  const firmalar = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'de'));

  const tabs = $('firmaTabs');
  tabs.innerHTML = '';

  const mkTab = (key, label, count) => {
    const btn = document.createElement('button');
    btn.className = key === activeFirma ? 'active' : '';
    btn.innerHTML = `${label}<span class="badge">${count}</span>`;
    btn.addEventListener('click', () => {
      activeFirma = key;
      renderTabs();
      applyFilters();
    });
    return btn;
  };

  tabs.appendChild(mkTab('__ALL__', 'Alle', base.length));
  for (const f of firmalar) tabs.appendChild(mkTab(f, f, counts.get(f)));

  // form datalist'ini de güncelle
  $('firmaList').innerHTML = firmalar
    .filter((f) => f !== '(kein Anbieter)')
    .map((f) => `<option value="${f.replace(/"/g, '&quot;')}">`)
    .join('');
}

// Bitiş sütununun hangi alandan sonra geleceği
function endColAfter() {
  return FIELDS.some((f) => f.key === 'aktivierung') ? 'aktivierung' : FIELDS[FIELDS.length - 1].key;
}

// ---- Tablo (firmaya göre gruplu) ----
function renderTable(records) {
  const afterKey = endColAfter();
  const thead = $('theadRow');
  let headHtml = `<th>${FIRMA.header}</th><th>${YEAR.header}</th><th>${STATUS.header}</th>`;
  for (const f of FIELDS) {
    headHtml += `<th>${f.header}</th>`;
    if (f.key === afterKey) headHtml += `<th>${END_COL.header}</th>`;
  }
  headHtml += '<th>Aktion</th>';
  thead.innerHTML = headHtml;

  const tbody = $('tbody');
  const totalCols = FIELDS.length + 5; // firma + yıl + durum + bitiş + işlem

  if (!records.length) {
    const msg = reminderOnly
      ? 'Keine bald ablaufenden Verträge im gewählten Zeitraum.'
      : 'Keine Einträge. Fügen Sie einen Eintrag hinzu oder importieren Sie Excel.';
    tbody.innerHTML = `<tr><td class="empty" colspan="${totalCols}">${msg}</td></tr>`;
    return;
  }

  // markaya göre grupla (otelo gibi alt markalar üst marka altında)
  const groups = new Map();
  for (const r of records) {
    const f = brandOf(r);
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(r);
  }

  // Performans: tek seferde DOM'a bas (fragment) + çok büyük listelerde satır sınırı
  const RENDER_CAP = 500;
  const frag = document.createDocumentFragment();
  let rendered = 0;
  let truncated = false;

  for (const [firma, rows] of groups) {
    if (rendered >= RENDER_CAP) { truncated = true; break; }

    const gtr = document.createElement('tr');
    gtr.className = 'group';
    const gtd = document.createElement('td');
    gtd.colSpan = totalCols;
    gtd.textContent = `${firma}  ·  ${rows.length} Einträge`;
    gtr.appendChild(gtd);
    frag.appendChild(gtr);

    for (const r of rows) {
      if (rendered >= RENDER_CAP) { truncated = true; break; }
      frag.appendChild(buildRow(r, afterKey));
      rendered++;
    }
  }

  tbody.innerHTML = '';
  tbody.appendChild(frag);

  if (truncated) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = totalCols;
    td.className = 'cap-note';
    td.textContent = `Nur erste ${RENDER_CAP} von ${records.length} Einträgen angezeigt – bitte Filter/Suche verfeinern.`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

// Tek bir tablo satırını oluştur
function buildRow(r, afterKey) {
  const tr = document.createElement('tr');

  const fcell = document.createElement('td');
  fcell.textContent = firmaOf(r);
  tr.appendChild(fcell);

  const ycell = document.createElement('td');
  ycell.textContent = yearOf(r);
  tr.appendChild(ycell);

  const scell = document.createElement('td');
  scell.appendChild(
    buildStatusSelect(statusOf(r), async (val) => {
      await window.api.updateStatus(r.id, val);
      r.status = val;
    })
  );
  tr.appendChild(scell);

  const end = contractEnd(r);
  for (const f of FIELDS) {
    const td = document.createElement('td');
    td.textContent = r[f.key] ?? '';
    tr.appendChild(td);
    if (f.key === afterKey) {
      const etd = document.createElement('td');
      if (!end) {
        etd.className = 'end-na';
        etd.textContent = '—';
      } else {
        etd.className = 'end-' + end.status;
        etd.textContent = end.de;
        etd.title = end.remaining < 0 ? `Vor ${-end.remaining} Tagen abgelaufen` : `Noch ${end.remaining} Tage`;
      }
      tr.appendChild(etd);
    }
  }

  const actions = document.createElement('td');
  actions.className = 'actions';
  const wa = document.createElement('button');
  wa.className = 'wa';
  wa.textContent = 'WhatsApp';
  wa.title = 'Erinnerung per WhatsApp senden';
  wa.addEventListener('click', () => onWhatsApp(r));
  const edit = document.createElement('button');
  edit.className = 'edit';
  edit.textContent = 'Bearbeiten';
  edit.addEventListener('click', () => openForm(r));
  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = 'Löschen';
  del.addEventListener('click', () => onDelete(r));
  actions.appendChild(wa);
  actions.appendChild(edit);
  actions.appendChild(del);
  tr.appendChild(actions);

  return tr;
}

// Statü filtresi için temel küme (yıl/hatırlatma kapsamı)
function statusBase() {
  if (reminderOnly) return allRecords.filter(needsReminder);
  if (activeYear && activeYear !== '__ALL__') return allRecords.filter((r) => yearOf(r) === activeYear);
  return allRecords;
}

// Statü filtresi açılır listesini sayılarla doldur
function renderStatusFilter() {
  const sel = $('statusFilter');
  const base = statusBase();
  const counts = {};
  for (const r of base) counts[statusOf(r)] = (counts[statusOf(r)] || 0) + 1;
  let opts = `<option value="__ALL__">Alle Status (${base.length})</option>`;
  for (const s of STATUSES) opts += `<option value="${s.key}">${s.label} (${counts[s.key] || 0})</option>`;
  sel.innerHTML = opts;
  if (activeStatus !== '__ALL__' && !STATUSES.some((s) => s.key === activeStatus)) activeStatus = '__ALL__';
  sel.value = activeStatus;
}

function applyFilters() {
  const q = $('searchInput').value.trim().toLowerCase();

  const scope = statusBase();

  let filtered = scope;
  if (activeStatus !== '__ALL__') {
    filtered = filtered.filter((r) => statusOf(r) === activeStatus);
  }
  if (activeFirma !== '__ALL__') {
    filtered = filtered.filter((r) => brandOf(r) === activeFirma);
  }
  if (q) {
    filtered = filtered.filter(
      (r) =>
        firmaOf(r).toLowerCase().includes(q) ||
        FIELDS.some((f) => String(r[f.key] ?? '').toLowerCase().includes(q))
    );
  }

  $('count').textContent = `${filtered.length} / ${scope.length} Einträge`;
  renderTable(filtered);
}

// Hatırlatma düğmesini güncelle (sayı + görünürlük + aktif durum)
function updateReminderToggle() {
  const n = reminderCount();
  const btn = $('reminderToggle');
  $('reminderCount').textContent = n;
  btn.style.display = n > 0 || reminderOnly ? '' : 'none';
  btn.classList.toggle('active', reminderOnly);
}

async function reload() {
  allRecords = await window.api.getAll();
  // seçili firma artık yoksa Tümü'ne dön
  if (activeFirma !== '__ALL__' && !allRecords.some((r) => firmaOf(r) === activeFirma)) {
    activeFirma = '__ALL__';
  }
  renderYearFilter();
  renderStatusFilter();
  renderTabs();
  updateReminderToggle();
  applyFilters();
}

// ---- Form ----
// Tek bir alanın HTML'i
function fieldHtml(f) {
  const full = f.header.length > 16 ? ' full' : '';
  let input;
  if (f.type === 'date') {
    input = `<input id="fld_${f.key}" name="${f.key}" type="date" />`;
  } else if (f.type === 'iban') {
    input = `<input id="fld_${f.key}" name="${f.key}" type="text" inputmode="numeric"
               maxlength="4" pattern="\\d{4}" placeholder="Letzte 4 Ziffern (z. B. 1234)" />`;
  } else if (f.type === 'phone') {
    input = `<input id="fld_${f.key}" name="${f.key}" type="text" inputmode="tel"
               placeholder="+49 171 1234567" />`;
  } else {
    input = `<input id="fld_${f.key}" name="${f.key}" type="text" />`;
  }
  let hint =
    f.type === 'iban'
      ? ' <span class="hint">(letzte 4 Ziffern)</span>'
      : f.type === 'phone'
      ? ' <span class="hint">(automatisch +49)</span>'
      : f.type === 'date'
      ? ' <span class="hint">(Kalender)</span>'
      : '';
  if (f.onlyFirma) hint += ` <span class="hint">(nur ${f.onlyFirma.join('/')})</span>`;
  return `
    <div class="field${full}" id="wrap_${f.key}">
      <label for="fld_${f.key}">${f.header}${hint}</label>
      ${input}
    </div>`;
}

// onlyFirma kuralına göre koşullu alanları seçili firmaya göre göster/gizle
function updateConditionalFields() {
  const firma = normFirma(readFirma());
  for (const f of FIELDS) {
    if (!f.onlyFirma) continue;
    const wrap = $(`wrap_${f.key}`);
    if (!wrap) continue;
    const show = f.onlyFirma.map(normFirma).includes(firma);
    wrap.style.display = show ? '' : 'none';
  }
}

function buildFormFields() {
  // 1) Firma bölümü: kayıtlı firmalardan seç (select) veya yeni ekle
  const firmaSection = `
    <div class="section">
      <div class="section-title">Anbieter</div>
      <div class="grid">
        <div class="field full">
          <label for="fld_firma_select">${FIRMA.header}</label>
          <select id="fld_firma_select"></select>
        </div>
        <div class="field full" id="firmaNewWrap" style="display:none">
          <label for="fld_firma_new">Neuer Anbietername</label>
          <input id="fld_firma_new" name="firma_new" type="text" list="firmaList"
                 placeholder="z. B. Vodafone, O2, Ayyıldız..." />
        </div>
        <div class="field">
          <label for="fld_jahr">${YEAR.header}</label>
          <input id="fld_jahr" name="jahr" type="number" min="2000" max="2100"
                 placeholder="z. B. 2024" />
        </div>
        <div class="field">
          <label>${STATUS.header}</label>
          <div id="statusHolder"></div>
        </div>
      </div>
    </div>`;

  // 2) Gruplara göre bölümler
  const sections = GROUPS.map((g) => {
    const inner = FIELDS.filter((f) => f.group === g.key).map(fieldHtml).join('');
    if (!inner) return '';
    return `
      <div class="section">
        <div class="section-title">${g.label}</div>
        <div class="grid">${inner}</div>
      </div>`;
  }).join('');

  // Gruba atanmamış alanlar olursa (güvenlik) en alta ekle
  const grouped = new Set(GROUPS.map((g) => g.key));
  const orphan = FIELDS.filter((f) => !grouped.has(f.group)).map(fieldHtml).join('');
  const orphanSection = orphan
    ? `<div class="section"><div class="section-title">Diğer</div><div class="grid">${orphan}</div></div>`
    : '';

  $('formGrid').innerHTML = firmaSection + sections + orphanSection;

  // Formdaki renkli statü seçimi
  formStatusSelect = buildStatusSelect(DEFAULT_STATUS, null);
  $('statusHolder').appendChild(formStatusSelect);

  // Firma select: "yeni firma" seçilince metin kutusunu göster
  $('fld_firma_select').addEventListener('change', toggleNewFirma);
  // Yeni firma adı yazılırken koşullu alanları güncelle (ör. "O2" yazınca PK Klasse açılır)
  $('fld_firma_new').addEventListener('input', updateConditionalFields);

  // IBAN: sadece rakam ve en fazla 4 karakter
  const ibanEl = document.querySelector('#formGrid input[name="iban"]');
  if (ibanEl) {
    ibanEl.addEventListener('input', () => {
      ibanEl.value = ibanEl.value.replace(/\D/g, '').slice(0, 4);
    });
  }

  // Rufnummer: alandan çıkınca Almanya formatına çevir
  const telEl = document.querySelector('#formGrid input[name="rufnummer"]');
  if (telEl) {
    telEl.addEventListener('blur', () => {
      const r = formatGermanPhone(telEl.value);
      if (r.valid && r.formatted) telEl.value = r.formatted;
    });
  }
}

// Firma select'ini güncel firmalarla doldur; verilen değeri seç
function populateFirmaSelect(selected) {
  const sel = $('fld_firma_select');
  const firms = getFirmaList();
  let opts = '<option value="">— Anbieter wählen —</option>';
  for (const f of firms) opts += `<option value="${esc(f)}">${esc(f)}</option>`;
  // Düzenlenen kayıdın firması listede yoksa, onu da ekle
  if (selected && !firms.includes(selected)) {
    opts += `<option value="${esc(selected)}">${esc(selected)}</option>`;
  }
  opts += '<option value="__new__">+ Neuen Anbieter hinzufügen…</option>';
  sel.innerHTML = opts;
  sel.value = selected || '';
  $('fld_firma_new').value = '';
  toggleNewFirma();
}

// "Yeni firma..." seçiliyse metin kutusunu göster
function toggleNewFirma() {
  const isNew = $('fld_firma_select').value === '__new__';
  $('firmaNewWrap').style.display = isNew ? '' : 'none';
  if (isNew) $('fld_firma_new').focus();
  updateConditionalFields();
}

// Formdaki seçili firmayı oku
function readFirma() {
  const sel = $('fld_firma_select');
  if (sel.value === '__new__') return $('fld_firma_new').value.trim();
  return sel.value.trim();
}

function openForm(record = null) {
  editingId = record ? record.id : null;
  $('modalTitle').textContent = record ? 'Eintrag bearbeiten' : 'Neuer Eintrag';

  // firma: düzenlemede kayıdın firması; yeni kayıtta aktif sekme önceden seçilir
  const presetFirma = record
    ? record[FIRMA.key] ?? ''
    : activeFirma !== '__ALL__' && activeFirma !== '(kein Anbieter)'
    ? activeFirma
    : '';
  populateFirmaSelect(presetFirma);

  // Yıl: düzenlemede kaydın yılı; yeni kayıtta aktif yıl filtresi ya da içinde bulunulan yıl
  $('fld_jahr').value = record
    ? record[YEAR.key] ?? ''
    : activeYear !== '__ALL__' && activeYear !== '(kein Jahr)'
    ? activeYear
    : new Date().getFullYear();

  // Durum: düzenlemede kaydın durumu, yeni kayıtta varsayılan ("noch nicht angerufen")
  formStatusSelect.value = record ? statusOf(record) : DEFAULT_STATUS;
  applyStatusColor(formStatusSelect);

  for (const f of FIELDS) {
    const el = $(`fld_${f.key}`);
    const raw = record ? (record[f.key] ?? '') : '';
    if (f.type === 'date') {
      el.value = toISO(raw); // ISO'ya çevrilemezse boş kalır
      el.dataset.original = raw; // orijinali sakla (veri kaybını önlemek için)
    } else if (f.type === 'iban') {
      el.value = last4(raw); // mevcut tam IBAN'ı son 4 haneye indir
    } else {
      el.value = raw;
    }
  }
  $('overlay').classList.add('open');
  $('fld_firma_select').focus();
}

function closeForm() {
  $('overlay').classList.remove('open');
  editingId = null;
}

async function onSubmit(e) {
  e.preventDefault();
  const record = {
    firma: readFirma() || null,
    jahr: $('fld_jahr').value.trim() || null,
    status: formStatusSelect.value || DEFAULT_STATUS,
  };
  for (const f of FIELDS) {
    // Koşullu alan (ör. PK Klasse) sadece ilgili firmada saklanır; aksi halde boş
    if (f.onlyFirma && !f.onlyFirma.map(normFirma).includes(normFirma(record.firma))) {
      record[f.key] = null;
      continue;
    }
    const el = $(`fld_${f.key}`);
    if (f.type === 'date') {
      const iso = el.value; // type=date geçersiz tarihe izin vermez
      if (iso) {
        record[f.key] = toDE(iso);
      } else {
        // Boşsa: orijinal değer çevrilemeyen bir tarihse onu koru, yoksa null
        const orig = el.dataset.original || '';
        record[f.key] = orig && !toISO(orig) ? orig : null;
      }
      continue;
    }
    let v = el.value.trim();
    if (f.type === 'iban' && v && !/^\d{4}$/.test(v)) {
      toast('Bitte nur die letzten 4 Ziffern der IBAN eingeben (4 Ziffern).', false);
      el.focus();
      return;
    }
    if (f.type === 'phone' && v) {
      const r = formatGermanPhone(v);
      if (!r.valid) {
        toast('Die Rufnummer scheint ungültig zu sein. Bitte prüfen.', false);
        el.focus();
        return;
      }
      v = r.formatted; // +49 formatında sakla
    }
    record[f.key] = v === '' ? null : v;
  }
  if (editingId) {
    await window.api.update(editingId, record);
    toast('Eintrag aktualisiert.');
  } else {
    await window.api.add(record);
    toast('Neuer Eintrag hinzugefügt.');
  }
  closeForm();
  reload();
}

// WhatsApp hatırlatma metni (Almanca)
function whatsappMessage(r) {
  const name = (r.kundenname || '').trim();
  const brand = brandOf(r);
  const end = contractEnd(r);
  const anrede = name ? `Hallo ${name},` : 'Hallo,';
  let msg = `${anrede}\n\n`;
  if (end) {
    msg += `Ihr Vertrag bei ${brand} läuft am ${end.de} ab. `;
  } else {
    msg += `wir möchten Sie bezüglich Ihres Vertrags bei ${brand} kontaktieren. `;
  }
  msg += `Gerne beraten wir Sie zur Verlängerung – bitte melden Sie sich bei uns.\n\nMit freundlichen Grüßen\nIhr Handy Island Team`;
  return msg;
}

async function onWhatsApp(r) {
  const phone = r.rufnummer || '';
  if (!phone.replace(/\D/g, '')) {
    toast('Keine Rufnummer für diesen Eintrag vorhanden.', false);
    return;
  }
  const res = await window.api.openWhatsApp(phone, whatsappMessage(r));
  if (!res || !res.ok) {
    toast('Rufnummer ungültig – WhatsApp konnte nicht geöffnet werden.', false);
  }
}

async function onDelete(r) {
  const label = r.kundenname || r.rufnummer || `#${r.id}`;
  if (!confirm(`Diesen Eintrag löschen?\n\n${firmaOf(r)} — ${label}`)) return;
  await window.api.remove(r.id);
  toast('Eintrag gelöscht.');
  reload();
}

// ---- Yükleme göstergesi ----
function showLoading(title) {
  $('loadingTitle').textContent = title || 'Excel wird importiert';
  $('progressBar').style.width = '0%';
  $('loadingLabel').textContent = '0 %';
  $('loadingOverlay').classList.add('open');
}
function updateLoading(percent, label) {
  $('loadingOverlay').classList.add('open');
  $('progressBar').style.width = percent + '%';
  $('loadingLabel').textContent = label ? `${label} (${percent} %)` : `${percent} %`;
}
function hideLoading() {
  $('loadingOverlay').classList.remove('open');
}

// ---- Excel ----
async function onImport() {
  let res;
  try {
    res = await window.api.importExcel();
  } finally {
    hideLoading();
  }
  if (res.canceled) return;

  const fileInfo = res.fileCount > 1 ? `${res.fileCount} Dateien` : '1 Datei';
  let msg = `${res.imported} Einträge importiert (${fileInfo}).`;
  const yillar = Object.entries(res.perYear || {});
  if (yillar.length) {
    msg += ' Jahre: ' + yillar.map(([y, n]) => `${y} (${n})`).join(', ') + '.';
  }
  if (res.noYearFiles && res.noYearFiles.length) {
    msg += ` Kein Jahr im Dateinamen: ${res.noYearFiles.join(', ')}.`;
  }
  if (res.unmatched && res.unmatched.length) {
    msg += ` Nicht zugeordnete Spalten übersprungen: ${res.unmatched.join(', ')}.`;
  }
  toast(msg);
  reload();
}

async function onExport() {
  const res = await window.api.exportExcel();
  if (res.canceled) return;
  toast(`${res.count} Einträge nach Anbieter exportiert (${res.file}).`);
}

async function onTemplate() {
  const res = await window.api.downloadTemplate();
  if (res.canceled) return;
  toast(`Vorlage gespeichert (${res.file}).`);
}

// ---- Hatırlatma filtresi ----
function toggleReminderFilter() {
  reminderOnly = !reminderOnly;
  if (reminderOnly) activeFirma = '__ALL__'; // tüm firmalarda yaklaşanları göster
  renderStatusFilter();
  renderTabs();
  updateReminderToggle();
  applyFilters();
}

// ---- İstatistik ----
function countBy(records, fn) {
  const m = new Map();
  for (const r of records) {
    const k = fn(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function barRows(entries, colorFn) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return entries
    .map(([label, n]) => {
      const w = Math.round((n / max) * 100);
      const color = colorFn ? colorFn(label) : 'var(--primary)';
      return `<div class="bar-row">
        <span class="bl">${esc(label)}</span>
        <span class="bar"><div style="width:${w}%;background:${color}"></div></span>
        <span class="bn">${n}</span>
      </div>`;
    })
    .join('');
}

function openStats() {
  const recs = allRecords;
  const total = recs.length;

  // Bu ay biten sözleşmeler
  const now = new Date();
  const ym = now.getFullYear() * 100 + now.getMonth();
  let endingMonth = 0;
  for (const r of recs) {
    const e = contractEnd(r);
    if (e && e.date.getFullYear() * 100 + e.date.getMonth() === ym) endingMonth++;
  }
  const bald = recs.filter(needsReminder).length;
  const bestaetigt = recs.filter((r) => statusOf(r) === 'bestaetigt').length;
  const quote = total ? Math.round((bestaetigt / total) * 100) : 0;

  const statusEntries = STATUSES.map((s) => [s.label, recs.filter((r) => statusOf(r) === s.key).length]);
  const statusColor = (label) => (STATUSES.find((s) => s.label === label) || {}).fg || 'var(--primary)';
  const brandEntries = countBy(recs, brandOf).slice(0, 10);
  const yearEntries = countBy(recs, yearOf).sort((a, b) => b[0].localeCompare(a[0], 'tr'));

  $('statsBody').innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="num">${total}</div><div class="lbl">Einträge gesamt</div></div>
      <div class="stat-card warn"><div class="num">${bald}</div><div class="lbl">Bald ablaufend</div></div>
      <div class="stat-card warn"><div class="num">${endingMonth}</div><div class="lbl">Diesen Monat ablaufend</div></div>
      <div class="stat-card accent"><div class="num">${quote}%</div><div class="lbl">Bestätigt-Quote</div></div>
    </div>
    <div class="stat-section"><h3>Nach Status</h3>${barRows(statusEntries, statusColor)}</div>
    <div class="stat-section"><h3>Nach Anbieter (Top 10)</h3>${barRows(brandEntries)}</div>
    <div class="stat-section"><h3>Nach Jahr</h3>${barRows(yearEntries)}</div>
  `;
  $('statsOverlay').classList.add('open');
}

function closeStats() {
  $('statsOverlay').classList.remove('open');
}

// ---- Ayarlar modalı ----
const PRESETS = ['7', '14', '30', '60', '90', '180'];

// Markaya özel hatırlatma satırlarını oluştur
function renderFirmaReminderRows() {
  const cont = $('firmaReminderList');
  const firms = getFirmaList();
  const map = settings.firmaReminderDays || {};
  if (!firms.length) {
    cont.innerHTML = '<p class="settings-hint">Noch keine Anbieter. Erscheinen nach dem Hinzufügen von Einträgen.</p>';
    return;
  }
  cont.innerHTML = firms
    .map((f) => {
      const key = normFirma(f);
      const val = map[key] != null ? map[key] : '';
      return `<div class="firma-rem-row">
        <span class="frm-name">${esc(f)}</span>
        <input type="number" min="1" max="3650" data-firma="${esc(f)}" value="${val}" placeholder="${settings.reminderDays}" />
        <span class="frm-unit">Tage</span>
      </div>`;
    })
    .join('');
}

function openSettings() {
  const days = String(settings.reminderDays);
  if (PRESETS.includes(days)) {
    $('reminderPreset').value = days;
    $('customDaysWrap').style.display = 'none';
  } else {
    $('reminderPreset').value = 'custom';
    $('customDaysWrap').style.display = '';
  }
  $('reminderDays').value = days;
  $('notifyOnStartup').checked = !!settings.notifyOnStartup;
  renderFirmaReminderRows();
  $('settingsOverlay').classList.add('open');
}

function closeSettings() {
  $('settingsOverlay').classList.remove('open');
}

async function saveSettings() {
  let days;
  if ($('reminderPreset').value === 'custom') {
    days = parseInt($('reminderDays').value, 10);
    if (!days || days < 1) {
      toast('Bitte geben Sie eine gültige Tagesanzahl ein.', false);
      return;
    }
  } else {
    days = parseInt($('reminderPreset').value, 10);
  }

  // Marka-bazlı eşikleri topla (mevcut overrideları koru, görünen satırlara göre güncelle)
  const map = { ...(settings.firmaReminderDays || {}) };
  $('firmaReminderList')
    .querySelectorAll('input[data-firma]')
    .forEach((inp) => {
      const key = normFirma(inp.dataset.firma);
      const v = parseInt(inp.value, 10);
      if (v && v >= 1) map[key] = v;
      else delete map[key]; // boş = varsayılana dön
    });

  settings = await window.api.setSettings({
    reminderDays: days,
    notifyOnStartup: $('notifyOnStartup').checked,
    firmaReminderDays: map,
  });
  closeSettings();
  toast(`Einstellungen gespeichert (Standard ${days} Tage).`);
  reload(); // yeni eşiklere göre renkler/sayılar güncellensin
}

// ---- Güvenlik: kilit + şifre + yedek ----
async function setupLock() {
  const st = await window.api.authStatus();
  if (!st.enabled) return;
  const ov = $('lockOverlay');
  const input = $('lockInput');
  const err = $('lockError');
  ov.classList.add('open');
  setTimeout(() => input.focus(), 50);
  const tryUnlock = async () => {
    const res = await window.api.authCheck(input.value);
    if (res.ok) {
      ov.classList.remove('open');
      input.value = '';
      err.textContent = '';
    } else {
      err.textContent = 'Falsches Passwort';
      input.value = '';
      input.focus();
    }
  };
  $('lockBtn').addEventListener('click', tryUnlock);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
}

async function savePassword() {
  const cur = $('curPw').value;
  const n1 = $('newPw').value;
  const n2 = $('newPw2').value;
  if (n1 !== n2) { toast('Passwörter stimmen nicht überein.', false); return; }
  const res = await window.api.authSet(cur, n1);
  if (!res.ok) {
    toast(res.reason === 'wrong-old' ? 'Aktuelles Passwort falsch.' : 'Fehler beim Speichern.', false);
    return;
  }
  $('curPw').value = ''; $('newPw').value = ''; $('newPw2').value = '';
  toast(res.enabled ? 'Passwort gesetzt.' : 'Passwort entfernt.');
}

async function doBackup() {
  const res = await window.api.backupNow();
  if (res.canceled) return;
  toast(`Backup gespeichert (${res.file}).`);
}

// Tüm kayıtları sil (test/sıfırlama)
async function clearAllRecords() {
  if (!confirm('ALLE Einträge werden dauerhaft gelöscht. Sind Sie sicher?')) return;
  const n = await window.api.clearAll();
  closeSettings();
  activeFirma = '__ALL__';
  reminderOnly = false;
  toast(`${n} Einträge gelöscht.`);
  reload();
}

// ---- Başlat ----
async function init() {
  setupLock(); // şifre varsa kilit ekranını göster
  const def = await window.api.getFields();
  FIELDS = def.fields;
  GROUPS = def.groups || [];
  FIRMA = def.firma;
  YEAR = def.year || YEAR;
  STATUS = def.status || STATUS;
  STATUSES = def.statuses || [];
  DEFAULT_STATUS = def.defaultStatus || DEFAULT_STATUS;
  BRAND_ALIASES = def.brandAliases || {};
  settings = await window.api.getSettings();
  buildFormFields();

  $('newBtn').addEventListener('click', () => openForm());
  $('cancelBtn').addEventListener('click', closeForm);
  $('form').addEventListener('submit', onSubmit);
  $('importBtn').addEventListener('click', onImport);
  $('exportBtn').addEventListener('click', onExport);
  $('templateBtn').addEventListener('click', onTemplate);
  $('settingsBtn').addEventListener('click', openSettings);
  $('statsBtn').addEventListener('click', openStats);
  $('statsClose').addEventListener('click', closeStats);
  $('statsOverlay').addEventListener('click', (e) => { if (e.target === $('statsOverlay')) closeStats(); });
  $('reminderToggle').addEventListener('click', toggleReminderFilter);
  $('searchInput').addEventListener('input', debounce(applyFilters, 180));
  $('yearFilter').addEventListener('change', () => {
    activeYear = $('yearFilter').value;
    reminderOnly = false; // yıl seçince hatırlatma modundan çık
    updateReminderToggle();
    renderStatusFilter();
    renderTabs();
    applyFilters();
  });
  $('statusFilter').addEventListener('change', () => {
    activeStatus = $('statusFilter').value;
    applyFilters();
  });

  // İçe aktarma ilerleme çubuğu
  window.api.onImportProgress((_e, p) => updateLoading(p.percent, p.label));

  // Ayarlar modalı
  $('settingsSave').addEventListener('click', saveSettings);
  $('settingsCancel').addEventListener('click', closeSettings);
  $('clearAllBtn').addEventListener('click', clearAllRecords);
  $('savePwBtn').addEventListener('click', savePassword);
  $('backupBtn').addEventListener('click', doBackup);
  $('reminderPreset').addEventListener('change', () => {
    $('customDaysWrap').style.display = $('reminderPreset').value === 'custom' ? '' : 'none';
  });
  $('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === $('settingsOverlay')) closeSettings();
  });

  $('overlay').addEventListener('click', (e) => {
    if (e.target === $('overlay')) closeForm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeForm();
      closeSettings();
      closeStats();
    }
  });

  // Ağ senkronizasyonu: bağlı bilgisayar sayısı göstergesi
  const updateSyncStatus = (count) => {
    const el = $('syncStatus');
    if (count > 0) {
      el.classList.add('online');
      el.textContent = count === 1 ? '1 PC verbunden' : `${count} PCs verbunden`;
    } else {
      el.classList.remove('online');
      el.textContent = 'Offline';
    }
  };
  window.api.onPeersChanged(updateSyncStatus);
  window.api.getPeerCount().then(updateSyncStatus);

  // Uzaktan veri değişti: tabloyu tazele + bilgilendir
  window.api.onDataChanged((summary) => {
    reload();
    if (summary && summary.newVisible > 0) {
      toast(
        summary.newVisible === 1
          ? 'Ein Eintrag von einem anderen PC synchronisiert.'
          : `${summary.newVisible} Einträge von einem anderen PC synchronisiert.`
      );
    }
  });

  // Windows bildiriminden gelen "göster" isteği: hatırlatma filtresini aç
  window.api.onShowReminders(() => {
    reminderOnly = true;
    activeFirma = '__ALL__';
    activeStatus = '__ALL__';
    renderStatusFilter();
    renderTabs();
    updateReminderToggle();
    applyFilters();
  });

  await reload();

  // Açılışta + her gün bir kez yaklaşan sözleşme bildirimi
  maybeNotifyReminders();
  // Uygulama tepside açık kaldığı için her saat kontrol et (günde bir kez bildirir)
  setInterval(maybeNotifyReminders, 60 * 60 * 1000);
}

// Günde en fazla bir kez hatırlatma bildirimi gönder
function maybeNotifyReminders() {
  if (!settings.notifyOnStartup) return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (localStorage.getItem('lastReminderNotify') === today) return;
  const n = reminderCount();
  if (n > 0) {
    window.api.notifyReminders(n);
    localStorage.setItem('lastReminderNotify', today);
  }
}

init();
