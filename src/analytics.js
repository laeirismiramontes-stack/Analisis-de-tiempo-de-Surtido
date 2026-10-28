// Cálculos de tiempos de surtido por periodo, hora y surtidor.

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const parseDate = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
const fmt = (d) => d.toISOString().slice(0, 10);
const weekday = (s) => (parseDate(s).getUTCDay() + 6) % 7; // 0 = lunes

export function periodKey(date, gran) {
  if (gran === 'dia') return date;
  if (gran === 'mes') return date.slice(0, 7);
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() - weekday(date));
  return fmt(d);
}

export function periodLabel(key, gran, short = false) {
  if (gran === 'mes') return `${MESES[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
  const d = parseDate(key);
  const dm = (x) => `${String(x.getUTCDate()).padStart(2, '0')} ${MESES[x.getUTCMonth()]}`;
  if (gran === 'dia') return short ? dm(d) : `${DIAS[weekday(key)]} ${dm(d)} ${key.slice(0, 4)}`;
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 6);
  return short ? dm(d) : `${dm(d)} – ${dm(end)} ${end.getUTCFullYear()}`;
}

export function groupBy(records, keyFn) {
  const m = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export const listPeriods = (records, gran) =>
  [...new Set(records.map((r) => periodKey(r.date, gran)))].sort().reverse();

export function timeStats(recs) {
  if (!recs.length) return { n: 0, avg: null, med: null, p90: null, fast: null };
  const t = recs.map((r) => r.min).sort((a, b) => a - b);
  const q = (p) => t[Math.min(t.length - 1, Math.floor(t.length * p))];
  return {
    n: t.length,
    avg: t.reduce((s, x) => s + x, 0) / t.length,
    med: q(0.5),
    p90: q(0.9),
    fast: t.filter((x) => x <= 10).length / t.length,
  };
}

// Pedidos y tiempo promedio por hora del día (hora de pago).
export function byHour(recs, timed) {
  const count = Array(24).fill(0);
  const sum = Array(24).fill(0);
  const n = Array(24).fill(0);
  for (const r of recs) count[r.hour]++;
  for (const r of timed) {
    sum[r.hour] += r.min;
    n[r.hour]++;
  }
  return { count, avg: sum.map((s, i) => (n[i] ? s / n[i] : null)) };
}

// Mapa de calor: promedio de pedidos por día de la semana × hora.
export function heatmap(recs) {
  const grid = DIAS.map(() => Array(24).fill(0));
  const daysPerWd = DIAS.map(() => new Set());
  for (const r of recs) {
    const wd = weekday(r.date);
    grid[wd][r.hour]++;
    daysPerWd[wd].add(r.date);
  }
  return grid.map((row, wd) => row.map((c) => (daysPerWd[wd].size ? c / daysPerWd[wd].size : 0)));
}

export function ranking(timed, minN) {
  const rows = [];
  for (const [who, recs] of groupBy(timed, (r) => r.who)) {
    rows.push({ who, user: recs[0].user, ...timeStats(recs) });
  }
  const ok = rows.filter((r) => r.n >= minN).sort((a, b) => a.avg - b.avg);
  const few = rows.filter((r) => r.n < minN).sort((a, b) => b.n - a.n);
  return { ok, few };
}

// Mejor surtidor (menor tiempo promedio) en cada periodo.
export function bestPerPeriod(timed, gran, minN, limit) {
  const groups = groupBy(timed, (r) => periodKey(r.date, gran));
  return [...groups.keys()]
    .sort()
    .reverse()
    .slice(0, limit)
    .map((k) => {
      const { ok } = ranking(groups.get(k), minN);
      return { key: k, total: groups.get(k).length, best: ok[0] || null, second: ok[1] || null };
    });
}

// Promedio de pedidos por día / semana / mes sobre todo el histórico.
export function averages(recs) {
  const per = (g) => {
    const m = groupBy(recs, (r) => periodKey(r.date, g));
    return m.size ? recs.length / m.size : 0;
  };
  return { dia: per('dia'), semana: per('semana'), mes: per('mes') };
}

export function trend(recs, timed, gran, limit) {
  const all = groupBy(recs, (r) => periodKey(r.date, gran));
  const tg = groupBy(timed, (r) => periodKey(r.date, gran));
  const keys = [...all.keys()].sort().slice(-limit);
  return keys.map((k) => ({ key: k, n: all.get(k).length, ...pick(timeStats(tg.get(k) || [])) }));
}
const pick = ({ avg, med }) => ({ avg, med });
