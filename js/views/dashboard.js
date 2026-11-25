import { store } from '../store.js';
import { h, kpi, section, healthBadge, badge, chart, link, dueBadge, openForm } from '../ui.js';
import { accountStats, suggestions, accName, accPath, dataGaps, periodMetrics, quotaSummary, quotaFor, quarterKey, isOpenPre, shiftQuarter } from '../engine.js';
import { fmt, today, addDays, addMonths, daysBetween, currentPeriods, periodBounds, periodLabel, weekStart, monthLabel } from '../util.js';
import { go } from '../main.js';
import { SALES_CATEGORIES, ENUMS } from '../schema.js';

function quotaCard(period) {
  const { q } = quotaSummary(period);
  const pct = (d, t) => (t ? Math.round(((Number(d) || 0) / t) * 100) : null);
  const row = (label, d, t) => {
    const p = pct(d, t);
    return h('div', { class: 'quota-row compact' },
      h('div', { class: 'quota-label' }, h('b', null, label), h('small', { class: 'muted' }, t ? `${fmt.usd(d || 0)} / ${fmt.usd(t)}` : 'sem meta')),
      h('div', { class: 'progress big' + (p >= 100 ? ' done' : '') }, h('i', { style: { width: Math.min(100, p || 0) + '%' } }), h('span', null, p != null ? p + '%' : '—')));
  };
  const edit = () => openForm('quotas', quotaFor(period) || { period }, { title: `Meta ${periodLabel(period)} (USD NTA)` });
  return section(`Meta ${periodLabel(period)}`, h('button', { class: 'btn small ghost', onclick: edit }, 'Atualizar'),
    h('div', { class: 'quota' },
      row('Renewals', q?.rrDone, q?.rrTarget),
      row('New Business', q?.nbDone, q?.nbTarget),
      row('Total', (Number(q?.rrDone) || 0) + (Number(q?.nbDone) || 0), (Number(q?.rrTarget) || 0) + (Number(q?.nbTarget) || 0))));
}

