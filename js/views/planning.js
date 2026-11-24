import { store, upsert } from '../store.js';
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
    const acc = h('select', null, h('option', { value: '' }, 'Carteira toda'), accountOptions().map((a) => h('option', { value: a.id, selected: g.accountId === a.id }, a.name)));
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
    h('div', { class: 'kpis' },
      kpi('Vendas fechadas', fmt.compact(m.salesValue), `${m.salesCount} vendas`),
      kpi('Interações', m.interactions, `${m.visits} visitas presenciais`),
      kpi('Atividades técnicas', m.techCount, `${m.techHours} h`),
      kpi('Novas oportunidades', m.newOpps, `${m.won} ganhas`),
      kpi('Prospecção', m.prospects, 'novos itens'),
      kpi('Tarefas', `${m.tasksDone}/${m.tasks}`, m.salesRatio != null ? `${m.salesRatio}% ligadas a vendas` : ''),
    ),
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
