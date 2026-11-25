import { store, upsert } from '../store.js';
import { openForm, table } from '../ui.js';
import { quotaSummary, quotaFor } from '../engine.js';
import { engagementCols } from './accounts.js';
import { inRange } from '../util.js';
import { h, section, btn, tabs, kpi, modal, toast, badge, confirmBox, accountOptions } from '../ui.js';
import { periodMetrics, accName } from '../engine.js';
import { ENUMS } from '../schema.js';
import { fmt, today, addMonths, currentPeriods, periodBounds, periodLabel, uid, fyOf, fyQuarterOf } from '../util.js';
import { setParam } from '../main.js';

const LEVELS = [['year', 'Anual'], ['quarter', 'Trimestral'], ['month', 'Mensal']];

function shift(key, n) {
  if (/^FY\d{4}$/.test(key)) return 'FY' + (Number(key.slice(2)) + n);
  if (/^FY\d{4}-T\d$/.test(key)) {
    let fy = Number(key.slice(2, 6));
    let q = Number(key.slice(-1)) + n;
    while (q > 4) (q -= 4), fy++;
    while (q < 1) (q += 4), fy--;
    return `FY${fy}-T${q}`;
  }
  return addMonths(key + '-01', n).slice(0, 7);
}
function parentKeys(key, fyEnd) {
  if (/^FY\d{4}-T\d$/.test(key)) return [key.slice(0, 6)];
  if (/^\d{4}-\d{2}$/.test(key)) {
    const d = key + '-01';
    const fy = fyOf(d, fyEnd);
    return [`FY${fy}-T${fyQuarterOf(d, fyEnd)}`, 'FY' + fy];
  }
  return [];
}
const STATUS_CLS = { 'Atingido': 'ok', 'No caminho': 'info', 'Em risco': 'warn', 'Não atingido': 'risk', 'Não iniciado': 'muted' };

