import { store, all, get, patch, upsert } from '../store.js';
import { h, table, openForm, healthBadge, badge, stageBadge, engagementDots, tabs, section, btn, kpi, copyText, dueBadge, toast, unitLabel } from '../ui.js';
import { accountStats, whitespaceRow, unitWhitespace, contactName, unitName, meddicScore, HEALTH_LABEL, childrenOf, familyIds, accPath, suggestSolutions, quarterKey, isOpenPre } from '../engine.js';
import { FAMILIES, ENUMS } from '../schema.js';
import { fmt, today, daysBetween } from '../util.js';
import { go, setParam, quickLog, quickTask, reportText } from '../main.js';
import { miniMap } from './map.js';

const accNameOf = (id) => get('accounts', id)?.name || '—';
const accLink = (id) => h('a', { href: `#/account/${id}`, class: 'link' }, accPath(id));
const fy = () => quarterKey().slice(0, 6);

// ---------------- Lista ----------------
export function accountsView({ params }) {
  const db = store.db;
  const f = { tier: params.tier || '', status: params.status || '', grp: params.grp || '', health: params.health || '' };
  const pass = (a, s) => (!f.tier || a.tier === f.tier) && (!f.status ? a.status !== 'Saiu da carteira' : a.status === f.status) && (!f.grp || a.segmentGroup === f.grp) && (!f.health || s.level === f.health);
  const rows = [];
  const parents = db.accounts.filter((a) => !a.parentId || !get('accounts', a.parentId));
  parents.forEach((a) => {
    const s = accountStats(a);
    const kids = childrenOf(a.id).map((c) => ({ a: c, s: accountStats(c), child: true })).filter((r) => pass(r.a, r.s));
    if (pass(a, s) || kids.length) rows.push({ a, s, kids });
  });
  const sel = (key, opts, label) => h('select', { onchange: (e) => setParam(key, e.target.value) }, h('option', { value: '' }, label), opts.map((o) => (Array.isArray(o) ? h('option', { value: o[0], selected: f[key] === o[0] }, o[1]) : h('option', { value: o, selected: f[key] === o }, o))));
  const flat = [];
  const sortKey = params.sort || 'name';
  const sorter = { name: (x, y) => x.a.name.localeCompare(y.a.name, 'pt-BR'), health: (x, y) => x.s.score - y.s.score, mrp: (x, y) => y.s.mrpFy - x.s.mrpFy, pre: (x, y) => y.s.prePotential - x.s.prePotential }[sortKey] || ((x, y) => 0);
  rows.sort(sorter).forEach((r) => { flat.push(r); r.kids.sort(sorter).forEach((k) => flat.push(k)); });
  const th = (label, key) => h('th', { class: 'sortable' + (key === sortKey ? ' on' : ''), onclick: () => setParam('sort', key) }, label, key === sortKey ? ' ▼' : '');

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Contas'), h('div', { class: 'actions' }, btn('＋ Nova conta', () => openForm('accounts', {}, { onSaved: (a) => go('#/account/' + a.id) }), 'primary'))),
    h('div', { class: 'filters' },
      sel('grp', ENUMS.segmentGroup, 'Todos os grupos do plano'),
      sel('tier', ENUMS.tier, 'Todas as classificações'),
      sel('status', ENUMS.accountStatus, 'Status (exceto fora da carteira)'),
      sel('health', [['ok', 'Saudável'], ['warn', 'Atenção'], ['risk', 'Risco']], 'Qualquer saúde'),
    ),
    section(`${flat.length} contas`, h('small', { class: 'muted' }, 'subcontas aparecem recuadas abaixo da conta-mãe; MRP e potencial da conta-mãe incluem as subcontas'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, th('Conta', 'name'), h('th', null, 'Classif.'), h('th', null, 'Status'), th('Saúde', 'health'), h('th', null, 'Último contato'), h('th', null, 'Próxima ação'), th(`MRP ${fy().replace('FY20', 'FY')}`, 'mrp'), th('Pré-pipeline', 'pre'))),
        h('tbody', null, flat.map((r) => h('tr', { class: 'click' + (r.child ? ' child' : ''), onclick: () => go('#/account/' + r.a.id) },
          h('td', null, h('div', { class: r.child ? 'indent' : '' }, h('b', null, (r.child ? '↳ ' : '') + r.a.name), h('small', { class: 'block muted' }, [r.a.sfName && r.a.sfName !== r.a.name ? r.a.sfName : null, r.a.ansysNumber && '#' + r.a.ansysNumber, r.a.city].filter(Boolean).join(' · ')))),
          h('td', null, badge(r.a.tier || '—', r.a.tier === 'Estratégica' ? 'accent' : '')),
          h('td', null, r.a.status),
          h('td', null, healthBadge(r.s)),
          h('td', null, r.s.lastContact ? h('span', null, fmt.date(r.s.lastContact), h('small', { class: 'block muted' }, fmt.rel(r.s.lastContact))) : h('span', { class: 'muted' }, 'nunca')),
          h('td', null, r.a.status === 'Saiu da carteira' || r.a.reactive ? '—' : h('span', null, r.s.nextAction.label, ' ', dueBadge(r.s.nextAction.date))),
          h('td', { class: 'num' }, r.s.mrpFy ? fmt.usd(r.s.mrpFy) : '—'),
          h('td', { class: 'num' }, r.s.pre.length ? h('span', null, fmt.usd(r.s.prePotential), h('small', { class: 'block muted' }, `${r.s.pre.length} iniciativa(s)`)) : '—'),
        ))),
      )),
    ),
  );
}

