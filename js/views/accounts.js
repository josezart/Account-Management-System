import { store, all, get, upsert, patch } from '../store.js';
import { h, table, openForm, healthBadge, badge, stageBadge, engagementDots, tabs, section, btn, kpi, copyText, dueBadge, toast } from '../ui.js';
import { accountStats, whitespaceRow, isOpenOpp, contactName, meddicScore, HEALTH_LABEL } from '../engine.js';
import { FAMILIES, ENUMS } from '../schema.js';
import { fmt, today, daysBetween, norm } from '../util.js';
import { go, setParam, quickLog, quickTask, reportText } from '../main.js';
import { miniMap } from './map.js';

// ---------------- Lista ----------------
export function accountsView({ params }) {
  const db = store.db;
  const f = { tier: params.tier || '', status: params.status || '', group: params.group || '', health: params.health || '' };
  let rows = db.accounts.map((a) => ({ a, s: accountStats(a) }));
  if (f.tier) rows = rows.filter((r) => r.a.tier === f.tier);
  if (f.status) rows = rows.filter((r) => r.a.status === f.status);
  if (f.group) rows = rows.filter((r) => (r.a.group || '') === f.group);
  if (f.health) rows = rows.filter((r) => r.s.level === f.health);
  if (!f.status) rows = rows.filter((r) => r.a.status !== 'Repassada');
  const groups = [...new Set(db.accounts.map((a) => a.group).filter(Boolean))].sort();
  const sel = (key, opts, label) => h('select', { onchange: (e) => setParam(key, e.target.value) }, h('option', { value: '' }, label), opts.map((o) => (Array.isArray(o) ? h('option', { value: o[0], selected: f[key] === o[0] }, o[1]) : h('option', { value: o, selected: f[key] === o }, o))));
  const sortHealth = params.sort === 'health';

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Contas'), h('div', { class: 'actions' }, btn('＋ Nova conta', () => openForm('accounts', {}, { onSaved: (a) => go('#/account/' + a.id) }), 'primary'))),
    h('div', { class: 'filters' },
      sel('tier', ENUMS.tier, 'Todas as classificações'),
      sel('status', ENUMS.accountStatus, 'Status (exceto repassadas)'),
      sel('group', groups, 'Todos os grupos'),
      sel('health', [['ok', 'Saudável'], ['warn', 'Atenção'], ['risk', 'Risco']], 'Qualquer saúde'),
    ),
    section(`${rows.length} contas`, null,
      table(rows, [
        { label: 'Conta', key: 'name', sort: (r) => r.a.name, text: (r) => `${r.a.name} ${r.a.group || ''} ${r.a.city || ''}`, render: (r) => h('div', null, h('b', null, r.a.name), h('small', { class: 'block muted' }, [r.a.group, r.a.city && `${r.a.city}${r.a.state ? '/' + r.a.state : ''}`].filter(Boolean).join(' · '))) },
        { label: 'Classif.', sort: (r) => ENUMS.tier.indexOf(r.a.tier), render: (r) => badge(r.a.tier || '—', r.a.tier === 'Estratégica' ? 'accent' : '') },
        { label: 'Status', sort: (r) => r.a.status, render: (r) => r.a.status },
        { label: 'Saúde', key: 'health', sort: (r) => r.s.score, render: (r) => healthBadge(r.s) },
        { label: 'Último contato', sort: (r) => r.s.lastContact || '', render: (r) => (r.s.lastContact ? h('span', null, fmt.date(r.s.lastContact), h('small', { class: 'block muted' }, fmt.rel(r.s.lastContact))) : h('span', { class: 'muted' }, 'nunca')) },
        { label: 'Últ. técnica', sort: (r) => r.s.lastTech || '', render: (r) => (r.s.lastTech ? fmt.date(r.s.lastTech) : h('span', { class: 'muted' }, '—')) },
        { label: 'Próxima ação', sort: (r) => r.s.nextAction.date, render: (r) => (r.a.status === 'Repassada' ? '—' : h('span', null, r.s.nextAction.label, ' ', dueBadge(r.s.nextAction.date))) },
        { label: 'Renovação', sort: (r) => r.s.nextRenewal?.renewalDate || '9', render: (r) => (r.s.nextRenewal ? h('span', null, fmt.date(r.s.nextRenewal.renewalDate), h('small', { class: 'block muted' }, r.s.nextRenewal.product)) : '—') },
        { label: 'Pipeline', sort: (r) => r.s.pipeline, cls: 'num', render: (r) => (r.s.opps.length ? h('span', null, fmt.compact(r.s.pipeline), h('small', { class: 'block muted' }, `${r.s.opps.length} opp.`)) : '—') },
      ], { onRow: (r) => go('#/account/' + r.a.id), search: true, sort: sortHealth ? { key: 'health', dir: 1 } : { key: 'name', dir: 1 } }),
    ),
  );
}