export default function planningView({ params }) {
  const db = store.db;
  const fyEnd = db.settings.fyEndMonth;
  const level = params.level || 'quarter';
  const cur = currentPeriods(today(), fyEnd);
  const key = params.p || cur[level];
  const plan = db.plans.find((p) => p.period === key) || { level, period: key, focus: '', goals: [], notes: '' };
  const m = periodMetrics(key);
  const b = periodBounds(key, fyEnd);
  const parents = parentKeys(key, fyEnd).map((k) => db.plans.find((p) => p.period === k)).filter(Boolean);
  const parentGoals = parents.flatMap((p) => p.goals.map((g) => ({ ...g, from: p.period })));

  const savePlan = (changes) => upsert('plans', { ...plan, level, ...changes });
  const goalForm = (g = {}) => {
    const text = h('input', { value: g.text || '', placeholder: 'Ex.: Renovar contrato do CPSN com crescimento' });
    const motor = h('select', null, h('option', { value: '' }, '—'), ENUMS.growthMotor.map((x) => h('option', { selected: g.motor === x }, x)));
    const acc = h('select', null, h('option', { value: '' }, 'Carteira toda'), accountOptions().map((a) => h('option', { value: a.id, selected: g.accountId === a.id }, a.label)));
    const metric = h('input', { value: g.metric || '', placeholder: 'Ex.: nº de visitas, R$ fechado, nº de PoCs' });
    const target = h('input', { type: 'number', step: 'any', value: g.target ?? '' });
    const current = h('input', { type: 'number', step: 'any', value: g.current ?? '' });
    const status = h('select', null, ENUMS.goalStatus.map((x) => h('option', { selected: (g.status || 'Não iniciado') === x }, x)));
    const parent = h('select', null, h('option', { value: '' }, '—'), parentGoals.map((p) => h('option', { value: p.id, selected: g.parentId === p.id }, `${periodLabel(p.from)}: ${p.text}`)));
    const notes = h('textarea', { rows: 2 }, g.notes || '');
    const F = (l, el, wide) => h('label', { class: 'field' + (wide ? ' wide' : '') }, h('span', null, l), el);
    modal(g.id ? 'Editar objetivo' : 'Novo objetivo', h('div', { class: 'form-grid' },
      F('Objetivo', text, true), F('Motor de crescimento', motor), F('Conta', acc), F('Métrica', metric), F('Status', status), F('Meta', target), F('Realizado', current),
      parentGoals.length ? F('Desdobra o objetivo', parent, true) : null, F('Observações', notes, true)), {
      actions: [
        g.id ? { label: 'Excluir', kind: 'danger ghost left', onClick: async (c) => { if (await confirmBox('Excluir objetivo?', 'Excluir')) { savePlan({ goals: plan.goals.filter((x) => x.id !== g.id) }); c(); } } } : null,
        { label: 'Cancelar', kind: 'ghost', onClick: (c) => c() },
        { label: 'Salvar', kind: 'primary', onClick: (c) => {
          if (!text.value.trim()) return toast('Descreva o objetivo', 'err');
          const ng = { id: g.id || uid('g'), text: text.value.trim(), motor: motor.value, accountId: acc.value, metric: metric.value.trim(), target: target.value === '' ? null : Number(target.value), current: current.value === '' ? null : Number(current.value), status: status.value, parentId: parent.value, notes: notes.value };
          const goals = g.id ? plan.goals.map((x) => (x.id === g.id ? ng : x)) : [...plan.goals, ng];
          savePlan({ goals });
          c();
        } },
      ].filter(Boolean),
    });
  };

  const goalRow = (g) => {
    const pct = g.target ? Math.min(100, Math.round(((g.current || 0) / g.target) * 100)) : null;
    return h('div', { class: 'goal', onclick: () => goalForm(g) },
      h('div', { class: 'goal-main' },
        h('b', null, g.text),
        h('small', { class: 'muted block' }, [g.motor, g.accountId ? accName(g.accountId) : 'Carteira', g.metric].filter(Boolean).join(' · ')),
        g.parentId ? h('small', { class: 'block' }, '↳ ' + (parentGoals.find((p) => p.id === g.parentId)?.text || '')) : null),
      h('div', { class: 'goal-side' },
        badge(g.status || 'Não iniciado', STATUS_CLS[g.status] || 'muted'),
        pct != null ? h('div', { class: 'progress', title: `${g.current || 0} de ${g.target}` }, h('i', { style: { width: pct + '%' } }), h('span', null, `${g.current || 0}/${g.target}`)) : null));
  };

  const childCount = (gid) => db.plans.flatMap((p) => p.goals).filter((g) => g.parentId === gid).length;

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Planejamento'), h('p', { class: 'muted' }, `Ano fiscal termina em ${['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][fyEnd]} · cascata: ano → trimestre → mês → semana`)),
    ),
    tabs(LEVELS.map(([k, l]) => [k, l]), level, (k) => { setParam('p', ''); setParam('level', k); }),
    h('div', { class: 'period-nav' },
      btn('←', () => setParam('p', shift(key, -1)), 'ghost'),
      h('h2', null, periodLabel(key), h('small', { class: 'muted' }, ` ${fmt.date(b.start)} – ${fmt.date(b.end)}`)),
      btn('→', () => setParam('p', shift(key, 1)), 'ghost'),
      key !== cur[level] ? btn('Atual', () => setParam('p', ''), 'small ghost') : null,
    ),
    quotaBlock(key, level, cur),
    h('div', { class: 'kpis' },
      kpi('Vendas no período', fmt.usd(m.nb + m.rr), `NB ${fmt.usd(m.nb)} · RR ${fmt.usd(m.rr)} (base importada)`),
      kpi('Interações', m.interactions, `${m.visits} visitas presenciais`),
      kpi('Atividades técnicas', m.techCount, `${m.techHours} h`),
      kpi('Pré-pipeline', m.newPre, `novas · ${m.toSf} levadas ao Salesforce`),
      kpi('Agenda executiva', `${m.execDone}/${m.execPlanned}`, 'realizados / previstos'),
      kpi('Tarefas', `${m.tasksDone}/${m.tasks}`, m.salesRatio != null ? `${m.salesRatio}% ligadas a vendas` : ''),
    ),
    execBlock(key, b),
    h('div', { class: 'grid-2' },
      h('div', null,
        section('Foco do período', null,
          h('textarea', { rows: 3, placeholder: 'Qual o tema principal deste período? Ex.: “Renovações de dezembro + abrir 2 novas divisões na WEG”', onchange: (e) => savePlan({ focus: e.target.value }) }, plan.focus || '')),
        section(`Objetivos (${plan.goals.length})`, btn('＋ Objetivo', () => goalForm(), 'small primary'),
          plan.goals.length ? h('div', { class: 'goals' }, plan.goals.map((g) => h('div', null, goalRow(g), childCount(g.id) ? h('small', { class: 'muted child-count' }, `${childCount(g.id)} objetivo(s) desdobrado(s)`) : null))) : h('div', { class: 'empty' }, 'Nenhum objetivo para este período. Comece pelo motor de crescimento de cada conta estratégica.')),
      ),
      h('div', null,
        parentGoals.length ? section('Objetivos do nível acima', null, h('div', { class: 'goals' }, parentGoals.map((g) => h('div', { class: 'goal ro' }, h('div', { class: 'goal-main' }, h('b', null, g.text), h('small', { class: 'muted block' }, periodLabel(g.from) + (g.accountId ? ' · ' + accName(g.accountId) : ''))), badge(g.status || 'Não iniciado', STATUS_CLS[g.status] || 'muted'))))) : null,
        section('Notas / retrospectiva', null, h('textarea', { rows: 8, placeholder: 'Aprendizados, riscos, decisões…', onchange: (e) => savePlan({ notes: e.target.value }) }, plan.notes || '')),
      ),
    ),
  );
}

// ---------- Meta (USD NTA) ----------
function bar(label, done, target) {
  const pct = target ? Math.round(((done || 0) / target) * 100) : null;
  return h('div', { class: 'quota-row' },
    h('div', { class: 'quota-label' }, h('b', null, label), h('small', { class: 'muted' }, target ? `${fmt.usdFull(done || 0)} de ${fmt.usdFull(target)}` : 'meta não definida')),
    h('div', { class: 'progress big' + (pct >= 100 ? ' done' : '') }, h('i', { style: { width: Math.min(100, pct || 0) + '%' } }), h('span', null, pct != null ? pct + '%' : '—')));
}
function quotaBlock(key, level, cur) {
  const qKey = level === 'month' ? cur.quarter && monthQuarter(key) : key;
  const { q, ref, mrp } = quotaSummary(qKey);
  const edit = () => openForm('quotas', quotaFor(qKey) || { period: qKey }, { title: `Meta ${periodLabel(qKey)} (USD NTA)` });
  const tbT = (Number(q?.rrTarget) || 0) + (Number(q?.nbTarget) || 0);
  const tbD = (Number(q?.rrDone) || 0) + (Number(q?.nbDone) || 0);
  const quarters = level === 'year' ? [1, 2, 3, 4].map((i) => `${key}-T${i}`) : [];
  return section(`Atingimento da meta · ${periodLabel(qKey)}${q?.derived ? ' (soma dos trimestres)' : ''}`, h('div', { class: 'card-actions' }, h('small', { class: 'muted' }, 'USD NTA · edição manual'), btn('Editar meta', edit, 'small')),
    h('div', { class: 'quota' },
      bar('Renewals', q?.rrDone, q?.rrTarget),
      bar('New Business', q?.nbDone, q?.nbTarget),
      bar('Total Business', tbD, tbT)),
    h('small', { class: 'muted block' }, `Referência: MRP do período ${fmt.usdFull(mrp)} · vendas importadas: RR ${fmt.usdFull(ref.rr)}, NB ${fmt.usdFull(ref.nb)}${q?.notes ? ' · ' + q.notes : ''}`),
    quarters.length ? table(quarters.map((qq) => ({ qq, q: quotaFor(qq) })), [
      { label: 'Trimestre', render: (r) => h('b', null, periodLabel(r.qq)) },
      { label: 'Meta RR', cls: 'num', render: (r) => fmt.usd(r.q?.rrTarget) },
      { label: 'Realizado RR', cls: 'num', render: (r) => fmt.usd(r.q?.rrDone) },
      { label: 'Meta NB', cls: 'num', render: (r) => fmt.usd(r.q?.nbTarget) },
      { label: 'Realizado NB', cls: 'num', render: (r) => fmt.usd(r.q?.nbDone) },
      { label: '% TB', cls: 'num', render: (r) => { const t = (Number(r.q?.rrTarget) || 0) + (Number(r.q?.nbTarget) || 0); return t ? Math.round((((Number(r.q?.rrDone) || 0) + (Number(r.q?.nbDone) || 0)) / t) * 100) + '%' : '—'; } },
    ], { onRow: (r) => openForm('quotas', r.q || { period: r.qq }, { title: `Meta ${periodLabel(r.qq)} (USD NTA)` }) }) : null,
  );
}
function monthQuarter(ym) {
  const fe = store.db.settings.fyEndMonth;
  const d = ym + '-01';
  return `FY${fyOf(d, fe)}-T${fyQuarterOf(d, fe)}`;
}

// ---------- Agenda executiva ----------
function execBlock(key, b) {
  const list = store.db.engagements.filter((e) => inRange(e.date, b)).sort((x, y) => x.date.localeCompare(y.date));
  return section(`Agenda executiva · ${periodLabel(key)} (${list.length})`, h('div', { class: 'card-actions' },
    h('small', { class: 'muted' }, 'Executive & Champion Alignment — reuniões com diretores e eventos'),
    btn('＋ Encontro / evento', () => openForm('engagements', { date: b.start }), 'small primary')),
    table(list, engagementCols(true), { onRow: (e) => openForm('engagements', e), empty: 'Nada previsto. Planeje ao menos um encontro com diretor por conta-chave no trimestre.' }));
}