// ---------------- Detalhe ----------------
const TABS = [
  ['overview', 'Resumo'], ['map', 'Mapa da conta'], ['contacts', 'Pessoas & executivos'], ['licenses', 'Licenças, MRP & vendas'],
  ['pre', 'Pré-pipeline'], ['interactions', 'Histórico'], ['technical', 'Técnico & treinamentos'], ['briefing', 'Briefing'],
];

export function accountDetail({ id, params }) {
  const a = get('accounts', id);
  if (!a) return h('div', { class: 'page' }, h('p', null, 'Conta não encontrada. '), h('a', { href: '#/accounts' }, 'Voltar'));
  const s = accountStats(a);
  const tab = params.tab || 'overview';
  const parent = a.parentId && get('accounts', a.parentId);
  const counts = { map: s.units.length, contacts: s.contacts.length, licenses: s.lic.length, pre: s.pre.length };
  const body = { overview, map: mapTab, contacts: contactsTab, licenses: licensesTab, pre: preTab, interactions: historyTab, technical: technicalTab, briefing }[tab] || overview;
  return h('div', { class: 'page' },
    h('div', { class: 'crumbs' }, h('a', { href: '#/accounts' }, 'Contas'), parent ? [' / ', h('a', { href: '#/account/' + parent.id }, parent.name)] : ''),
    h('div', { class: 'page-head acc-head' },
      h('div', null,
        h('h1', null, a.name, ' ', healthBadge(s)),
        h('p', { class: 'muted' }, [a.tier, a.status, a.segmentGroup, a.segment, a.ansysNumber ? `Ansys #${a.ansysNumber}` : null, a.sfName && a.sfName !== a.name ? `SF: ${a.sfName}` : null].filter(Boolean).join(' · ')),
      ),
      h('div', { class: 'actions' },
        btn('＋ Registrar interação', () => quickLog({ accountId: a.id }), 'primary'),
        btn('＋ Iniciativa', () => openForm('prospects', { accountId: a.id })),
        btn('＋ Tarefa', () => quickTask({ accountId: a.id })),
        btn('Editar conta', () => openForm('accounts', a)),
      ),
    ),
    tabs(TABS.map(([k, l]) => [k, l, counts[k]]), tab, (k) => setParam('tab', k)),
    body(a, s),
  );
}

function overview(a, s) {
  const kids = childrenOf(a.id);
  const recent = timeline(a).slice(0, 6);
  return h('div', null,
    h('div', { class: 'kpis small' },
      kpi('Saúde', `${s.score}`, HEALTH_LABEL[s.level], s.level),
      kpi('Último contato', s.lastContact ? fmt.rel(s.lastContact) : 'nunca', `cadência: ${s.cad.contact} dias`, s.dContact == null || s.dContact > s.cad.contact ? 'warn' : ''),
      kpi('Última atividade técnica', s.lastTech ? fmt.rel(s.lastTech) : 'nunca', `meta: ${s.cad.tech} dias`, s.dTech == null || s.dTech > s.cad.tech ? 'warn' : ''),
      kpi(`MRP ${fy().replace('FY20', 'FY')}`, fmt.usd(s.mrpFy), s.mrpNext ? `próximo: ${s.mrpNext.period.replace('FY20', 'FY').replace('-T', ' Q')}` : 'sem MRP cadastrado'),
      kpi('Pré-pipeline', fmt.usd(s.prePotential), `${s.pre.length} iniciativa(s) abertas`),
      kpi('Próxima ação', fmt.date(s.nextAction.date), s.nextAction.label, s.nextAction.date < today() ? 'risk' : ''),
    ),
    kids.length ? section(`Subcontas (${kids.length})`, btn('＋ Subconta', () => openForm('accounts', { parentId: a.id, tier: a.tier, segmentGroup: a.segmentGroup, segment: a.segment }), 'small'),
      table(kids.map((k) => ({ k, s: accountStats(k) })), [
        { label: 'Subconta', sort: (r) => r.k.name, render: (r) => h('div', null, h('b', null, r.k.name), h('small', { class: 'block muted' }, [r.k.ansysNumber && '#' + r.k.ansysNumber, r.k.status].filter(Boolean).join(' · '))) },
        { label: 'Saúde', sort: (r) => r.s.score, render: (r) => healthBadge(r.s) },
        { label: 'Último contato', sort: (r) => r.s.lastContact || '', render: (r) => fmt.date(r.s.lastContact) },
        { label: 'MRP FY', sort: (r) => r.s.mrpFy, cls: 'num', render: (r) => (r.s.mrpFy ? fmt.usd(r.s.mrpFy) : '—') },
        { label: 'Licenças ativas', sort: (r) => r.s.lic.length, cls: 'num', render: (r) => r.s.lic.length || '—' },
        { label: 'Pré-pipeline', sort: (r) => r.s.prePotential, cls: 'num', render: (r) => (r.s.pre.length ? fmt.usd(r.s.prePotential) : '—') },
      ], { onRow: (r) => go('#/account/' + r.k.id), sort: { key: 'Subconta', dir: 1 } })) : null,
    h('div', { class: 'grid-2' },
      h('div', null,
        section('Diagnóstico', null,
          s.reasons.length ? h('ul', { class: 'reasons' }, s.reasons.map((r) => h('li', null, r.t))) : h('p', { class: 'c-ok' }, 'Tudo em dia nesta conta ✓')),
        section('Estratégia', btn('Editar', () => openForm('accounts', a), 'small ghost'),
          h('dl', { class: 'dl' },
            h('dt', null, 'Motor de crescimento'), h('dd', null, a.growthMotor || '—'),
            h('dt', null, 'Eventos motivadores'), h('dd', { class: 'pre-wrap' }, a.drivers || '—'),
            h('dt', null, 'Estratégia'), h('dd', { class: 'pre-wrap' }, a.strategy || '—'),
            h('dt', null, 'Concorrentes'), h('dd', null, a.competitors || '—'))),
        section('Dados da conta', btn('Editar', () => openForm('accounts', a), 'small ghost'),
          h('dl', { class: 'dl' },
            ...[['Nome no Salesforce', a.sfName], ['Ansys Number', a.ansysNumber], ['Razão social', a.legalName], ['CNPJ', a.cnpj], ['Endereço', [a.address, a.city, a.state].filter(Boolean).join(', ')],
              ['Site', a.website && h('a', { href: a.website, target: '_blank' }, a.website)], ['Organograma', a.orgChartUrl && h('a', { href: a.orgChartUrl, target: '_blank' }, 'abrir')], ['TAM (ESSS)', a.tam]]
              .flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v || '—')])),
          a.notes ? h('div', { class: 'note' }, a.notes) : null),
      ),
      h('div', null,
        a.parentId ? null : section('Localização', null, miniMap(a)),
        section('Próximo encontro executivo', h('a', { href: `#/account/${a.id}?tab=contacts`, class: 'link' }, 'Agenda →'),
          s.execNext ? h('div', null, h('b', null, s.execNext.title), h('small', { class: 'block muted' }, `${fmt.date(s.execNext.date)} · ${s.execNext.type} · ${s.execNext.status}`), s.execNext.objective ? h('small', { class: 'block' }, s.execNext.objective) : null)
            : h('div', { class: 'empty' }, 'Nenhum encontro executivo planejado.')),
        section('Atividade recente', h('a', { href: `#/account/${a.id}?tab=interactions`, class: 'link' }, 'Histórico completo →'), timelineList(recent)),
      ),
    ),
  );
}