// ---------------- Detalhe ----------------
const TABS = [
  ['overview', 'Resumo'], ['contacts', 'Contatos'], ['licenses', 'Licenças'], ['commercial', 'Comercial'], ['interactions', 'Histórico'],
  ['technical', 'Técnico'], ['trainings', 'Treinamentos'], ['whitespace', 'Whitespace'], ['briefing', 'Briefing'],
];

export function accountDetail({ id, params }) {
  const a = get('accounts', id);
  if (!a) return h('div', { class: 'page' }, h('p', null, 'Conta não encontrada. '), h('a', { href: '#/accounts' }, 'Voltar'));
  const s = accountStats(a);
  const tab = params.tab || 'overview';
  const by = (c) => all(c).filter((r) => r.accountId === a.id);
  const counts = { contacts: by('contacts').length, licenses: by('licenses').length, commercial: by('opportunities').filter(isOpenOpp).length, interactions: by('interactions').length, technical: by('techActivities').length + by('techPool').length, trainings: by('trainings').length };
  const body = { overview, contacts: contactsTab, licenses: licensesTab, commercial: commercialTab, interactions: historyTab, technical: technicalTab, trainings: trainingsTab, whitespace: whitespaceTab, briefing }[tab] || overview;

  return h('div', { class: 'page' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/accounts' }, 'Contas'), a.group ? ` / ${a.group}` : ''),
    h('div', { class: 'page-head acc-head' },
      h('div', null,
        h('h1', null, a.name, ' ', healthBadge(s)),
        h('p', { class: 'muted' }, [a.tier, a.status, a.segment, a.ansysNumber ? `Ansys #${a.ansysNumber}` : 'Ansys # —', a.city && `${a.city}${a.state ? '/' + a.state : ''}`].filter(Boolean).join(' · ')),
      ),
      h('div', { class: 'actions' },
        btn('＋ Registrar interação', () => quickLog({ accountId: a.id }), 'primary'),
        btn('＋ Tarefa', () => quickTask({ accountId: a.id })),
        btn('Editar conta', () => openForm('accounts', a)),
      ),
    ),
    tabs(TABS.map(([k, l]) => [k, l, counts[k]]), tab, (k) => setParam('tab', k)),
    body(a, s),
  );
}

function overview(a, s) {
  const db = store.db;
  const recent = timeline(a).slice(0, 6);
  const divs = a.divisions || [];
  return h('div', null,
    h('div', { class: 'kpis small' },
      kpi('Saúde', `${s.score}`, HEALTH_LABEL[s.level], s.level),
      kpi('Último contato', s.lastContact ? fmt.rel(s.lastContact) : 'nunca', `cadência: ${s.cad.contact} dias`, s.dContact == null || s.dContact > s.cad.contact ? 'warn' : ''),
      kpi('Última atividade técnica', s.lastTech ? fmt.rel(s.lastTech) : 'nunca', `meta: ${s.cad.tech} dias`, s.dTech == null || s.dTech > s.cad.tech ? 'warn' : ''),
      kpi('Próxima ação', fmt.date(s.nextAction.date), s.nextAction.label, s.nextAction.date < today() ? 'risk' : ''),
      kpi('Pipeline', fmt.compact(s.pipeline), `${s.opps.length} oportunidades abertas`),
      kpi('Próxima renovação', s.nextRenewal ? fmt.date(s.nextRenewal.renewalDate) : '—', s.nextRenewal ? s.nextRenewal.product : ''),
    ),
    h('div', { class: 'grid-2' },
      h('div', null,
        section('Diagnóstico', null,
          s.reasons.length ? h('ul', { class: 'reasons' }, s.reasons.map((r) => h('li', null, r.t))) : h('p', { class: 'c-ok' }, 'Tudo em dia nesta conta ✓'),
          a.strategy ? h('div', { class: 'note' }, h('b', null, 'Estratégia: '), a.strategy) : null,
        ),
        section('Dados da conta', btn('Editar', () => openForm('accounts', a), 'small ghost'),
          h('dl', { class: 'dl' },
            ...[['Razão social', a.legalName], ['Ansys Number', a.ansysNumber], ['CNPJ', a.cnpj], ['Grupo', a.group], ['Segmento', a.segment], ['Endereço', [a.address, a.city, a.state].filter(Boolean).join(', ')], ['Site', a.website && h('a', { href: a.website, target: '_blank' }, a.website)], ['TAM (ESSS)', a.tam], ['Concorrentes', a.competitors]]
              .flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v || '—')]),
          ),
          a.notes ? h('div', { class: 'note' }, a.notes) : null,
        ),
        section('Divisões e subdivisões', btn('Editar', () => openForm('accounts', a), 'small ghost'),
          divs.length ? h('div', { class: 'divs' }, divs.map((d) => {
            const nC = db.contacts.filter((c) => c.accountId === a.id && (c.division || '').startsWith(d.name)).length;
            const nL = db.licenses.filter((l) => l.accountId === a.id && (l.division || '').startsWith(d.name)).length;
            return h('div', { class: 'div-card' }, h('b', null, d.name), h('small', { class: 'muted block' }, `${nC} contatos · ${nL} licenças`), d.subs?.length ? h('ul', null, d.subs.map((x) => h('li', null, x))) : null);
          })) : h('div', { class: 'empty' }, 'Nenhuma divisão cadastrada.'),
        ),
      ),
      h('div', null,
        section('Localização', null, miniMap(a)),
        section('Atividade recente', h('a', { href: `#/account/${a.id}?tab=interactions`, class: 'link' }, 'Histórico completo →'), timelineList(recent)),
        section('Oportunidades abertas', null, s.opps.length ? h('ul', { class: 'list compact' }, s.opps.map((o) => h('li', { class: 'click', onclick: () => openForm('opportunities', o) }, h('div', { class: 'li-main' }, h('b', null, o.name), h('small', null, o.nextStep || o.products || '')), stageBadge(o.stage)))) : h('div', { class: 'empty' }, 'Nenhuma oportunidade aberta.')),
      ),
    ),
  );
}

