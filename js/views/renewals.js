import { store } from '../store.js';
import { h, section, table, openForm, btn, kpi, chart, tabs, badge } from '../ui.js';
import { ENUMS, QUARTERS } from '../schema.js';
import { today, addDays, fmt, fyOf } from '../util.js';
import { setParam } from '../main.js';
import { quarterKey, accPath } from '../engine.js';
import { licenseCols, mrpCols, saleCols } from './accounts.js';

export default function renewalsView({ params }) {
  const tab = params.tab || 'mrp';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Renovações, licenças e vendas'), h('div', { class: 'actions' },
      btn('＋ MRP', () => openForm('mrp', { period: quarterKey() }), 'primary'), btn('＋ Licença', () => openForm('licenses', {})), btn('＋ Venda', () => openForm('sales', { date: today() })))),
    tabs([['mrp', 'MRP por trimestre'], ['licenses', 'Licenças (portal)'], ['sales', 'Histórico de vendas']], tab, (k) => setParam('tab', k)),
    tab === 'licenses' ? licenses(params) : tab === 'sales' ? sales() : mrp(params),
  );
}

function mrp(params) {
  const db = store.db;
  const qk = quarterKey();
  const fy = params.fy || qk.slice(0, 6);
  const qs = [1, 2, 3, 4].map((i) => `${fy}-T${i}`);
  const rows = db.mrp.filter((m) => m.period.startsWith(fy));
  const sum = (arr, k = 'value') => arr.reduce((s, m) => s + (Number(m[k]) || 0), 0);
  const fys = [...new Set(db.mrp.map((m) => m.period.slice(0, 6)))].sort();
  if (!fys.includes(fy)) fys.push(fy);
  const done = rows.filter((m) => ['Renovado', 'Renovado parcial'].includes(m.status));
  return h('div', null,
    h('div', { class: 'filters' }, h('select', { onchange: (e) => setParam('fy', e.target.value) }, fys.map((f) => h('option', { value: f, selected: f === fy }, `Ano fiscal ${f.slice(2)}`)))),
    h('div', { class: 'kpis' },
      kpi(`MRP ${fy.replace('FY20', 'FY')}`, fmt.usd(sum(rows)), `${new Set(rows.map((m) => m.accountId)).size} contas`),
      ...qs.map((q) => {
        const r = rows.filter((m) => m.period === q);
        const ren = sum(r.filter((m) => m.status !== 'Aberto'), 'renewed');
        return kpi(q.replace('FY20', 'FY').replace('-T', ' · Q'), fmt.usd(sum(r)), r.length ? `${r.filter((m) => m.status === 'Aberto').length} abertas · renovado ${fmt.usd(ren)}` : 'sem MRP', q === qk ? 'warn' : '');
      }),
      kpi('Renovado / MRP', sum(rows) ? Math.round((sum(done, 'renewed') / sum(rows)) * 100) + '%' : '—', `${fmt.usd(sum(done, 'renewed'))} renovados`),
    ),
    section(`MRP do ${fy.replace('FY', 'ano fiscal ')}`, h('small', { class: 'muted' }, 'Maximum Renewal Possible · USD NTA · clique para registrar o valor renovado'),
      table(rows, mrpCols(true), { onRow: (m) => openForm('mrp', m), sort: { key: 'period', dir: 1 }, search: rows.length > 10, empty: 'Nenhum MRP para este ano fiscal.' })),
  );
}

function licenses(params) {
  const db = store.db;
  const ref = today();
  const st = params.status || 'ativas';
  const win = params.win || '';
  let rows = db.licenses;
  if (st === 'ativas') rows = rows.filter((l) => ['Ativa', 'Não iniciada'].includes(l.status));
  else if (st) rows = rows.filter((l) => l.status === st || l.maintenance === st);
  if (win) rows = rows.filter((l) => l.renewalDate && l.renewalDate >= ref && l.renewalDate <= addDays(ref, Number(win)) && l.type !== 'Perpetual');
  const active = db.licenses.filter((l) => l.status === 'Ativa');
  const lease = active.filter((l) => l.type !== 'Perpetual' && l.renewalDate && l.renewalDate >= ref);
  return h('div', null,
    h('div', { class: 'kpis' },
      kpi('Itens ativos', active.length, `${new Set(active.map((l) => l.accountId)).size} contas`),
      kpi('Expiram em 60 dias', lease.filter((l) => l.renewalDate <= addDays(ref, 60)).length, 'leases e temp keys', 'warn', () => setParam('win', '60')),
      kpi('Não iniciadas', db.licenses.filter((l) => l.status === 'Não iniciada').length, 'contratadas, a começar', '', () => setParam('status', 'Não iniciada')),
      kpi('Perpétuas c/ manutenção vencida', db.licenses.filter((l) => l.maintenance === 'Manutenção vencida').length, 'candidatas a reativação', 'risk', () => setParam('status', 'Manutenção vencida')),
      kpi('Expiradas', db.licenses.filter((l) => l.status === 'Expirada').length, 'histórico — whitespace de reativação', '', () => setParam('status', 'Expirada')),
    ),
    h('div', { class: 'filters' },
      h('select', { onchange: (e) => setParam('status', e.target.value) }, [['ativas', 'Ativas + não iniciadas'], ['', 'Todas'], ...ENUMS.licenseStatus.map((s) => [s, s]), ['Manutenção vencida', 'Manutenção vencida']].map(([v, l]) => h('option', { value: v, selected: v === st }, l))),
      h('select', { onchange: (e) => setParam('win', e.target.value) }, [['', 'Qualquer data'], ['30', 'Expira em 30 dias'], ['60', 'Expira em 60 dias'], ['90', 'Expira em 90 dias'], ['180', 'Expira em 180 dias'], ['365', 'Expira em 12 meses']].map(([v, l]) => h('option', { value: v, selected: v === win }, l))),
    ),
    section(`${rows.length} itens`, h('small', { class: 'muted' }, 'fonte: Ansys Licensing Portal'), table(rows, licenseCols(true), { onRow: (l) => openForm('licenses', l), search: true, sort: { key: 'renewalDate', dir: 1 } })),
  );
}

function sales() {
  const db = store.db;
  const fe = db.settings.fyEndMonth;
  const byFy = {};
  db.sales.forEach((s) => {
    if (!s.date) return;
    const k = 'FY' + String(fyOf(s.date, fe)).slice(2);
    byFy[k] = byFy[k] || { NB: 0, RR: 0, Compliance: 0 };
    byFy[k][s.type || 'NB'] += Number(s.value) || 0;
  });
  const labels = Object.keys(byFy).sort();
  return h('div', null,
    labels.length ? section('Vendas por ano fiscal (USD NTA)', null, chart({
      type: 'bar',
      data: { labels, datasets: [{ label: 'New Business', data: labels.map((l) => byFy[l].NB), backgroundColor: '#E11423' }, { label: 'Renewals', data: labels.map((l) => byFy[l].RR), backgroundColor: '#4B5563' }, { label: 'Compliance', data: labels.map((l) => byFy[l].Compliance), backgroundColor: '#D1D5DB' }] },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.usd(c.raw)}` } } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmt.usd(v) } } } },
    })) : null,
    section(`${db.sales.length} vendas`, h('small', { class: 'muted' }, 'fonte: Salesforce (Territory Review) · sem serviços e treinamentos'), table(db.sales, saleCols(true), { onRow: (s) => openForm('sales', s), search: true, sort: { key: 'date', dir: -1 }, pageSize: 200 })),
  );
}
