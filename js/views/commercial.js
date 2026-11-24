import { store } from '../store.js';
import { h, section, table, openForm, btn, tabs, kpi, chart, stageBadge } from '../ui.js';
import { isOpenOpp, accName, meddicScore } from '../engine.js';
import { ENUMS } from '../schema.js';
import { fmt, today, fyOf, currentPeriods, periodBounds } from '../util.js';
import { setParam } from '../main.js';
import { oppCols, saleCols, meddicBar } from './accounts.js';

export default function commercialView({ params }) {
  const db = store.db;
  const tab = params.tab || 'pipeline';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Comercial'), h('div', { class: 'actions' }, btn('＋ Oportunidade', () => openForm('opportunities', {}), 'primary'), btn('＋ Venda fechada', () => openForm('sales', { date: today() })))),
    tabs([['pipeline', 'Pipeline (quadro)'], ['list', 'Oportunidades (lista)'], ['sales', 'Histórico de vendas']], tab, (k) => setParam('tab', k)),
    tab === 'pipeline' ? board(db) : tab === 'list' ? list(db, params) : sales(db),
  );
}

function board(db) {
  const open = db.opportunities.filter(isOpenOpp);
  const stages = ENUMS.oppStage.filter((s) => !['Ganha', 'Perdida'].includes(s));
  const fyEnd = periodBounds(currentPeriods(today(), db.settings.fyEndMonth).year, db.settings.fyEndMonth).end;
  const inFy = open.filter((o) => o.closeDate && o.closeDate <= fyEnd && o.stage !== 'Em espera');
  const sum = (arr) => arr.reduce((s, o) => s + ((o.currency || 'BRL') === 'BRL' ? Number(o.value) || 0 : 0), 0);
  const weighted = open.filter((o) => o.stage !== 'Em espera').reduce((s, o) => s + ((o.currency || 'BRL') === 'BRL' ? (Number(o.value) || 0) * (Number(o.probability) || 0) / 100 : 0), 0);
  return h('div', null,
    h('div', { class: 'kpis' },
      kpi('Pipeline aberto', fmt.compact(sum(open.filter((o) => o.stage !== 'Em espera'))), `${open.length} oportunidades (BRL)`),
      kpi('Ponderado', fmt.compact(weighted), 'valor × probabilidade'),
      kpi('Fecha no FY atual', fmt.compact(sum(inFy)), `${inFy.length} oportunidades até ${fmt.date(fyEnd)}`),
      kpi('MEDDIC médio', open.length ? (open.reduce((s, o) => s + meddicScore(o), 0) / open.length).toFixed(1) + '/6' : '—', 'qualificação das oportunidades'),
    ),
    h('div', { class: 'kanban wide' }, stages.map((st) => {
      const l = open.filter((o) => o.stage === st);
      return h('div', { class: 'col' },
        h('div', { class: 'col-head' }, st, h('span', { class: 'count' }, l.length)),
        h('small', { class: 'muted block col-sum' }, fmt.compact(sum(l))),
        l.map((o) => h('div', { class: 'task', onclick: () => openForm('opportunities', o) },
          h('b', null, o.name), h('small', { class: 'block muted' }, accName(o.accountId)),
          h('div', { class: 'task-meta' }, o.value ? h('span', null, fmt.money(o.value, o.currency)) : null, o.closeDate ? h('small', null, '⏱ ' + fmt.date(o.closeDate)) : null, meddicBar(o)),
          o.nextStep ? h('small', { class: 'block' }, '→ ' + o.nextStep) : null)));
    })),
  );
}

function list(db, params) {
  const showClosed = params.closed === '1';
  const rows = db.opportunities.filter((o) => showClosed || isOpenOpp(o));
  return section(`${rows.length} oportunidades`, h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: showClosed, onchange: (e) => setParam('closed', e.target.checked ? '1' : '') }), ' mostrar ganhas/perdidas'),
    table(rows, oppCols(true), { onRow: (o) => openForm('opportunities', o), search: true, sort: { key: 'closeDate', dir: 1 } }));
}

function sales(db) {
  const fyEnd = db.settings.fyEndMonth;
  const byFy = {};
  db.sales.forEach((s) => {
    if (!s.date) return;
    const fy = 'FY' + fyOf(s.date, fyEnd);
    byFy[fy] = byFy[fy] || { total: 0, renov: 0, nb: 0 };
    const v = (s.currency || 'BRL') === 'BRL' ? Number(s.value) || 0 : 0;
    byFy[fy].total += v;
    if (s.type === 'Renovação') byFy[fy].renov += v;
    else byFy[fy].nb += v;
  });
  const labels = Object.keys(byFy).sort();
  return h('div', null,
    labels.length ? section('Vendas por ano fiscal (BRL)', null, chart({
      type: 'bar',
      data: { labels, datasets: [{ label: 'New Business / expansão', data: labels.map((l) => byFy[l].nb), backgroundColor: '#E11423' }, { label: 'Renovação', data: labels.map((l) => byFy[l].renov), backgroundColor: '#4B5563' }] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
    })) : null,
    section(`${db.sales.length} vendas registradas`, null, table(db.sales, saleCols(true), { onRow: (s) => openForm('sales', s), search: true, sort: { key: 'date', dir: -1 }, empty: 'Nenhuma venda registrada. Envie a planilha de histórico para importar.' })),
  );
}