// ---- Contatos + organograma
function contactsTab(a) {
  const list = all('contacts').filter((c) => c.accountId === a.id);
  const ids = new Set(list.map((c) => c.id));
  const kids = (pid) => list.filter((c) => c.reportsTo === pid);
  const lvl = (c) => ['Executivo', 'Gerencial', 'Técnico', 'Operacional'].indexOf(c.level);
  const roots = list.filter((c) => !c.reportsTo || !ids.has(c.reportsTo)).sort((x, y) => lvl(x) - lvl(y));
  const node = (c) => h('li', null,
    h('div', { class: 'org-card' + (c.inactive ? ' inactive' : '') + (c.role === 'Champion' ? ' champ' : ''), onclick: () => openForm('contacts', c) },
      h('b', null, c.name), h('small', null, c.title || ''), h('div', { class: 'org-meta' }, badge(c.role || '—', roleCls(c.role)), engagementDots(c.engagement))),
    kids(c.id).length ? h('ul', null, kids(c.id).map(node)) : null,
  );
  const execs = list.filter((c) => c.level === 'Executivo' || ['Diretor / Comandante', 'Decisor (Economic Buyer)'].includes(c.role));
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Novo contato', () => openForm('contacts', { accountId: a.id }), 'primary'),
      h('span', { class: 'muted small' }, `${list.filter((c) => c.role === 'Champion').length} champion(s) · ${execs.length} executivo(s) · engajamento médio ${list.length ? (list.reduce((s, c) => s + (Number(c.engagement) || 0), 0) / list.length).toFixed(1) : '—'}`)),
    section('Hierarquia e engajamento', h('small', { class: 'muted' }, 'Defina "Reporta-se a" em cada contato para montar a árvore'),
      list.length ? h('div', { class: 'org' }, h('ul', null, roots.map(node))) : h('div', { class: 'empty' }, 'Nenhum contato cadastrado.')),
    section('Lista', null, table(list, [
      { label: 'Nome', key: 'name', render: (c) => h('b', null, c.name) },
      { label: 'Cargo', key: 'title' },
      { label: 'Divisão', key: 'division' },
      { label: 'Papel', key: 'role', render: (c) => badge(c.role || '—', roleCls(c.role)) },
      { label: 'Engajamento', key: 'engagement', render: (c) => engagementDots(c.engagement) },
      { label: 'Último contato', sort: (c) => lastContactOf(c.id) || '', render: (c) => fmt.date(lastContactOf(c.id)) },
      { label: 'E-mail', key: 'email', render: (c) => (c.email ? h('a', { href: 'mailto:' + c.email }, c.email) : '—') },
    ], { onRow: (c) => openForm('contacts', c), search: true })),
  );
}
export const roleCls = (r) => ({ Champion: 'ok', 'Decisor (Economic Buyer)': 'accent', 'Diretor / Comandante': 'accent', Gerente: 'info', Detrator: 'risk' })[r] || '';
export function lastContactOf(cid) {
  const d = all('interactions').filter((i) => (i.contactIds || []).includes(cid)).map((i) => i.date).sort();
  return d[d.length - 1] || null;
}