// ---------------- Mapa da conta ----------------
export const PEN_CLS = { 'Usa Ansys': 'ok', 'Usa Ansys parcialmente': 'info', 'Usa concorrente': 'risk', 'Sem simulação': 'warn', 'Desconhecido': 'muted' };
export function unitForm(rec, opts = {}) {
  return openForm('units', rec, {
    ...opts,
    extra: (f) => h('div', { class: 'toolbar' },
      btn('✦ Sugerir soluções pelas palavras-chave', () => {
        const txt = ['description', 'products', 'challenges', 'compelling'].map((k) => f.inputs[k]?.value || '').join(' ');
        const sug = suggestSolutions(txt);
        if (!sug.length) return toast('Descreva produtos e desafios para gerar sugestões', 'warn');
        const cur = f.inputs.solutions.value.trim();
        const add = sug.filter((x) => !cur.includes(x));
        f.inputs.solutions.value = [cur, ...add.map((x) => '• ' + x)].filter(Boolean).join('\n');
        toast(`${add.length} sugestão(ões) adicionada(s) — revise antes de salvar`);
      }, 'small'),
      h('small', { class: 'muted' }, 'Sugestões automáticas são ponto de partida; valide com o time técnico.')),
  });
}

function mapTab(a, s) {
  const db = store.db;
  const ids = new Set(familyIds(a));
  const units = db.units.filter((u) => ids.has(u.accountId));
  const kids = childrenOf(a.id);
  const mapped = units.filter((u) => u.challenges && u.solutions);
  const withChamp = units.filter((u) => db.contacts.some((c) => c.unitId === u.id && c.role === 'Champion'));
  const usingAnsys = units.filter((u) => ['Usa Ansys', 'Usa Ansys parcialmente'].includes(u.penetration));
  const potential = units.reduce((t, u) => t + (Number(u.potential) || 0), 0);

  const unitCard = (u) => {
    const people = db.contacts.filter((c) => c.unitId === u.id && !c.inactive);
    const lic = db.licenses.filter((l) => l.unitId === u.id && ['Ativa', 'Não iniciada'].includes(l.status));
    const pre = db.prospects.filter((p) => p.unitId === u.id && isOpenPre(p));
    const childUnits = db.units.filter((x) => x.parentUnitId === u.id);
    return h('li', null,
      h('div', { class: 'unit-card prio-' + (u.priority || 'Média') },
        h('div', { class: 'unit-head', onclick: () => unitForm(u) },
          h('div', null, h('b', null, u.name), h('small', { class: 'muted' }, ` · ${u.type || ''}${u.users ? ` · ${u.users} eng.` : ''}`)),
          h('div', { class: 'unit-badges' }, badge(u.penetration || 'Desconhecido', PEN_CLS[u.penetration] || 'muted'), u.priority === 'Alta' ? badge('Prioridade alta', 'accent') : null, u.potential ? badge(fmt.usd(u.potential), 'info') : null)),
        h('div', { class: 'unit-body', onclick: () => unitForm(u) },
          u.products ? h('div', null, h('span', { class: 'lbl' }, 'Desenvolve'), u.products) : null,
          u.challenges ? h('div', null, h('span', { class: 'lbl' }, 'Desafios'), u.challenges) : h('div', { class: 'muted' }, h('span', { class: 'lbl' }, 'Desafios'), 'a mapear'),
          u.solutions ? h('div', null, h('span', { class: 'lbl' }, 'Soluções'), u.solutions) : null,
          u.value ? h('div', null, h('span', { class: 'lbl' }, 'Valor'), u.value) : null,
          u.nextAction ? h('div', { class: 'next' }, '→ ', u.nextAction) : null),
        h('div', { class: 'unit-foot' },
          people.length ? people.map((c) => h('span', { class: 'chip ' + roleCls(c.role), title: `${c.title || ''} · ${c.role || ''}`, onclick: () => openForm('contacts', c) }, c.name)) : h('small', { class: 'muted' }, 'sem pessoas mapeadas'),
          lic.length ? badge(`${lic.length} licença(s)`, 'ok') : null,
          pre.length ? badge(`${pre.length} iniciativa(s)`, 'info') : null,
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn tiny ghost', onclick: () => unitForm({ accountId: u.accountId, parentUnitId: u.id }) }, '＋ subunidade'),
          h('button', { class: 'btn tiny ghost', onclick: () => openForm('contacts', { accountId: u.accountId, unitId: u.id }) }, '＋ pessoa'),
          h('button', { class: 'btn tiny ghost', onclick: () => openForm('prospects', { accountId: u.accountId, unitId: u.id, products: u.solutions ? '' : '' }) }, '＋ iniciativa')),
      ),
      childUnits.length ? h('ul', null, childUnits.map(unitCard)) : null,
    );
  };
  const rootsOf = (accId) => units.filter((u) => u.accountId === accId && (!u.parentUnitId || !units.some((x) => x.id === u.parentUnitId)));
  const accBlock = (acc, isKid) => {
    const roots = rootsOf(acc.id);
    return h('li', null,
      h('div', { class: 'unit-card account-node' },
        h('div', { class: 'unit-head' },
          h('div', null, h('b', null, isKid ? h('a', { href: `#/account/${acc.id}?tab=map`, class: 'link' }, acc.name) : acc.name), h('small', { class: 'muted' }, ` · ${isKid ? 'subconta' : 'conta'}${acc.ansysNumber ? ' #' + acc.ansysNumber : ''}`)),
          h('div', { class: 'unit-badges' }, badge(acc.status, acc.status === 'Cliente ativo' ? 'ok' : acc.status === 'Prospect' ? 'warn' : 'muted'), healthBadge(accountStats(acc)))),
        h('div', { class: 'unit-foot' }, h('span', { class: 'spacer' }), h('button', { class: 'btn tiny', onclick: () => unitForm({ accountId: acc.id }) }, '＋ unidade'))),
      roots.length ? h('ul', null, roots.map(unitCard)) : null);
  };

  return h('div', null,
    h('div', { class: 'toolbar' },
      btn('＋ Unidade / departamento', () => unitForm({ accountId: a.id }), 'primary'),
      kids.length ? null : btn('＋ Subconta', () => openForm('accounts', { parentId: a.id, tier: a.tier, segmentGroup: a.segmentGroup, segment: a.segment })),
      a.orgChartUrl ? h('a', { class: 'btn ghost', target: '_blank', href: a.orgChartUrl }, 'Organograma ↗') : null,
      a.website ? h('a', { class: 'btn ghost', target: '_blank', href: a.website }, 'Site ↗') : null),
    h('div', { class: 'kpis small' },
      kpi('Unidades mapeadas', `${mapped.length}/${units.length}`, 'com desafios e soluções preenchidos', units.length && mapped.length < units.length ? 'warn' : ''),
      kpi('Usam Ansys', usingAnsys.length, `de ${units.length} unidades`),
      kpi('Com champion', withChamp.length, 'unidades com champion identificado', units.length && !withChamp.length ? 'warn' : ''),
      kpi('Pessoas-chave', db.contacts.filter((c) => ids.has(c.accountId) && !c.inactive).length, 'contatos na conta'),
      kpi('Potencial mapeado', fmt.usd(potential), 'soma das unidades (USD NTA)'),
    ),
    section('Contexto da conta', btn('Editar', () => openForm('accounts', a), 'small ghost'),
      h('div', { class: 'grid-3 tight' },
        h('div', null, h('span', { class: 'lbl' }, 'Motor de crescimento'), h('p', null, a.growthMotor || '—')),
        h('div', null, h('span', { class: 'lbl' }, 'Iniciativas e eventos motivadores'), h('p', { class: 'pre-wrap' }, a.drivers || '—')),
        h('div', null, h('span', { class: 'lbl' }, 'Estratégia'), h('p', { class: 'pre-wrap' }, a.strategy || '—')))),
    section('Estrutura, pessoas e oportunidades de valor', h('small', { class: 'muted' }, 'clique numa unidade para editar; a cor da borda indica a prioridade'),
      h('div', { class: 'org units' }, h('ul', null, accBlock(a, false), kids.map((k) => accBlock(k, true))))),
    units.length ? section('Matriz unidade × domínio (pilar Portfolio)', h('small', { class: 'muted' }, 'onde cada unidade já usa Ansys e onde há espaço; clique nas células livres para marcar Potencial / Sem fit'),
      wsMatrix([{ label: h('b', null, 'Conta inteira'), row: whitespaceRow(a), onCycle: (k) => cycleWs('accounts', a, k) }, ...units.map((u) => ({ label: unitLabel(u), row: unitWhitespace(u), onCycle: (k) => cycleWs('units', u, k) }))]),
      h('small', { class: 'muted block' }, 'Licenças, iniciativas e avaliações aparecem na linha da unidade quando o campo “Unidade” está preenchido neles.')) : null,
  );
}

