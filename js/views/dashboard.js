import { store } from '../store.js';
import { h, kpi, section, healthBadge, badge, chart, link, dueBadge } from '../ui.js';
import { accountStats, suggestions, isOpenOpp, accName, dataGaps, periodMetrics } from '../engine.js';
import { fmt, today, addDays, addMonths, daysBetween, currentPeriods, periodBounds, periodLabel, weekStart, monthLabel } from '../util.js';
import { go } from '../main.js';
import { SALES_CATEGORIES } from '../schema.js';

export default function dashboard() {
  const db = store.db;
  const ref = today();
  const fyEnd = db.settings.fyEndMonth;
  const per = currentPeriods(ref, fyEnd);
  const qb = periodBounds(per.quarter, fyEnd);
  const yb = periodBounds(per.year, fyEnd);
  const accs = db.accounts.filter((a) => a.status !== 'Repassada');
  const stats = accs.map((a) => ({ a, s: accountStats(a) }));
  const cnt = (lvl) => stats.filter((x) => x.s.level === lvl).length;
  const clients = accs.filter((a) => ['Cliente ativo', 'Cliente sem TECS'].includes(a.status)).length;

  const renewals = db.licenses
    .filter((l) => l.renewalDate && l.renewalDate >= ref && l.renewalDate <= addDays(ref, 365) && !['Cancelada', 'Proposta'].includes(l.status))
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
  const ren90 = renewals.filter((l) => l.renewalDate <= addDays(ref, 90));
  const open = db.opportunities.filter(isOpenOpp);
  const pipe = open.filter((o) => o.stage !== 'Em espera').reduce((s, o) => s + (o.currency === 'BRL' || !o.currency ? Number(o.value) || 0 : 0), 0);
  const fus = db.interactions.filter((i) => i.followUpDate && !i.followUpDone);
  const overdue = fus.filter((i) => i.followUpDate < ref);
  const pool = db.techPool.filter((p) => p.status === 'Ativa');
  const qm = periodMetrics(per.quarter);
  const ws = weekStart(ref);
  const wtasks = db.tasks.filter((t) => t.week === ws);
  const wdone = wtasks.filter((t) => t.status === 'Feito').length;
  const wsales = wtasks.length ? Math.round((wtasks.filter((t) => SALES_CATEGORIES.includes(t.category)).length / wtasks.length) * 100) : null;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  const attention = stats.filter((x) => x.s.level !== 'na').sort((a, b) => a.s.score - b.s.score).slice(0, 8);
  const sugg = suggestions().slice(0, 6);
  const gaps = dataGaps();

  // Atividade por mês (6 meses)
  const months = [...Array(6)].map((_, i) => addMonths(ref.slice(0, 7) + '-01', i - 5).slice(0, 7));
  const byMonth = (arr, f) => months.map((m) => arr.filter((x) => (f(x) || '').startsWith(m)).length);
  const actChart = chart({
    type: 'bar',
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { label: 'Interações', data: byMonth(db.interactions.filter((i) => i.type !== 'Interno'), (i) => i.date), backgroundColor: '#E11423' },
        { label: 'Atividades técnicas', data: byMonth(db.techActivities.filter((t) => t.status === 'Realizada'), (t) => t.date), backgroundColor: '#4B5563' },
      ],
    },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  // Renovações por mês (12 meses)
  const rmonths = [...Array(12)].map((_, i) => addMonths(ref.slice(0, 7) + '-01', i).slice(0, 7));
  const renChart = chart({
    type: 'bar',
    data: { labels: rmonths.map(monthLabel), datasets: [{ label: 'Licenças/contratos a renovar', data: rmonths.map((m) => renewals.filter((l) => l.renewalDate.startsWith(m)).length), backgroundColor: '#F59E0B' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  }, 180);

  const daysQ = daysBetween(ref, qb.end);
  const daysY = daysBetween(ref, yb.end);

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, `${greet}, ${db.settings.userName || ''}`), h('p', { class: 'muted' }, `${fmt.date(ref)} · ${periodLabel(per.quarter)} — faltam ${daysQ} dias para fechar o trimestre fiscal e ${daysY} para o fim do FY (${fmt.date(yb.end)})`)),
    ),
    h('div', { class: 'kpis' },
      kpi('Contas', accs.length, `${clients} clientes · ${accs.filter((a) => a.status === 'Prospect').length} prospects`, '', () => go('#/accounts')),
      kpi('Saúde da carteira', h('span', null, h('span', { class: 'c-ok' }, cnt('ok')), ' / ', h('span', { class: 'c-warn' }, cnt('warn')), ' / ', h('span', { class: 'c-risk' }, cnt('risk'))), 'saudável / atenção / risco', '', () => go('#/accounts?sort=health')),
      kpi('Renovações ≤ 90 dias', ren90.length, `${renewals.length} nos próximos 12 meses`, ren90.length ? 'warn' : '', () => go('#/licenses')),
      kpi('Pipeline aberto', fmt.compact(pipe), `${open.length} oportunidades`, '', () => go('#/commercial')),
      kpi('Follow-ups', overdue.length ? `${overdue.length} vencidos` : fus.length, `${fus.length} em aberto`, overdue.length ? 'risk' : '', () => go('#/week')),
      kpi('Avaliações ativas', pool.length, 'temp keys / tech pool', '', () => go('#/technical?tab=pool')),
      kpi('Atividades técnicas', qm.techCount, `no trimestre fiscal · ${qm.interactions} interações`, '', () => go('#/technical')),
      kpi('Semana', `${wdone}/${wtasks.length}`, wsales == null ? 'nenhuma tarefa planejada' : `${wsales}% ligadas a vendas`, wsales != null && wsales < 60 ? 'warn' : '', () => go('#/week')),
    ),
    h('div', { class: 'grid-2' },
      section('Prioridades sugeridas', link('Planejar semana →', '#/week'),
        sugg.length ? h('ul', { class: 'list' }, sugg.map((s) => h('li', null,
          h('div', { class: 'li-main' }, h('b', null, s.title), h('small', null, s.reason)),
          h('span', { class: 'score' }, s.score)))) : h('div', { class: 'empty' }, 'Nada urgente. Bom momento para prospectar.'),
      ),
      section('Contas que precisam de atenção', link('Todas →', '#/accounts'),
        h('ul', { class: 'list' }, attention.map(({ a, s }) => h('li', { class: 'click', onclick: () => go('#/account/' + a.id) },
          h('div', { class: 'li-main' }, h('b', null, a.name), h('small', null, s.reasons.slice(0, 2).map((r) => r.t).join(' · ') || 'Em dia')),
          healthBadge(s)))),
      ),
    ),
    h('div', { class: 'grid-3' },
      section('Próximas renovações', link('Licenças →', '#/licenses'),
        renewals.length ? h('ul', { class: 'list compact' }, renewals.slice(0, 8).map((l) => h('li', { class: 'click', onclick: () => go(`#/account/${l.accountId}?tab=licenses`) },
          h('div', { class: 'li-main' }, h('b', null, accName(l.accountId)), h('small', null, `${l.product}${l.qty ? ' ×' + l.qty : ''}`)),
          h('div', { class: 'right' }, fmt.date(l.renewalDate), h('br'), badge(fmt.rel(l.renewalDate), daysBetween(ref, l.renewalDate) <= 90 ? 'warn' : 'muted'))))) : h('div', { class: 'empty' }, 'Cadastre as datas de renovação das licenças.'),
      ),
      section('Follow-ups (próximos 14 dias)', null,
        (() => {
          const list = fus.filter((i) => i.followUpDate <= addDays(ref, 14)).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
          return list.length ? h('ul', { class: 'list compact' }, list.slice(0, 8).map((i) => h('li', { class: 'click', onclick: () => go(`#/account/${i.accountId}?tab=interactions`) },
            h('div', { class: 'li-main' }, h('b', null, accName(i.accountId)), h('small', null, i.subject)), dueBadge(i.followUpDate)))) : h('div', { class: 'empty' }, 'Nenhum follow-up nos próximos 14 dias.');
        })(),
      ),
      section('Qualidade dos dados', null,
        h('p', { class: 'muted small' }, gaps.notLogged ? `${gaps.notLogged} interação(ões) dos últimos 30 dias ainda não marcadas como lançadas no Salesforce.` : 'Interações recentes lançadas no Salesforce ✓'),
        gaps.gaps.length ? h('ul', { class: 'list compact' }, gaps.gaps.slice(0, 6).map((g) => h('li', { class: 'click', onclick: () => go('#/account/' + g.account.id) }, h('div', { class: 'li-main' }, h('b', null, g.account.name), h('small', null, 'Falta: ' + g.miss.join(', ')))))) : h('div', { class: 'empty' }, 'Cadastros completos ✓'),
        gaps.gaps.length > 6 ? h('small', { class: 'muted' }, `+ ${gaps.gaps.length - 6} contas com dados a completar`) : null,
      ),
    ),
    h('div', { class: 'grid-2' },
      section('Atividade nos últimos 6 meses', null, actChart),
      section('Renovações por mês (12 meses)', null, renChart),
    ),
  );
}
