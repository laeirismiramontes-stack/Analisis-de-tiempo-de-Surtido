import './style.css';
import { Chart, registerables } from 'chart.js';
import { loadStored, saveStored, parseFile, mergeRecords } from './data.js';
import {
  DIAS, periodKey, periodLabel, listPeriods, timeStats, byHour, heatmap,
  ranking, bestPerPeriod, averages, trend,
} from './analytics.js';

Chart.register(...registerables);
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.color = '#6b7280';

const RED = '#d7181f';
const GRAY = '#9aa3b2';
const OUTLIER_MIN = 120;
const MIN_PEDIDOS = { dia: 5, semana: 20, mes: 50 }; // mínimo para entrar al ranking
const GRAN_TXT = { dia: 'día', semana: 'semana', mes: 'mes' };
const TREND_LIMIT = { dia: 31, semana: 16, mes: 12 };

const $ = (id) => document.getElementById(id);
const state = { records: [], meta: null, gran: 'dia', period: null, plazo: 'ENTREGA INMEDIATA', outliers: true };
const charts = {};

const nf = (x, d = 0) => (x == null ? '—' : x.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const mins = (x) => (x == null ? '—' : `${nf(x, 1)} min`);
const pct = (x) => (x == null ? '—' : `${nf(x * 100, 0)}%`);
const hourTxt = (h) => `${String(h).padStart(2, '0')}:00`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const title = (s) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = err ? 'toast err' : 'toast';
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6000);
}

// ---------- Carga de datos ----------

function renderLoadInfo() {
  const m = state.meta;
  if (!m) {
    $('loadInfo').textContent = 'Sin datos cargados';
    return;
  }
  const when = new Date(m.lastLoad).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  const last = state.records.at(-1)?.date;
  $('loadInfo').innerHTML =
    `<b>Última carga:</b> ${when}<br>` +
    `Datos hasta ${last ? periodLabel(last, 'dia') : '—'} · ${nf(state.records.length)} registros` +
    (m.added != null ? ` · +${nf(m.added)} nuevos` : '');
}

$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  toast(`Procesando ${file.name}…`);
  try {
    const incoming = await parseFile(file);
    if (!incoming.length) throw new Error('No se encontraron registros válidos en el archivo.');
    const { records, added, updated } = mergeRecords(state.records, incoming);
    const meta = { lastLoad: new Date().toISOString(), fileName: file.name, added, updated };
    await saveStored(records, meta);
    state.records = records;
    state.meta = meta;
    state.period = null;
    renderLoadInfo();
    render();
    toast(`Base actualizada: ${nf(added)} registros nuevos, ${nf(updated)} ya existentes (actualizados).`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo leer el archivo.', true);
  }
});

// ---------- Filtros ----------

document.querySelectorAll('#granSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#granSeg button').forEach((x) => x.classList.toggle('on', x === b));
    state.gran = b.dataset.gran;
    state.period = null;
    render();
  }),
);
$('periodSel').addEventListener('change', (e) => {
  state.period = e.target.value;
  render();
});
$('plazoSel').addEventListener('change', (e) => {
  state.plazo = e.target.value;
  render();
});
$('outlierChk').addEventListener('change', (e) => {
  state.outliers = e.target.checked;
  render();
});

// ---------- Render ----------

function render() {
  const has = state.records.length > 0;
  $('empty').hidden = has;
  $('dash').hidden = !has;
  if (!has) return;

  const { gran } = state;
  const base = state.plazo ? state.records.filter((r) => r.plazo === state.plazo) : state.records;
  const timedOf = (recs) => (state.outliers ? recs.filter((r) => r.min <= OUTLIER_MIN) : recs);

  const periods = listPeriods(base, gran);
  if (!state.period || !periods.includes(state.period)) state.period = periods[0];
  $('periodSel').innerHTML = periods
    .map((k) => `<option value="${k}" ${k === state.period ? 'selected' : ''}>${periodLabel(k, gran)}</option>`)
    .join('');

  const recs = base.filter((r) => periodKey(r.date, gran) === state.period);
  const timed = timedOf(recs);
  const lbl = periodLabel(state.period, gran);
  $('subtitle').textContent = `Reporte ZTPOENT · ${state.plazo ? title(state.plazo) : 'Todos los plazos'} · ${lbl}`;

  renderKpis(base, recs, timed);
  renderHours(recs, timed, lbl);
  renderRanking(timed, lbl);
  renderBest(timedOf(base));
  renderTrend(base, timedOf(base));
  renderHeat(recs, lbl);
}

