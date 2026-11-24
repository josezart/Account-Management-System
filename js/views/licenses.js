import { store } from '../store.js';
import { h, section, table, openForm, btn, kpi, chart } from '../ui.js';
import { ENUMS } from '../schema.js';
import { today, addDays, addMonths, monthLabel, fmt } from '../util.js';
import { setParam } from '../main.js';
import { licenseCols } from './accounts.js';

export default function licensesView({ params }) {
  const db = store.db;
  const ref = today();
  const st = params.status || '';
  const win = params.win || '';
  let rows = db.licenses;
  if (st) rows = rows.filter((l) => l.status === st);
  if (win) rows = rows.filter((l) => l.renewalDate && l.renewalDate >= ref && l.renewalDate <= addDays(ref, Number(win)));
  const active = db.licenses.filter((l) => l.status === 'Ativa' || l.status === 'Em renovação');
  const months = [...Array(12)].map((_, i) => addMonths(ref.slice(0, 7) + '-01', i).slice(0, 7));
  const upcoming = db.licenses.filter((l) => l.renewalDate && l.renewalDate >= ref && !['Cancelada', 'Proposta'].includes(l.status));
  const noDate = active.filter((l) => !l.renewalDate).length;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Licenças e renovações'), h('div', { class: 'actions' }, btn('＋ Licença', () => openForm('licenses', {}), 'primary'))),
    h('div', { class: 'kpis' },
      kpi('Licenças ativas', active.length, `${new Set(active.map((l) => l.accountId)).size} contas`),
      kpi('Renovam em 90 dias', upcoming.filter((l) => l.renewalDate <= addDays(ref, 90)).length, 'clique para filtrar', 'warn', () => setParam('win', '90')),
      kpi('Renovam em 12 meses', upcoming.filter((l) => l.renewalDate <= addDays(ref, 365)).length, '', '', () => setParam('win', '365')),
      kpi('TECS expirado', db.licenses.filter((l) => l.status === 'TECS expirado').length, 'oportunidades de reativação', 'risk', () => setParam('status', 'TECS expirado')),
      kpi('Sem data de renovação', noDate, 'complete o cadastro', noDate ? 'warn' : ''),
    ),
    section('Calendário de renovações (12 meses)', null, chart({
      type: 'bar',
      data: { labels: months.map(monthLabel), datasets: [{ label: 'Itens a renovar', data: months.map((m) => upcoming.filter((l) => l.renewalDate.startsWith(m)).length), backgroundColor: '#F59E0B' }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    }, 170)),
    h('div', { class: 'filters' },
      h('select', { onchange: (e) => setParam('status', e.target.value) }, h('option', { value: '' }, 'Todos os status'), ENUMS.licenseStatus.map((s) => h('option', { selected: s === st }, s))),
      h('select', { onchange: (e) => setParam('win', e.target.value) }, [['', 'Qualquer data'], ['30', 'Renova em 30 dias'], ['90', 'Renova em 90 dias'], ['180', 'Renova em 180 dias'], ['365', 'Renova em 12 meses']].map(([v, l]) => h('option', { value: v, selected: v === win }, l))),
    ),
    section(`${rows.length} itens`, null, table(rows, licenseCols(true), { onRow: (l) => openForm('licenses', l), search: true, sort: { key: 'renewalDate', dir: 1 } })),
  );
}