// ---- Licenças
export function licenseCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (l) => accNameOf(l.accountId), render: (l) => h('b', null, accNameOf(l.accountId)) } : null,
    { label: 'Produto', key: 'product', render: (l) => h('b', null, l.product) },
    { label: 'Tipo', key: 'type' },
    { label: 'Qtd', key: 'qty', cls: 'num' },
    { label: 'Divisão', key: 'division' },
    { label: 'Status', key: 'status', render: (l) => badge(l.status || '—', { Ativa: 'ok', 'TECS expirado': 'risk', 'Em renovação': 'warn', Proposta: 'info' }[l.status] || 'muted') },
    { label: 'Início', key: 'startDate', render: (l) => fmt.date(l.startDate) },
    { label: 'Renovação', key: 'renewalDate', render: (l) => (l.renewalDate ? h('span', null, fmt.date(l.renewalDate), ' ', l.renewalDate >= today() && daysBetween(today(), l.renewalDate) <= 120 ? badge(fmt.rel(l.renewalDate), 'warn') : null) : '—') },
    { label: 'Valor', key: 'value', cls: 'num', render: (l) => fmt.money(l.value, l.currency) },
  ].filter(Boolean);
}
const accNameOf = (id) => get('accounts', id)?.name || '—';
function licensesTab(a) {
  const list = all('licenses').filter((l) => l.accountId === a.id);
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Nova licença', () => openForm('licenses', { accountId: a.id }), 'primary')),
    section('Parque de licenças', null, table(list, licenseCols(), { onRow: (l) => openForm('licenses', l), sort: { key: 'renewalDate', dir: 1 } })),
    poolSection(a),
  );
}
function poolSection(a) {
  const list = all('techPool').filter((p) => p.accountId === a.id);
  return section('Tech Pool & Temp Keys', btn('＋ Nova', () => openForm('techPool', { accountId: a.id }), 'small'), table(list, poolCols(), { onRow: (p) => openForm('techPool', p), empty: 'Nenhuma licença temporária registrada.' }));
}
export function poolCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (p) => accNameOf(p.accountId), render: (p) => h('b', null, accNameOf(p.accountId)) } : null,
    { label: 'Tipo', key: 'kind' },
    { label: 'Licenças', key: 'products', render: (p) => h('b', null, p.products) },
    { label: 'Qtd', key: 'qty', cls: 'num' },
    { label: 'Período', sort: (p) => p.endDate || '', render: (p) => `${fmt.date(p.startDate)} → ${fmt.date(p.endDate)}` },
    { label: 'Status', key: 'status', render: (p) => h('span', null, badge(p.status, { Ativa: 'info', 'Convertida em venda': 'ok', 'Não converteu': 'risk', Solicitada: 'warn' }[p.status] || 'muted'), ' ', p.status === 'Ativa' && p.endDate ? dueBadge(p.endDate) : null) },
    { label: 'Objetivo', key: 'purpose', render: (p) => h('small', null, p.purpose || '—') },
  ].filter(Boolean);
}