function renderKpis(base, recs, timed) {
  const s = timeStats(timed);
  const days = new Set(recs.map((r) => r.date)).size;
  const avg = averages(base);
  const { ok } = ranking(timed, MIN_PEDIDOS[state.gran]);
  const best = ok[0];
  const hr = byHour(recs, timed).count;
  const peak = hr.indexOf(Math.max(...hr));
  const excl = recs.length - timed.length;

  const kpi = (h, v, d) => `<div class="kpi"><h3>${h}</h3><div class="v">${v}</div><div class="d">${d}</div></div>`;
  $('kpis').innerHTML =
    kpi('Pedidos del periodo', nf(recs.length), state.gran === 'dia' ? 'en el día seleccionado' : `${nf(recs.length / (days || 1), 0)} por día en promedio`) +
    kpi('Tiempo promedio', mins(s.avg), `Mediana ${mins(s.med)} · P90 ${mins(s.p90)}`) +
    kpi('Surtidos en ≤ 10 min', pct(s.fast), excl ? `${nf(excl)} atípicos excluidos` : 'sobre pedidos con tiempo') +
    kpi('Hora pico', recs.length ? `${hourTxt(peak)}` : '—', recs.length ? `${nf(hr[peak])} pedidos en esa hora${state.gran === 'dia' ? '' : ' (total del periodo)'}` : '') +
    kpi('Mejor surtidor', best ? `<span style="font-size:15px">${esc(title(best.who))}</span>` : '—', best ? `${mins(best.avg)} promedio · ${nf(best.n)} pedidos` : `sin surtidores con ≥ ${MIN_PEDIDOS[state.gran]} pedidos`) +
    `<div class="kpi avgs"><h3>Promedio de pedidos (histórico)</h3><div class="rows">
      <div><span>Diario</span><b>${nf(avg.dia)}</b></div>
      <div><span>Semanal</span><b>${nf(avg.semana)}</b></div>
      <div><span>Mensual</span><b>${nf(avg.mes)}</b></div></div></div>`;
}

function renderHours(recs, timed, lbl) {
  const days = new Set(recs.map((r) => r.date)).size || 1;
  const { count, avg } = byHour(recs, timed);
  const perDay = count.map((c) => c / days);
  const active = count.map((c, h) => [h, c]).filter(([, c]) => c > 0);
  const hours = active.length ? [active[0][0], active.at(-1)[0]] : [0, 23];
  const idx = [];
  for (let h = hours[0]; h <= hours[1]; h++) idx.push(h);

  const top = [...active].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h);
  const slow = idx
    .filter((h) => count[h] >= Math.max(3, recs.length * 0.02) && avg[h] != null)
    .sort((a, b) => avg[b] - avg[a])
    .slice(0, 2);

  $('hoursSub').textContent = `${lbl} · por hora de pago${days > 1 ? ' · promedio por día' : ''}`;
  $('criticalChips').innerHTML =
    top.map((h) => `<span class="chip">🔥 ${hourTxt(h)}–${hourTxt(h + 1)} · ${nf(perDay[h], days > 1 ? 1 : 0)} pedidos</span>`).join('') +
    slow.map((h) => `<span class="chip alt">⏱ ${hourTxt(h)} más lenta · ${mins(avg[h])}</span>`).join('');

  const data = {
    labels: idx.map(hourTxt),
    datasets: [
      {
        type: 'bar', label: days > 1 ? 'Pedidos promedio por día' : 'Pedidos', yAxisID: 'y',
        data: idx.map((h) => perDay[h]),
        backgroundColor: idx.map((h) => (top.includes(h) ? RED : '#f3b3b5')), borderRadius: 4, order: 2,
      },
      {
        type: 'line', label: 'Tiempo promedio (min)', yAxisID: 'y1',
        data: idx.map((h) => avg[h]), borderColor: '#374151', backgroundColor: '#374151',
        tension: 0.3, pointRadius: 3, spanGaps: true, order: 1,
      },
    ],
  };
  drawChart('hourChart', data, {
    y: { beginAtZero: true, title: { display: true, text: 'Pedidos' }, grid: { color: '#eef0f3' } },
    y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Minutos' }, grid: { display: false } },
    x: { grid: { display: false } },
  });
}

function renderRanking(timed, lbl) {
  const minN = MIN_PEDIDOS[state.gran];
  const { ok, few } = ranking(timed, minN);
  $('rankSub').textContent = `${lbl} · menor tiempo promedio primero`;
  if (!ok.length && !few.length) {
    $('ranking').innerHTML = '<p class="muted">Sin datos en este periodo.</p>';
    return;
  }
  const maxN = Math.max(...ok.map((r) => r.n), 1);
  const row = (r, i) => `<tr class="${i === 0 ? 'best' : ''}">
      <td>${i === 0 ? '🏆 ' : `${i + 1}. `}${esc(title(r.who))}</td>
      <td class="num">${nf(r.n)}<div class="bar" style="width:${(r.n / maxN) * 100}%"></div></td>
      <td class="num">${mins(r.avg)}</td><td class="num">${mins(r.med)}</td><td class="num">${pct(r.fast)}</td></tr>`;
  $('ranking').innerHTML = `<table>
    <thead><tr><th>Surtidor</th><th class="num">Pedidos</th><th class="num">Promedio</th><th class="num">Mediana</th><th class="num">≤ 10 min</th></tr></thead>
    <tbody>${ok.map(row).join('')}</tbody></table>
    ${few.length ? `<p class="note">No clasifican (menos de ${minN} pedidos): ${few.map((r) => `${esc(title(r.who))} (${r.n})`).join(', ')}</p>` : ''}`;
}

