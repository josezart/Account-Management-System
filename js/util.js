// Utilidades de data, formatação, ano fiscal e ids.
const pad = (n) => String(n).padStart(2, '0');

export function uid(prefix = '') {
  return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today() {
  return toISO(new Date());
}
function parse(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function addMonths(s, n) {
  const d = parse(s);
  d.setMonth(d.getMonth() + n);
  return toISO(d);
}
// b - a, em dias
export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((parse(b) - parse(a)) / 86400000);
}
export function weekStart(s = today()) {
  const d = parse(s);
  const wd = (d.getDay() + 6) % 7; // segunda = 0
  d.setDate(d.getDate() - wd);
  return toISO(d);
}
export function maxDate(arr) {
  const v = arr.filter(Boolean).sort();
  return v.length ? v[v.length - 1] : null;
}
export function minDate(arr) {
  const v = arr.filter(Boolean).sort();
  return v.length ? v[0] : null;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]}/${String(y).slice(2)}`;
};

export const fmt = {
  date(s) {
    if (!s) return '—';
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  },
  dateShort(s) {
    if (!s) return '—';
    const [, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}`;
  },
  usd(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
    const n = Number(v);
    const a = Math.abs(n);
    if (a >= 1e6) return '$' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: a >= 1e5 ? 0 : 1 }) + 'k';
    return '$' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  },
  usdFull(v) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
    return 'US$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  },
  money(v, cur = 'USD') {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—';
    try {
      return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: cur || 'BRL', maximumFractionDigits: 0 });
    } catch {
      return 'R$ ' + Number(v).toLocaleString('pt-BR');
    }
  },
  compact(v) {
    return fmt.usd(v || 0);
  },
  rel(s, ref = today()) {
    if (!s) return '—';
    const d = daysBetween(ref, s);
    if (d === 0) return 'hoje';
    if (d === 1) return 'amanhã';
    if (d === -1) return 'ontem';
    return d > 0 ? `em ${d} d` : `há ${-d} d`;
  },
  dt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
};

// ---------- Ano fiscal (termina no mês fyEndMonth; padrão outubro) ----------
export function fyOf(s, fyEnd = 10) {
  const [y, m] = s.split('-').map(Number);
  return m > fyEnd ? y + 1 : y;
}
export function fyQuarterOf(s, fyEnd = 10) {
  const m = Number(s.split('-')[1]);
  const start = (fyEnd % 12) + 1;
  return Math.floor(((m - start + 12) % 12) / 3) + 1;
}
// Retorna {start, end} (inclusive) para chaves 'FY2027', 'FY2027-T1' ou '2026-11'
export function periodBounds(key, fyEnd = 10) {
  if (/^FY\d{4}$/.test(key)) {
    const fy = Number(key.slice(2));
    const start = `${fyEnd === 12 ? fy : fy - 1}-${pad((fyEnd % 12) + 1)}-01`;
    const end = addDays(addMonths(start, 12), -1);
    return { start, end };
  }
  if (/^FY\d{4}-T[1-4]$/.test(key)) {
    const fy = Number(key.slice(2, 6));
    const q = Number(key.slice(-1));
    const fyStart = periodBounds('FY' + fy, fyEnd).start;
    const start = addMonths(fyStart, (q - 1) * 3);
    return { start, end: addDays(addMonths(start, 3), -1) };
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const start = key + '-01';
    return { start, end: addDays(addMonths(start, 1), -1) };
  }
  return { start: '0000-01-01', end: '9999-12-31' };
}
export function currentPeriods(s = today(), fyEnd = 10) {
  const fy = fyOf(s, fyEnd);
  return { year: 'FY' + fy, quarter: `FY${fy}-T${fyQuarterOf(s, fyEnd)}`, month: s.slice(0, 7) };
}
export function periodLabel(key) {
  if (/^FY\d{4}$/.test(key)) return `Ano fiscal ${key.slice(2)}`;
  if (/^FY\d{4}-T[1-4]$/.test(key)) return `Q${key.slice(-1)} FY${key.slice(4, 6)}`;
  if (/^\d{4}-\d{2}$/.test(key)) return monthLabel(key);
  return key;
}
export const inRange = (d, b) => d && d >= b.start && d <= b.end;

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
