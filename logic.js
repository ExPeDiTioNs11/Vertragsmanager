// Paylaşılan saf mantık (DOM/Electron'a bağımsız).
// Hem ana süreç (require) hem renderer (script) hem de testler tarafından kullanılır.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node/test
  if (typeof window !== 'undefined') window.Logic = api; // renderer
})(typeof self !== 'undefined' ? self : this, function () {
  // ---- Tarih ----
  function isValidYMD(y, m, d) {
    y = +y; m = +m; d = +d;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  // "gg.aa.yyyy" / "gg/aa/yyyy" / "yyyy-aa-gg" -> "yyyy-aa-gg" (geçersizse '')
  function toISO(s) {
    s = String(s || '').trim();
    if (!s) return '';
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      d = d.padStart(2, '0');
      mo = mo.padStart(2, '0');
      return isValidYMD(y, mo, d) ? `${y}-${mo}-${d}` : '';
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
      return isValidYMD(y, mo, d) ? `${y}-${mo}-${d}` : '';
    }
    return '';
  }
  function toDE(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateToDE = (dt) => `${pad2(dt.getDate())}.${pad2(dt.getMonth() + 1)}.${dt.getFullYear()}`;
  function parseDE(s) {
    const iso = toISO(s);
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // Aktivasyon + N yıl -> { date, de } veya null
  function contractEndDate(actStr, years) {
    const act = parseDE(actStr);
    if (!act) return null;
    const end = new Date(act.getFullYear() + years, act.getMonth(), act.getDate());
    return { date: end, de: dateToDE(end) };
  }

  // ---- IBAN / telefon ----
  const last4 = (s) => String(s || '').replace(/\D/g, '').slice(-4);

  function formatGermanPhone(input) {
    const s = String(input || '').trim();
    if (!s) return { formatted: '', valid: true };
    const hasPlus = /^\s*\+/.test(s) || s.replace(/\D/g, '').startsWith('00');
    const digits = s.replace(/\D/g, '');
    let national;
    if (digits.startsWith('0049')) national = digits.slice(4);
    else if (digits.startsWith('49') && (hasPlus || digits.length >= 11)) national = digits.slice(2);
    else if (digits.startsWith('0')) national = digits.slice(1);
    else national = digits;
    national = national.replace(/^0+/, '');
    if (national.length < 6 || national.length > 15) return { formatted: s, valid: false };
    const grouped = national.startsWith('1')
      ? national.slice(0, 3) + ' ' + national.slice(3)
      : national;
    return { formatted: '+49 ' + grouped, valid: true };
  }

  // WhatsApp için uluslararası rakam dizisi (Almanya varsayılan)
  function toWhatsAppNumber(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = '49' + d.slice(1);
    else if (!d.startsWith('49') && d.length <= 11) d = '49' + d;
    return d.length >= 8 ? d : null;
  }

  // ---- Diğer ----
  const normFirma = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

  // Dosya adının sonundaki 4 haneli yıl (19xx/20xx)
  function extractYearFromName(basename) {
    const name = String(basename || '').replace(/\.[^.]+$/, '');
    const matches = name.match(/(19|20)\d{2}/g);
    return matches ? matches[matches.length - 1] : null;
  }

  return {
    isValidYMD, toISO, toDE, pad2, dateToDE, parseDE, contractEndDate,
    last4, formatGermanPhone, toWhatsAppNumber, normFirma, extractYearFromName,
  };
});