// ---- Pessoas & executivos
function contactsTab(a, s) {
  const db = store.db;
  const ids = new Set(familyIds(a));
  const list = db.contacts.filter((c) => ids.has(c.accountId));
  const cids = new Set(list.map((c) => c.id));
  const kids = (pid) => list.filter((c) => c.reportsTo === pid);
  const lvl = (c) => ['Executivo', 'Gerencial', 'Técnico', 'Operacional'].indexOf(c.level);
  const roots = list.filter((c) => !c.reportsTo || !cids.has(c.reportsTo)).sort((x, y) => lvl(x) - lvl(y));
  const node = (c) => h('li', null,
    h('div', { class: 'org-card' + (c.inactive ? ' inactive' : '') + (c.role === 'Champion' ? ' champ' : ''), onclick: () => openForm('contacts', c) },
      h('b', null, c.name), h('small', null, [c.title, c.unitId && unitName(c.unitId), c.accountId !== a.id && accNameOf(c.accountId)].filter(Boolean).join(' · ')), h('div', { class: 'org-meta' }, badge(c.role || '—', roleCls(c.role)), engagementDots(c.engagement))),
    kids(c.id).length ? h('ul', null, kids(c.id).map(node)) : null,
  );
  const eng = db.engagements.filter((e) => ids.has(e.accountId)).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Novo contato', () => openForm('contacts', { accountId: a.id }), 'primary'), btn('＋ Encontro executivo', () => openForm('engagements', { accountId: a.id, date: today() })),
      h('span', { class: 'muted small' }, `${list.filter((c) => c.role === 'Champion').length} champion(s) · ${list.filter((c) => c.level === 'Executivo').length} executivo(s) · engajamento médio ${list.length ? (list.reduce((t, c) => t + (Number(c.engagement) || 0), 0) / list.length).toFixed(1) : '—'}`)),
    section('Agenda executiva (Executive & Champion Alignment)', null, table(eng, engagementCols(false), { onRow: (e) => openForm('engagements', e), empty: 'Nenhum encontro executivo registrado ou planejado.' })),
    section('Hierarquia e engajamento', h('small', { class: 'muted' }, 'defina “Reporta-se a” em cada contato para montar a árvore'),
      list.length ? h('div', { class: 'org' }, h('ul', null, roots.map(node))) : h('div', { class: 'empty' }, 'Nenhum contato cadastrado.')),
    section('Lista', null, table(list, [
      { label: 'Nome', key: 'name', render: (c) => h('b', null, c.name) },
      { label: 'Cargo', key: 'title' },
      { label: 'Unidade', sort: (c) => unitName(c.unitId), render: (c) => unitName(c.unitId) || '—' },
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
export function engagementCols(showAcc = true) {
  return [
    { label: 'Data', key: 'date', render: (e) => h('span', null, fmt.date(e.date), e.dateTbd ? h('small', { class: 'block muted' }, 'a confirmar') : null) },
    { label: 'Encontro', key: 'title', render: (e) => h('div', null, h('b', null, e.title), h('small', { class: 'block muted' }, [e.type, e.location].filter(Boolean).join(' · '))) },
    showAcc ? { label: 'Conta', sort: (e) => accNameOf(e.accountId), render: (e) => (e.accountId ? accLink(e.accountId) : '—') } : null,
    { label: 'Executivos / público', render: (e) => h('small', null, [(e.contactIds || []).map(contactName).filter(Boolean).join(', '), e.audience].filter(Boolean).join(' · ') || '—') },
    { label: 'Objetivo', key: 'objective', render: (e) => h('small', null, e.objective || '—') },
    { label: 'Status', key: 'status', render: (e) => badge(e.status, { Realizada: 'ok', Agendada: 'info', Planejada: 'warn', Cancelada: 'muted' }[e.status]) },
  ].filter(Boolean);
}

// ---- Licenças, MRP & vendas
export function licenseCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (l) => accNameOf(l.accountId), render: (l) => h('b', null, accPath(l.accountId)) } : null,
    { label: 'Produto', key: 'product', render: (l) => h('div', null, h('b', null, l.product), l.unitId ? h('small', { class: 'block muted' }, unitName(l.unitId)) : null) },
    { label: 'Tipo', key: 'type' },
    { label: 'Qtd', key: 'qty', cls: 'num' },
    { label: 'Situação', key: 'status', render: (l) => h('span', null, badge(l.status || '—', { Ativa: 'ok', 'Não iniciada': 'info', Expirada: 'muted' }[l.status] || 'muted'), l.maintenance === 'Manutenção vencida' ? h('small', { class: 'block c-risk' }, 'manutenção vencida') : null) },
    { label: 'Início', key: 'startDate', render: (l) => fmt.date(l.startDate) },
    { label: 'Expiração', key: 'renewalDate', render: (l) => (l.type === 'Perpetual' && l.status === 'Ativa' ? h('span', null, 'Permanente', l.renewalDate ? h('small', { class: 'block muted' }, 'manut. até ' + fmt.date(l.renewalDate)) : null) : l.renewalDate ? h('span', null, fmt.date(l.renewalDate), ' ', l.status === 'Ativa' && l.renewalDate >= today() && daysBetween(today(), l.renewalDate) <= 90 ? badge(fmt.rel(l.renewalDate), 'warn') : null) : '—') },
  ].filter(Boolean);
}
export function mrpCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (m) => accNameOf(m.accountId), render: (m) => h('b', null, accPath(m.accountId)) } : null,
    { label: 'Trimestre', key: 'period', render: (m) => m.period.replace('FY20', 'FY').replace('-T', ' · Q') },
    { label: 'MRP', key: 'value', cls: 'num', sort: (m) => Number(m.value) || 0, render: (m) => fmt.usdFull(m.value) },
    { label: 'Renovado', key: 'renewed', cls: 'num', sort: (m) => Number(m.renewed) || 0, render: (m) => (m.renewed != null && m.renewed !== '' ? fmt.usdFull(m.renewed) : '—') },
    { label: 'Status', key: 'status', render: (m) => badge(m.status || 'Aberto', { Renovado: 'ok', 'Renovado parcial': 'warn', Perdido: 'risk', Aberto: 'info' }[m.status || 'Aberto']) },
    { label: 'Oportunidade SF', key: 'sfOpp', render: (m) => h('small', null, m.sfOpp || '—') },
  ].filter(Boolean);
}
export function saleCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (s) => accNameOf(s.accountId), render: (s) => h('b', null, accPath(s.accountId)) } : null,
    { label: 'Data', key: 'date', render: (s) => fmt.date(s.date) },
    { label: 'Oportunidade', key: 'description', render: (s) => h('div', null, h('b', null, s.description), s.revenueClass ? h('small', { class: 'block muted' }, s.revenueClass) : null) },
    { label: 'Tipo', key: 'type', render: (s) => badge(s.type, s.type === 'NB' ? 'accent' : s.type === 'RR' ? 'info' : 'muted') },
    { label: 'Fechado por', key: 'bookedBy' },
    { label: 'Valor (NTA)', key: 'value', cls: 'num', sort: (s) => Number(s.value) || 0, render: (s) => fmt.usdFull(s.value) },
  ].filter(Boolean);
}
function licensesTab(a, s) {
  const db = store.db;
  const ids = new Set(familyIds(a));
  const showAll = new URLSearchParams(location.hash.split('?')[1] || '').get('exp') === '1';
  const lic = db.licenses.filter((l) => ids.has(l.accountId) && (showAll || l.status !== 'Expirada'));
  const nExp = db.licenses.filter((l) => ids.has(l.accountId) && l.status === 'Expirada').length;
  const mrp = db.mrp.filter((m) => ids.has(m.accountId));
  const sales = db.sales.filter((x) => ids.has(x.accountId));
  const fyKey = (d) => { const fe = db.settings.fyEndMonth; const [y, m] = d.split('-').map(Number); return 'FY' + String(m > fe ? y + 1 : y).slice(2); };
  const byFy = {};
  sales.forEach((x) => { const k = fyKey(x.date); byFy[k] = byFy[k] || { NB: 0, RR: 0 }; if (x.type !== 'Compliance') byFy[k][x.type] += Number(x.value) || 0; });
  const many = ids.size > 1;
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ MRP', () => openForm('mrp', { accountId: a.id, period: quarterKey() }), 'primary'), btn('＋ Licença', () => openForm('licenses', { accountId: a.id })), btn('＋ Venda', () => openForm('sales', { accountId: a.id, date: today() }))),
    section('Renovações (MRP — Maximum Renewal Possible)', h('small', { class: 'muted' }, 'USD NTA'), table(mrp, mrpCols(many), { onRow: (m) => openForm('mrp', m), sort: { key: 'period', dir: 1 }, empty: 'Nenhum MRP cadastrado.' })),
    section(`Licenças (${lic.length})`, nExp ? h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: showAll, onchange: (e) => setParam('exp', e.target.checked ? '1' : '') }), ` mostrar ${nExp} expiradas`) : null,
      table(lic, licenseCols(many), { onRow: (l) => openForm('licenses', l), sort: { key: 'renewalDate', dir: 1 }, search: lic.length > 10 })),
    section('Histórico de vendas (USD NTA)', h('div', { class: 'fy-strip' }, Object.keys(byFy).sort().map((k) => h('span', null, h('b', null, k), ` NB ${fmt.usd(byFy[k].NB)} · RR ${fmt.usd(byFy[k].RR)}`))),
      table(sales, saleCols(many), { onRow: (x) => openForm('sales', x), sort: { key: 'date', dir: -1 }, empty: 'Nenhuma venda registrada.' })),
  );
}