// ---- Comercial
export function oppCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (o) => accNameOf(o.accountId), render: (o) => h('b', null, accNameOf(o.accountId)) } : null,
    { label: 'Oportunidade', key: 'name', render: (o) => h('div', null, h('b', null, o.name), h('small', { class: 'block muted' }, o.products || '')) },
    { label: 'Tipo', key: 'type' },
    { label: 'Estágio', key: 'stage', render: (o) => stageBadge(o.stage) },
    { label: 'Valor', key: 'value', cls: 'num', sort: (o) => Number(o.value) || 0, render: (o) => fmt.money(o.value, o.currency) },
    { label: 'Prob.', key: 'probability', cls: 'num', render: (o) => (o.probability != null ? o.probability + '%' : '—') },
    { label: 'Fechamento', key: 'closeDate', render: (o) => fmt.date(o.closeDate) },
    { label: 'MEDDIC', sort: (o) => meddicScore(o), render: (o) => meddicBar(o) },
    { label: 'Próximo passo', key: 'nextStep', render: (o) => h('small', null, o.nextStep || '—') },
  ].filter(Boolean);
}
export function meddicBar(o) {
  const n = meddicScore(o);
  return h('span', { class: 'meddic', title: `${n}/6 elementos MEDDIC preenchidos` }, 'MEDDIC'.split('').map((ch, i) => h('i', { class: i < n ? 'on' : '' }, ch)));
}
export function saleCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (s) => accNameOf(s.accountId), render: (s) => h('b', null, accNameOf(s.accountId)) } : null,
    { label: 'Data', key: 'date', render: (s) => fmt.date(s.date) },
    { label: 'Descrição', key: 'description', render: (s) => h('div', null, h('b', null, s.description), h('small', { class: 'block muted' }, s.products || '')) },
    { label: 'Tipo', key: 'type' },
    { label: 'Vigência', key: 'term', render: (s) => (s.term ? s.term + ' meses' : '—') },
    { label: 'Valor', key: 'value', cls: 'num', sort: (s) => Number(s.value) || 0, render: (s) => fmt.money(s.value, s.currency) },
  ].filter(Boolean);
}
function commercialTab(a) {
  const opps = all('opportunities').filter((o) => o.accountId === a.id);
  const sales = all('sales').filter((s) => s.accountId === a.id);
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Oportunidade', () => openForm('opportunities', { accountId: a.id }), 'primary'), btn('＋ Venda fechada', () => openForm('sales', { accountId: a.id, date: today() }))),
    section('Oportunidades', null, table(opps, oppCols(), { onRow: (o) => openForm('opportunities', o), sort: { key: 'closeDate', dir: 1 } })),
    section(`Histórico de vendas · total ${fmt.money(sales.reduce((s, x) => s + (Number(x.value) || 0), 0))}`, null, table(sales, saleCols(), { onRow: (s) => openForm('sales', s), sort: { key: 'date', dir: -1 }, empty: 'Nenhuma venda registrada (importe pela planilha ou cadastre manualmente).' })),
  );
}

// ---- Histórico (linha do tempo)
export function timeline(a) {
  const db = store.db;
  const m = (r, c) => r.accountId === a.id;
  return [
    ...db.interactions.filter(m).map((i) => ({ date: i.date, kind: i.type, icon: '💬', title: i.subject, sub: [i.summary, i.nextSteps && 'Próximos: ' + i.nextSteps].filter(Boolean).join(' · '), open: () => openForm('interactions', i), rec: i, c: 'interactions' })),
    ...db.techActivities.filter(m).map((t) => ({ date: t.date, kind: t.type, icon: '⚙', title: t.title, sub: [t.specialist, t.status, t.result !== '—' && t.result].filter(Boolean).join(' · '), open: () => openForm('techActivities', t) })),
    ...db.sales.filter(m).map((s) => ({ date: s.date, kind: 'Venda', icon: '◆', title: s.description, sub: fmt.money(s.value, s.currency), open: () => openForm('sales', s) })),
    ...db.trainings.filter(m).map((t) => ({ date: t.startDate, kind: 'Treinamento', icon: '🎓', title: t.course, sub: `${t.platform || ''} · ${t.status || ''}`, open: () => openForm('trainings', t) })),
    ...db.techPool.filter(m).map((p) => ({ date: p.startDate, kind: p.kind, icon: '🔑', title: p.products, sub: `${p.status} · até ${fmt.date(p.endDate)}`, open: () => openForm('techPool', p) })),
  ].filter((x) => x.date).sort((x, y) => y.date.localeCompare(x.date));
}
function timelineList(items) {
  if (!items.length) return h('div', { class: 'empty' }, 'Nenhum registro ainda. Use “Registrar interação”.');
  return h('ul', { class: 'timeline' }, items.map((it) => h('li', { class: 'click', onclick: it.open },
    h('span', { class: 'tl-date' }, fmt.date(it.date)),
    h('div', null, h('small', { class: 'muted' }, it.icon + ' ' + it.kind), h('b', { class: 'block' }, it.title), it.sub ? h('small', { class: 'block' }, it.sub) : null,
      it.rec && it.rec.followUpDate && !it.rec.followUpDone ? h('span', null, 'Follow-up ', dueBadge(it.rec.followUpDate), ' ', h('button', { class: 'btn tiny', onclick: (e) => { e.stopPropagation(); patch('interactions', it.rec.id, { followUpDone: true }); } }, '✓ concluído')) : null,
      it.rec ? h('button', { class: 'btn tiny ghost', onclick: (e) => { e.stopPropagation(); copyText(reportText(it.rec)); } }, 'copiar resumo') : null,
    ))));
}
function historyTab(a) {
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Registrar interação', () => quickLog({ accountId: a.id }), 'primary')),
    section('Linha do tempo', h('small', { class: 'muted' }, 'interações, atividades técnicas, vendas, treinamentos e avaliações'), timelineList(timeline(a))),
  );
}