export default function dashboard() {
  const db = store.db;
  const ref = today();
  const fe = db.settings.fyEndMonth;
  const per = currentPeriods(ref, fe);
  const qk = quarterKey(ref);
  const qb = periodBounds(per.quarter, fe);
  const yb = periodBounds(per.year, fe);
  const accs = db.accounts.filter((a) => a.status !== 'Saiu da carteira');
  const tops = accs.filter((a) => !a.parentId);
  const stats = accs.map((a) => ({ a, s: accountStats(a) }));
  const cnt = (lvl) => stats.filter((x) => x.s.level === lvl).length;

  const mrpQ = db.mrp.filter((m) => m.period === qk);
  const mrpNext = db.mrp.filter((m) => m.period === shiftQuarter(qk, 1));
  const sum = (arr, k = 'value') => arr.reduce((s, m) => s + (Number(m[k]) || 0), 0);
  const pre = db.prospects.filter(isOpenPre);
  const ready = pre.filter((p) => p.stage.startsWith('6'));
  const fus = db.interactions.filter((i) => i.followUpDate && !i.followUpDone);
  const overdue = fus.filter((i) => i.followUpDate < ref);
  const pool = db.techPool.filter((p) => p.status === 'Ativa');
  const qm = periodMetrics(per.quarter);
  const ws = weekStart(ref);
  const wtasks = db.tasks.filter((t) => t.week === ws);
  const wdone = wtasks.filter((t) => t.status === 'Feito').length;
  const wsales = wtasks.length ? Math.round((wtasks.filter((t) => SALES_CATEGORIES.includes(t.category)).length / wtasks.length) * 100) : null;
  const execs = db.engagements.filter((e) => ['Planejada', 'Agendada'].includes(e.status) && e.date >= ref).sort((a, b) => a.date.localeCompare(b.date));
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const attention = stats.filter((x) => x.s.level !== 'na' && x.a.status !== 'Prospect').sort((a, b) => a.s.score - b.s.score).slice(0, 8);
  const sugg = suggestions().slice(0, 6);
  const gaps = dataGaps();

  const expiring = db.licenses.filter((l) => l.status === 'Ativa' && l.type !== 'Perpetual' && l.renewalDate && l.renewalDate >= ref && l.renewalDate <= addDays(ref, 60));
  const byStage = ENUMS.preStage.slice(0, 7).map((st) => db.prospects.filter((p) => p.stage === st));
  const preChart = chart({
    type: 'bar',
    data: { labels: ENUMS.preStage.slice(0, 7).map((s) => s.replace(/^\d · /, '').replace('✓ ', '')), datasets: [{ label: 'Potencial (USD NTA)', data: byStage.map((l) => sum(l, 'potential')), backgroundColor: ['#9CA3AF', '#9CA3AF', '#6B7280', '#4B5563', '#374151', '#E11423', '#16A34A'] }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt.usd(c.raw)} · ${byStage[c.dataIndex].length} iniciativa(s)` } } }, scales: { x: { beginAtZero: true, ticks: { callback: (v) => fmt.usd(v) } } } },
  }, 220);
  const months = [...Array(6)].map((_, i) => addMonths(ref.slice(0, 7) + '-01', i - 5).slice(0, 7));
  const byMonth = (arr, f) => months.map((m) => arr.filter((x) => (f(x) || '').startsWith(m)).length);
  const actChart = chart({
    type: 'bar',
    data: { labels: months.map(monthLabel), datasets: [
      { label: 'Interações', data: byMonth(db.interactions.filter((i) => i.type !== 'Interno'), (i) => i.date), backgroundColor: '#E11423' },
      { label: 'Atividades técnicas', data: byMonth(db.techActivities.filter((t) => t.status === 'Realizada'), (t) => t.date), backgroundColor: '#4B5563' },
      { label: 'Encontros executivos', data: byMonth(db.engagements.filter((e) => e.status === 'Realizada'), (e) => e.date), backgroundColor: '#F59E0B' },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  }, 220);

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, `${greet}, ${db.settings.userName || ''}`), h('p', { class: 'muted' }, `${fmt.date(ref)} · ${periodLabel(per.quarter)} — faltam ${daysBetween(ref, qb.end)} dias para fechar o trimestre e ${daysBetween(ref, yb.end)} para o fim do FY (${fmt.date(yb.end)})`)),
    ),
    h('div', { class: 'grid-dash' },
      quotaCard(per.quarter),
      h('div', { class: 'kpis' },
        kpi('Contas na carteira', tops.length, `${accs.length - tops.length} subcontas · ${accs.filter((a) => a.status === 'Prospect').length} prospects`, '', () => go('#/accounts')),
        kpi('Saúde da carteira', h('span', null, h('span', { class: 'c-ok' }, cnt('ok')), ' / ', h('span', { class: 'c-warn' }, cnt('warn')), ' / ', h('span', { class: 'c-risk' }, cnt('risk'))), 'saudável / atenção / risco', '', () => go('#/accounts?sort=health')),
        kpi('MRP do trimestre', fmt.usd(sum(mrpQ)), `${mrpQ.filter((m) => m.status === 'Aberto').length} abertas · próximo tri ${fmt.usd(sum(mrpNext))}`, mrpQ.some((m) => m.status === 'Aberto') ? 'warn' : '', () => go('#/renewals')),
        kpi('Pré-pipeline', fmt.usd(sum(pre, 'potential')), `${pre.length} iniciativas · ${ready.length} prontas p/ Salesforce`, ready.length ? 'ok' : '', () => go('#/prepipeline')),
        kpi('Follow-ups', overdue.length ? `${overdue.length} vencidos` : fus.length, `${fus.length} em aberto`, overdue.length ? 'risk' : '', () => go('#/week')),
        kpi('Licenças expirando', expiring.length, 'leases nos próximos 60 dias', expiring.length ? 'warn' : '', () => go('#/renewals?tab=licenses&win=60')),
        kpi('Agenda executiva', execs.filter((e) => e.date <= qb.end).length, `encontros previstos no trimestre · ${qm.execDone} realizados`, '', () => go('#/planning')),
        kpi('Semana', `${wdone}/${wtasks.length}`, wsales == null ? 'nenhuma tarefa planejada' : `${wsales}% ligadas a vendas`, wsales != null && wsales < 60 ? 'warn' : '', () => go('#/week')),
      ),
    ),
    h('div', { class: 'grid-2' },
      section('Prioridades sugeridas', link('Planejar semana →', '#/week'),
        sugg.length ? h('ul', { class: 'list' }, sugg.map((s) => h('li', null,
          h('div', { class: 'li-main' }, h('b', null, s.title), h('small', null, s.reason)),
          h('span', { class: 'score' }, s.score)))) : h('div', { class: 'empty' }, 'Nada urgente. Bom momento para prospectar.'),
      ),
      section('Contas que precisam de atenção', link('Todas →', '#/accounts?sort=health'),
        h('ul', { class: 'list' }, attention.map(({ a, s }) => h('li', { class: 'click', onclick: () => go('#/account/' + a.id) },
          h('div', { class: 'li-main' }, h('b', null, accPath(a.id)), h('small', null, s.reasons.slice(0, 2).map((r) => r.t).join(' · ') || 'Em dia')),
          healthBadge(s)))),
      ),
    ),
    h('div', { class: 'grid-3' },
      section(`Renovações · ${periodLabel(qk)}`, link('MRP →', '#/renewals'),
        mrpQ.length ? h('ul', { class: 'list compact' }, mrpQ.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).map((m) => h('li', { class: 'click', onclick: () => openForm('mrp', m) },
          h('div', { class: 'li-main' }, h('b', null, accPath(m.accountId)), h('small', null, m.sfOpp || '')),
          h('div', { class: 'right' }, fmt.usd(m.value), h('br'), badge(m.status, { Renovado: 'ok', 'Renovado parcial': 'warn', Perdido: 'risk', Aberto: 'info' }[m.status]))))) : h('div', { class: 'empty' }, 'Nenhum MRP neste trimestre.'),
      ),
      section('Próximos encontros executivos', link('Planejamento →', '#/planning?level=year'),
        execs.length ? h('ul', { class: 'list compact' }, execs.slice(0, 7).map((e) => h('li', { class: 'click', onclick: () => openForm('engagements', e) },
          h('div', { class: 'li-main' }, h('b', null, e.title), h('small', null, [e.type, e.accountId && accName(e.accountId), e.location].filter(Boolean).join(' · '))),
          h('div', { class: 'right' }, fmt.date(e.date), e.dateTbd ? h('small', { class: 'block muted' }, 'a confirmar') : null)))) : h('div', { class: 'empty' }, 'Nada planejado.'),
      ),
      section('Qualidade dos dados', null,
        h('p', { class: 'muted small' }, gaps.notLogged ? `${gaps.notLogged} interação(ões) dos últimos 30 dias ainda não lançadas no Salesforce.` : 'Interações recentes lançadas no Salesforce ✓'),
        gaps.gaps.length ? h('ul', { class: 'list compact' }, gaps.gaps.slice(0, 6).map((g) => h('li', { class: 'click', onclick: () => go('#/account/' + g.account.id) }, h('div', { class: 'li-main' }, h('b', null, accPath(g.account.id)), h('small', null, 'Falta: ' + g.miss.join(', ')))))) : h('div', { class: 'empty' }, 'Cadastros completos ✓'),
        gaps.gaps.length > 6 ? h('small', { class: 'muted' }, `+ ${gaps.gaps.length - 6} contas com dados a completar`) : null,
      ),
    ),
    h('div', { class: 'grid-2' },
      section('Pré-pipeline por estágio', link('Quadro →', '#/prepipeline'), preChart),
      section('Atividade nos últimos 6 meses', null, actChart),
    ),
  );
}