function renderBest(timedAll) {
  const { gran } = state;
  $('bestGranLbl').textContent = GRAN_TXT[gran];
  const rows = bestPerPeriod(timedAll, gran, MIN_PEDIDOS[gran], TREND_LIMIT[gran]);
  $('bestTable').innerHTML = `<table>
    <thead><tr><th>${title(GRAN_TXT[gran])}</th><th>Mejor surtidor</th><th class="num">Promedio</th><th class="num">Pedidos</th><th>2º lugar</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr class="${r.key === state.period ? 'best' : ''}">
        <td>${periodLabel(r.key, gran)}</td>
        <td>${r.best ? esc(title(r.best.who)) : '<span class="muted">—</span>'}</td>
        <td class="num">${r.best ? mins(r.best.avg) : '—'}</td>
        <td class="num">${r.best ? nf(r.best.n) : '—'}</td>
        <td class="muted">${r.second ? `${esc(title(r.second.who))} (${mins(r.second.avg)})` : '—'}</td></tr>`,
      )
      .join('')}</tbody></table>
    <p class="note">Solo compiten surtidores con al menos ${MIN_PEDIDOS[gran]} pedidos en el ${GRAN_TXT[gran]}.</p>`;
}

function renderTrend(base, timedAll) {
  const { gran } = state;
  const t = trend(base, timedAll, gran, TREND_LIMIT[gran]);
  $('trendSub').textContent = `últimos ${t.length} ${gran === 'dia' ? 'días' : gran === 'semana' ? 'semanas' : 'meses'}`;
  drawChart(
    'trendChart',
    {
      labels: t.map((x) => periodLabel(x.key, gran, true)),
      datasets: [
        { type: 'bar', label: 'Pedidos', yAxisID: 'y', data: t.map((x) => x.n), backgroundColor: t.map((x) => (x.key === state.period ? RED : '#f3b3b5')), borderRadius: 4, order: 2 },
        { type: 'line', label: 'Tiempo promedio (min)', yAxisID: 'y1', data: t.map((x) => x.avg), borderColor: '#374151', backgroundColor: '#374151', tension: 0.3, pointRadius: 2, order: 1 },
        { type: 'line', label: 'Mediana (min)', yAxisID: 'y1', data: t.map((x) => x.med), borderColor: GRAY, borderDash: [4, 4], pointRadius: 0, tension: 0.3, order: 1 },
      ],
    },
    {
      y: { beginAtZero: true, title: { display: true, text: 'Pedidos' }, grid: { color: '#eef0f3' } },
      y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Minutos' }, grid: { display: false } },
      x: { grid: { display: false } },
    },
  );
}

function renderHeat(recs, lbl) {
  const grid = heatmap(recs);
  const hours = [];
  for (let h = 0; h < 24; h++) if (grid.some((row) => row[h] > 0)) hours.push(h);
  $('heatSub').textContent = lbl;
  if (!hours.length) {
    $('heatmap').innerHTML = '<p class="muted">Sin datos.</p>';
    return;
  }
  const max = Math.max(...grid.flat(), 1);
  const cell = (v) => {
    const a = v / max;
    const color = a > 0 ? `rgba(215,24,31,${0.08 + a * 0.85})` : '#f6f7f9';
    return `<td style="background:${color};color:${a > 0.55 ? '#fff' : '#1f2430'}" title="${nf(v, 1)} pedidos">${v ? nf(v, v < 10 ? 1 : 0) : ''}</td>`;
  };
  $('heatmap').innerHTML = `<table class="heat">
    <thead><tr><th></th>${hours.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${grid
      .map((row, wd) => (row.some((v) => v > 0) ? `<tr><th class="rowh">${DIAS[wd]}</th>${hours.map((h) => cell(row[h])).join('')}</tr>` : ''))
      .join('')}</tbody></table>
    <p class="note">Pedidos promedio por día de la semana en cada hora (hora de pago). Más intenso = más carga.</p>`;
}

function drawChart(id, data, scales) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), {
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${nf(c.parsed.y, 1)}` } },
      },
      scales,
    },
  });
}

// ---------- Inicio ----------

(async () => {
  try {
    const { records, meta } = await loadStored();
    state.records = records;
    state.meta = meta;
  } catch (err) {
    console.error(err);
    toast('No se pudo abrir el almacenamiento local del navegador.', true);
  }
  renderLoadInfo();
  render();
})();