// ---- Técnico
export function techCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (t) => accNameOf(t.accountId), render: (t) => h('b', null, accNameOf(t.accountId)) } : null,
    { label: 'Data', key: 'date', render: (t) => fmt.date(t.date) },
    { label: 'Tipo', key: 'type' },
    { label: 'Tema', key: 'title', render: (t) => h('div', null, h('b', null, t.title), h('small', { class: 'block muted' }, t.products || '')) },
    { label: 'Especialista', key: 'specialist' },
    { label: 'Status', key: 'status', render: (t) => badge(t.status, t.status === 'Realizada' ? 'ok' : t.status === 'Planejada' ? 'info' : 'muted') },
    { label: 'Resultado', key: 'result' },
    { label: 'Horas', key: 'hours', cls: 'num' },
  ].filter(Boolean);
}
function technicalTab(a) {
  const list = all('techActivities').filter((t) => t.accountId === a.id);
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Atividade técnica', () => openForm('techActivities', { accountId: a.id, date: today() }), 'primary'), btn('＋ Temp key / Tech Pool', () => openForm('techPool', { accountId: a.id, startDate: today() }))),
    section('Atividades técnicas', h('small', { class: 'muted' }, `${list.filter((t) => t.status === 'Realizada').length} realizadas · ${list.reduce((s, t) => s + (Number(t.hours) || 0), 0)} h`), table(list, techCols(), { onRow: (t) => openForm('techActivities', t), sort: { key: 'date', dir: -1 } })),
    poolSection(a),
  );
}

// ---- Treinamentos
export function trainingCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (t) => accNameOf(t.accountId), render: (t) => h('b', null, accNameOf(t.accountId)) } : null,
    { label: 'Curso / conteúdo', key: 'course', render: (t) => h('b', null, t.course) },
    { label: 'Plataforma', key: 'platform' },
    { label: 'Participantes', render: (t) => h('small', null, (t.contactIds || []).map(contactName).filter(Boolean).join(', ') || (t.seats ? `${t.seats} vagas` : '—')) },
    { label: 'Período', sort: (t) => t.startDate || '', render: (t) => `${fmt.date(t.startDate)} → ${fmt.date(t.endDate)}` },
    { label: 'Status', key: 'status', render: (t) => badge(t.status || '—', { Concluído: 'ok', 'Acesso ativo': 'info', 'Em andamento': 'info', Planejado: 'warn', 'Acesso expirado': 'muted' }[t.status] || 'muted') },
  ].filter(Boolean);
}
function trainingsTab(a) {
  const list = all('trainings').filter((t) => t.accountId === a.id);
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Treinamento / acesso', () => openForm('trainings', { accountId: a.id }), 'primary')),
    section('Acesso a treinamentos e histórico', null, table(list, trainingCols(), { onRow: (t) => openForm('trainings', t), sort: { key: 'Período', dir: -1 } })),
  );
}

