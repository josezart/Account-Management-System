import { store } from '../store.js';
import { h, section, table, openForm, btn, tabs, kpi, chart } from '../ui.js';
import { ENUMS } from '../schema.js';
import { today, currentPeriods, periodBounds, periodLabel, inRange, fyOf } from '../util.js';
import { setParam } from '../main.js';
import { techCols, poolCols, trainingCols } from './accounts.js';

export default function technicalView({ params }) {
  const tab = params.tab || 'activities';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Técnico'), h('div', { class: 'actions' },
      btn('＋ Atividade técnica', () => openForm('techActivities', { date: today() }), 'primary'),
      btn('＋ Temp key / Tech Pool', () => openForm('techPool', { startDate: today() })),
      btn('＋ Treinamento', () => openForm('trainings', {})))),
    tabs([['activities', 'Atividades técnicas'], ['pool', 'Tech Pool & Temp Keys'], ['trainings', 'Treinamentos']], tab, (k) => setParam('tab', k)),
    tab === 'pool' ? pool() : tab === 'trainings' ? trainings() : activities(params),
  );
}

function activities(params) {
  const db = store.db;
  const fyEnd = db.settings.fyEndMonth;
  const per = currentPeriods(today(), fyEnd);
  const pkey = params.p || per.quarter;
  const b = periodBounds(pkey, fyEnd);
  const inP = db.techActivities.filter((t) => inRange(t.date, b));
  const done = inP.filter((t) => t.status === 'Realizada');
  const byType = ENUMS.techType.map((t) => [t, done.filter((x) => x.type === t).length]).filter(([, n]) => n);
  const linked = done.filter((t) => t.oppId).length;
  const options = [per.quarter, per.year, 'FY' + (fyOf(today(), fyEnd) - 1), 'all'];
  return h('div', null,
    h('div', { class: 'filters' }, h('select', { onchange: (e) => setParam('p', e.target.value) }, options.map((o) => h('option', { value: o, selected: o === pkey }, o === 'all' ? 'Todo o período' : periodLabel(o))))),
    h('div', { class: 'kpis' },
      kpi('Realizadas', done.length, periodLabel(pkey)),
      kpi('Planejadas', inP.filter((t) => t.status === 'Planejada').length, 'no período'),
      kpi('Horas técnicas', done.reduce((s, t) => s + (Number(t.hours) || 0), 0), 'registradas'),
      kpi('Ligadas a oportunidade', done.length ? Math.round((linked / done.length) * 100) + '%' : '—', `${linked} atividades`),
      kpi('Resultado positivo', done.filter((t) => t.result === 'Positivo').length, 'avaliação do cliente'),
      kpi('Contas atendidas', new Set(done.map((t) => t.accountId)).size, 'no período'),
    ),
    byType.length ? section('Por tipo de atividade', null, chart({ type: 'bar', data: { labels: byType.map((x) => x[0]), datasets: [{ data: byType.map((x) => x[1]), backgroundColor: '#4B5563' }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } }, Math.max(140, byType.length * 34))) : null,
    section('Atividades', null, table(pkey === 'all' ? db.techActivities : inP, techCols(true), { onRow: (t) => openForm('techActivities', t), search: true, sort: { key: 'date', dir: -1 } })),
  );
}

function pool() {
  const db = store.db;
  const l = db.techPool;
  const conv = l.filter((p) => p.status === 'Convertida em venda').length;
  const closed = l.filter((p) => ['Convertida em venda', 'Não converteu'].includes(p.status)).length;
  return h('div', null,
    h('div', { class: 'kpis' },
      kpi('Ativas', l.filter((p) => p.status === 'Ativa').length, 'licenças em avaliação'),
      kpi('Solicitadas', l.filter((p) => p.status === 'Solicitada').length, 'aguardando liberação'),
      kpi('Taxa de conversão', closed ? Math.round((conv / closed) * 100) + '%' : '—', `${conv} de ${closed} concluídas`),
      kpi('Sem contrapartida', l.filter((p) => ['Ativa', 'Solicitada'].includes(p.status) && !p.counterpart).length, 'avaliações sem compromisso acordado', 'warn'),
    ),
    section('Sementes plantadas', null, table(l, poolCols(true), { onRow: (p) => openForm('techPool', p), search: true, sort: { key: 'Período', dir: -1 } })),
  );
}

function trainings() {
  const db = store.db;
  const l = db.trainings;
  return h('div', null,
    h('div', { class: 'kpis' },
      kpi('Acessos ativos', l.filter((t) => ['Acesso ativo', 'Em andamento'].includes(t.status)).length, 'Learning Hub, trilhas, cursos'),
      kpi('Planejados', l.filter((t) => t.status === 'Planejado').length, ''),
      kpi('Concluídos', l.filter((t) => t.status === 'Concluído').length, ''),
      kpi('Contas com treinamento', new Set(l.map((t) => t.accountId)).size, `de ${db.accounts.length}`),
    ),
    section('Treinamentos e acessos', null, table(l, trainingCols(true), { onRow: (t) => openForm('trainings', t), search: true })),
  );
}