// ---- Pré-pipeline
export function preCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (p) => accNameOf(p.accountId), render: (p) => accLink(p.accountId) } : null,
    { label: 'Iniciativa', key: 'title', render: (p) => h('div', null, h('b', null, p.title), h('small', { class: 'block muted' }, [p.unitId && unitName(p.unitId), p.products].filter(Boolean).join(' · '))) },
    { label: 'Estágio', key: 'stage', render: (p) => stageBadge(p.stage) },
    { label: 'Origem', key: 'source', render: (p) => h('small', null, p.source || '—') },
    { label: 'Potencial', key: 'potential', cls: 'num', sort: (p) => Number(p.potential) || 0, render: (p) => fmt.usd(p.potential) },
    { label: 'Alvo', key: 'targetQuarter', render: (p) => (p.targetQuarter ? p.targetQuarter.replace('FY20', 'FY').replace('-T', ' Q') : '—') },
    { label: 'MEDDIC', sort: (p) => meddicScore(p), render: (p) => meddicBar(p) },
    { label: 'Próximo passo', key: 'nextStepDate', render: (p) => h('small', null, p.nextStep || '—', ' ', p.nextStepDate ? dueBadge(p.nextStepDate) : null) },
  ].filter(Boolean);
}
export function meddicBar(o) {
  const n = meddicScore(o);
  const keys = ['m_metrics', 'm_economicBuyer', 'm_decisionCriteria', 'm_decisionProcess', 'm_pain', 'm_champion'];
  return h('span', { class: 'meddic', title: `${n}/6 elementos MEDDIC preenchidos` }, 'MEDDIC'.split('').map((ch, i) => h('i', { class: o[keys[i]] ? 'on' : '' }, ch)));
}
function preTab(a) {
  const ids = new Set(familyIds(a));
  const list = all('prospects').filter((p) => ids.has(p.accountId));
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Iniciativa', () => openForm('prospects', { accountId: a.id }), 'primary')),
    section('Iniciativas abertas', null, table(list.filter(isOpenPre), preCols(ids.size > 1), { onRow: (p) => openForm('prospects', p), empty: 'Nenhuma iniciativa aberta. Comece pelo mapa da conta: cada unidade com desafio + solução aderente é uma hipótese.' })),
    section('Encerradas (no Salesforce, pausadas ou descartadas)', null, table(list.filter((p) => !isOpenPre(p)), preCols(ids.size > 1), { onRow: (p) => openForm('prospects', p), empty: '—' })),
    section('Whitespace da conta', h('small', { class: 'muted' }, 'por família de produto, considerando todas as subcontas'),
      wsMatrix([{ label: a.name, row: whitespaceRow(a), onCycle: (k) => cycleWs('accounts', a, k) }])),
  );
}