// ---- Whitespace
export const WS_STATES = { owned: ['Possui', 'ok', '●'], lapsed: ['TECS expirado', 'risk', 'T'], opp: ['Em oportunidade', 'info', 'O'], trial: ['Em avaliação', 'warn', 'A'], potencial: ['Potencial', 'accent', '?'], 'sem fit': ['Sem fit', 'muted', '×'] };
export function cycleWhitespace(a, key) {
  const cur = (a.whitespace || {})[key];
  const next = !cur ? 'potencial' : cur === 'potencial' ? 'sem fit' : null;
  const ws = { ...(a.whitespace || {}) };
  if (next) ws[key] = next;
  else delete ws[key];
  patch('accounts', a.id, { whitespace: ws });
}
function whitespaceTab(a) {
  const row = whitespaceRow(a);
  return h('div', null,
    section('Mapa de whitespace', h('small', { class: 'muted' }, 'Calculado a partir de licenças, oportunidades e avaliações. Clique numa família livre para marcar Potencial / Sem fit.'),
      h('div', { class: 'ws-grid' }, FAMILIES.map((f) => {
        const c = row[f.key];
        const [label, cls] = c ? WS_STATES[c.state] : ['Livre', 'free'];
        return h('div', { class: `ws-cell ${cls}`, onclick: () => (!c || c.manual) && cycleWhitespace(a, f.key), title: c && !c.manual ? 'Estado calculado automaticamente' : 'Clique para alternar' }, h('b', null, f.label), h('small', null, label));
      })),
      h('div', { class: 'legend' }, Object.values(WS_STATES).map(([l, c]) => h('span', { class: 'ws-dot ' + c }, l)), h('span', { class: 'ws-dot free' }, 'Livre')),
    ),
  );
}

// ---- Briefing (preparação de reunião / visita)
function briefing(a, s) {
  const db = store.db;
  const contacts = s.contacts.sort((x, y) => (Number(y.engagement) || 0) - (Number(x.engagement) || 0));
  const ints = db.interactions.filter((i) => i.accountId === a.id).sort((x, y) => (y.date || '').localeCompare(x.date || '')).slice(0, 5);
  const pool = db.techPool.filter((p) => p.accountId === a.id && ['Ativa', 'Solicitada'].includes(p.status));
  const ws = whitespaceRow(a);
  const free = FAMILIES.filter((f) => !ws[f.key] || ws[f.key].state === 'potencial').map((f) => f.label);
  const text = [
    `BRIEFING — ${a.name} (${fmt.date(today())})`,
    `${a.tier || ''} · ${a.status || ''} · Ansys #${a.ansysNumber || '—'} · Saúde ${s.score} (${HEALTH_LABEL[s.level]})`,
    a.strategy ? `Estratégia: ${a.strategy}` : '',
    '',
    'CONTATOS-CHAVE',
    ...contacts.slice(0, 8).map((c) => `- ${c.name} — ${c.title || ''} [${c.role || ''}, engajamento ${c.engagement || '-'}]`),
    '',
    'LICENÇAS',
    ...s.lic.map((l) => `- ${l.product}${l.qty ? ' x' + l.qty : ''} (${l.type || ''}) — ${l.status}${l.renewalDate ? ', renova em ' + fmt.date(l.renewalDate) : ''}`),
    '',
    'OPORTUNIDADES ABERTAS',
    ...s.opps.map((o) => `- ${o.name} — ${o.stage}${o.value ? ', ' + fmt.money(o.value, o.currency) : ''}${o.nextStep ? ' — próximo passo: ' + o.nextStep : ''}`),
    '',
    'ÚLTIMAS INTERAÇÕES',
    ...ints.map((i) => `- ${fmt.date(i.date)} ${i.type}: ${i.subject}${i.nextSteps ? ' → ' + i.nextSteps : ''}`),
    pool.length ? '\nAVALIAÇÕES EM CURSO\n' + pool.map((p) => `- ${p.products} (${p.kind}) até ${fmt.date(p.endDate)}`).join('\n') : '',
    '',
    'PONTOS DE ATENÇÃO',
    ...(s.reasons.length ? s.reasons.map((r) => '- ' + r.t) : ['- nenhum']),
    '',
    `WHITESPACE (famílias sem uso): ${free.join(', ') || '—'}`,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('Copiar briefing', () => copyText(text), 'primary'), btn('Imprimir / PDF', () => window.print())),
    h('div', { class: 'card print-area' }, h('pre', { class: 'report big' }, text)),
  );
}