// ---- Whitespace
export const WS_STATES = { owned: ['Possui', 'ok', '●'], lapsed: ['Manutenção vencida', 'risk', 'M'], opp: ['Iniciativa aberta', 'info', 'I'], trial: ['Em avaliação', 'warn', 'A'], expired: ['Já teve (expirada)', 'muted2', 'E'], potencial: ['Potencial', 'accent', '?'], 'sem fit': ['Sem fit', 'muted', '×'] };
export function cycleWs(coll, rec, key) {
  const cur = (rec.whitespace || {})[key];
  const next = !cur ? 'potencial' : cur === 'potencial' ? 'sem fit' : null;
  const ws = { ...(rec.whitespace || {}) };
  if (next) ws[key] = next;
  else delete ws[key];
  patch(coll, rec.id, { whitespace: ws });
}
export function wsMatrix(rows) {
  const totals = Object.fromEntries(FAMILIES.map((f) => [f.key, 0]));
  rows.forEach((r) => FAMILIES.forEach((f) => (!r.row[f.key] || r.row[f.key].state === 'expired') && totals[f.key]++));
  return h('div', null,
    h('div', { class: 'ws-table-wrap' }, h('table', { class: 'ws-table' },
      h('thead', null, h('tr', null, h('th', null, ''), FAMILIES.map((f) => h('th', { class: 'rot' }, h('span', null, f.label))))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, r.href ? h('a', { href: r.href, class: 'link' }, r.label) : r.label),
        FAMILIES.map((f) => {
          const c = r.row[f.key];
          const [label, cls, ab] = c ? WS_STATES[c.state] : ['', 'free', ''];
          const clickable = !c || c.manual || c.state === 'expired';
          return h('td', { class: `ws ${cls}`, title: `${f.label}: ${label || 'Livre'}`, onclick: () => clickable && r.onCycle(f.key) }, ab);
        }))),
        rows.length > 1 ? h('tr', { class: 'tot' }, h('td', null, 'Livres'), FAMILIES.map((f) => h('td', null, totals[f.key]))) : null))),
    h('div', { class: 'legend' }, Object.values(WS_STATES).map(([l, c, ab]) => h('span', { class: 'ws-dot ' + c }, `${ab} ${l}`)), h('span', { class: 'ws-dot free' }, 'vazio = livre')));
}

// ---- Histórico (linha do tempo)
export function timeline(a) {
  const db = store.db;
  const ids = new Set(familyIds(a));
  const m = (r) => ids.has(r.accountId);
  return [
    ...db.interactions.filter(m).map((i) => ({ date: i.date, kind: i.type, icon: '💬', title: i.subject, sub: [i.summary, i.nextSteps && 'Próximos: ' + i.nextSteps].filter(Boolean).join(' · '), open: () => openForm('interactions', i), rec: i })),
    ...db.techActivities.filter(m).map((t) => ({ date: t.date, kind: t.type, icon: '⚙', title: t.title, sub: [t.specialist, t.status, t.result !== '—' && t.result].filter(Boolean).join(' · '), open: () => openForm('techActivities', t) })),
    ...db.engagements.filter(m).filter((e) => e.status === 'Realizada').map((e) => ({ date: e.date, kind: e.type, icon: '★', title: e.title, sub: e.outcome || e.objective || '', open: () => openForm('engagements', e) })),
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
    section('Linha do tempo', h('small', { class: 'muted' }, 'interações, atividades técnicas, encontros executivos, treinamentos e avaliações'), timelineList(timeline(a))),
  );
}

// ---- Técnico & treinamentos
export function techCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (t) => accNameOf(t.accountId), render: (t) => h('b', null, accPath(t.accountId)) } : null,
    { label: 'Data', key: 'date', render: (t) => fmt.date(t.date) },
    { label: 'Tipo', key: 'type' },
    { label: 'Tema', key: 'title', render: (t) => h('div', null, h('b', null, t.title), h('small', { class: 'block muted' }, [t.unitId && unitName(t.unitId), t.products].filter(Boolean).join(' · '))) },
    { label: 'Especialista', key: 'specialist' },
    { label: 'Status', key: 'status', render: (t) => badge(t.status, t.status === 'Realizada' ? 'ok' : t.status === 'Planejada' ? 'info' : 'muted') },
    { label: 'Resultado', key: 'result' },
    { label: 'Horas', key: 'hours', cls: 'num' },
  ].filter(Boolean);
}
export function poolCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (p) => accNameOf(p.accountId), render: (p) => h('b', null, accPath(p.accountId)) } : null,
    { label: 'Tipo', key: 'kind' },
    { label: 'Licenças', key: 'products', render: (p) => h('b', null, p.products) },
    { label: 'Qtd', key: 'qty', cls: 'num' },
    { label: 'Período', sort: (p) => p.endDate || '', render: (p) => `${fmt.date(p.startDate)} → ${fmt.date(p.endDate)}` },
    { label: 'Status', key: 'status', render: (p) => h('span', null, badge(p.status, { Ativa: 'info', 'Convertida em venda': 'ok', 'Não converteu': 'risk', Solicitada: 'warn' }[p.status] || 'muted'), ' ', p.status === 'Ativa' && p.endDate ? dueBadge(p.endDate) : null) },
    { label: 'Objetivo', key: 'purpose', render: (p) => h('small', null, p.purpose || '—') },
  ].filter(Boolean);
}
export function trainingCols(showAcc = false) {
  return [
    showAcc ? { label: 'Conta', sort: (t) => accNameOf(t.accountId), render: (t) => h('b', null, accPath(t.accountId)) } : null,
    { label: 'Curso / conteúdo', key: 'course', render: (t) => h('b', null, t.course) },
    { label: 'Plataforma', key: 'platform' },
    { label: 'Participantes', render: (t) => h('small', null, (t.contactIds || []).map(contactName).filter(Boolean).join(', ') || (t.seats ? `${t.seats} vagas` : '—')) },
    { label: 'Período', sort: (t) => t.startDate || '', render: (t) => `${fmt.date(t.startDate)} → ${fmt.date(t.endDate)}` },
    { label: 'Status', key: 'status', render: (t) => badge(t.status || '—', { Concluído: 'ok', 'Acesso ativo': 'info', 'Em andamento': 'info', Planejado: 'warn', 'Acesso expirado': 'muted' }[t.status] || 'muted') },
  ].filter(Boolean);
}
function technicalTab(a) {
  const ids = new Set(familyIds(a));
  const by = (c) => all(c).filter((r) => ids.has(r.accountId));
  const acts = by('techActivities');
  const many = ids.size > 1;
  return h('div', null,
    h('div', { class: 'toolbar' }, btn('＋ Atividade técnica', () => openForm('techActivities', { accountId: a.id, date: today() }), 'primary'), btn('＋ Tech Pool / Temp Key', () => openForm('techPool', { accountId: a.id, startDate: today() })), btn('＋ Treinamento / acesso ALH', () => openForm('trainings', { accountId: a.id }))),
    section('Atividades técnicas', h('small', { class: 'muted' }, `${acts.filter((t) => t.status === 'Realizada').length} realizadas · ${acts.reduce((t, x) => t + (Number(x.hours) || 0), 0)} h`), table(acts, techCols(many), { onRow: (t) => openForm('techActivities', t), sort: { key: 'date', dir: -1 }, empty: 'Nenhuma atividade técnica registrada.' })),
    section('Tech Pool & Temp Keys', null, table(by('techPool'), poolCols(many), { onRow: (p) => openForm('techPool', p), empty: 'Nenhuma licença temporária registrada.' })),
    section('Treinamentos e Learning Hub', null, table(by('trainings'), trainingCols(many), { onRow: (t) => openForm('trainings', t), empty: 'Nenhum treinamento ou acesso registrado.' })),
  );
}

// ---- Briefing (preparação de reunião / visita)
function briefing(a, s) {
  const db = store.db;
  const contacts = [...s.contacts].sort((x, y) => (Number(y.engagement) || 0) - (Number(x.engagement) || 0));
  const ints = db.interactions.filter((i) => s.ids.has(i.accountId)).sort((x, y) => (y.date || '').localeCompare(x.date || '')).slice(0, 5);
  const pool = db.techPool.filter((p) => s.ids.has(p.accountId) && ['Ativa', 'Solicitada'].includes(p.status));
  const ws = whitespaceRow(a);
  const free = FAMILIES.filter((f) => !ws[f.key] || ['potencial', 'expired'].includes(ws[f.key].state)).map((f) => f.label);
  const licSum = {};
  s.lic.forEach((l) => (licSum[l.product] = (licSum[l.product] || 0) + (Number(l.qty) || 1)));
  const text = [
    `BRIEFING — ${a.name} (${fmt.date(today())})`,
    `${a.tier || ''} · ${a.status || ''} · Ansys #${a.ansysNumber || '—'} · Saúde ${s.score} (${HEALTH_LABEL[s.level]})`,
    a.drivers ? `Eventos motivadores: ${a.drivers}` : '',
    a.strategy ? `Estratégia: ${a.strategy}` : '',
    '',
    'UNIDADES E DESAFIOS',
    ...(s.units.length ? s.units.map((u) => `- ${unitLabel(u)} [${u.penetration || '?'}]${u.challenges ? ': ' + u.challenges.replace(/\n/g, ' ') : ''}${u.solutions ? ' → ' + u.solutions.replace(/\n/g, ' ') : ''}`) : ['- mapa da conta ainda vazio']),
    '',
    'PESSOAS-CHAVE',
    ...contacts.slice(0, 10).map((c) => `- ${c.name} — ${c.title || ''} [${c.role || ''}, engajamento ${c.engagement || '-'}]`),
    '',
    'LICENÇAS ATIVAS',
    ...Object.entries(licSum).map(([p, q]) => `- ${p} x${q}`),
    s.mrpNext ? `\nPRÓXIMA RENOVAÇÃO: ${s.mrpNext.period} — MRP ${fmt.usdFull(s.mrpNext.value)} (${s.mrpNext.status})` : '',
    '',
    'PRÉ-PIPELINE',
    ...(s.pre.length ? s.pre.map((p) => `- ${p.title} — ${p.stage}${p.potential ? ', ' + fmt.usd(p.potential) : ''}${p.nextStep ? ' — próximo passo: ' + p.nextStep : ''}`) : ['- nenhuma iniciativa aberta']),
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
export { upsert };
