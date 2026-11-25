import { store, patch } from '../store.js';
import { h, section, openForm, btn, tabs, kpi, badge, table, dueBadge } from '../ui.js';
import { whitespaceRow, accName, meddicScore, isOpenPre, unitName, childrenOf } from '../engine.js';
import { ENUMS, PILLARS } from '../schema.js';
import { today, daysBetween, fmt } from '../util.js';
import { setParam } from '../main.js';
import { preCols, meddicBar, wsMatrix, cycleWs } from './accounts.js';

export default function prepipelineView({ params }) {
  const tab = params.tab || 'board';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Pré-pipeline'), h('p', { class: 'muted' }, 'Tudo o que vem antes de virar oportunidade no Salesforce: hipóteses, whitespaces, sementes e qualificação.')),
      h('div', { class: 'actions' }, btn('＋ Iniciativa', () => openForm('prospects', {}), 'primary'))),
    tabs([['board', 'Quadro por estágio'], ['list', 'Lista'], ['whitespace', 'Whitespace da carteira'], ['research', 'Pesquisa de fora para dentro']], tab, (k) => setParam('tab', k)),
    tab === 'whitespace' ? whitespace() : tab === 'research' ? research() : tab === 'list' ? list(params) : board(params),
  );
}

function filtered(params) {
  return store.db.prospects.filter((p) => (!params.src || p.source === params.src) && (!params.pil || p.pillar === params.pil));
}
function filters(params) {
  return h('div', { class: 'filters' },
    h('select', { onchange: (e) => setParam('src', e.target.value) }, h('option', { value: '' }, 'Todas as origens'), ENUMS.preSource.map((s) => h('option', { selected: s === params.src }, s))),
    h('select', { onchange: (e) => setParam('pil', e.target.value) }, h('option', { value: '' }, 'Todos os pilares'), PILLARS.map((s) => h('option', { selected: s === params.pil }, s))));
}

function board(params) {
  const all = filtered(params);
  const open = all.filter(isOpenPre);
  const ready = open.filter((p) => p.stage.startsWith('6'));
  const sum = (arr) => arr.reduce((s, p) => s + (Number(p.potential) || 0), 0);
  const inSf = all.filter((p) => p.stage === '✓ No Salesforce');
  const stages = ENUMS.preStage.filter((s) => !['Pausado', 'Descartado'].includes(s));
  const next = (st) => stages[Math.min(stages.indexOf(st) + 1, stages.length - 1)];
  return h('div', null,
    h('div', { class: 'kpis' },
      kpi('Iniciativas abertas', open.length, `potencial ${fmt.usd(sum(open))}`),
      kpi('Prontas para o Salesforce', ready.length, fmt.usd(sum(ready)), ready.length ? 'ok' : ''),
      kpi('Levadas ao Salesforce', inSf.length, `${fmt.usd(sum(inSf))} no total`),
      kpi('MEDDIC médio', open.length ? (open.reduce((s, p) => s + meddicScore(p), 0) / open.length).toFixed(1) + '/6' : '—', 'qualificação das abertas'),
      kpi('Sem próximo passo', open.filter((p) => !p.nextStepDate).length, 'iniciativas sem data', open.some((p) => !p.nextStepDate) ? 'warn' : ''),
    ),
    filters(params),
    h('div', { class: 'kanban wide' }, stages.map((st) => {
      const l = all.filter((p) => p.stage === st);
      return h('div', { class: 'col' + (st === '✓ No Salesforce' ? ' dim' : '') },
        h('div', { class: 'col-head' }, st, h('span', { class: 'count' }, l.length)),
        h('small', { class: 'muted block col-sum' }, fmt.usd(sum(l))),
        l.map((p) => {
          const idle = daysBetween((p.updatedAt || p.createdAt || today()).slice(0, 10), today());
          return h('div', { class: 'task', onclick: () => openForm('prospects', p) },
            h('b', null, p.title),
            h('small', { class: 'block muted' }, [accName(p.accountId), p.unitId && unitName(p.unitId)].filter(Boolean).join(' › ')),
            h('div', { class: 'task-meta' }, p.potential ? h('span', null, fmt.usd(p.potential)) : null, p.targetQuarter ? h('small', null, '⏱ ' + p.targetQuarter.replace('FY20', 'FY').replace('-T', ' Q')) : null, meddicBar(p), idle > 21 && st !== '✓ No Salesforce' ? badge(`parada ${idle}d`, 'warn') : null),
            p.nextStep ? h('small', { class: 'block' }, '→ ', p.nextStep, ' ', p.nextStepDate ? dueBadge(p.nextStepDate) : null) : null,
            st !== '✓ No Salesforce' ? h('div', { class: 'task-actions' }, h('button', { class: 'btn tiny ghost', onclick: (e) => { e.stopPropagation(); patch('prospects', p.id, { stage: next(st) }); } }, 'avançar →')) : (p.sfOpp ? h('small', { class: 'muted' }, 'SF: ' + p.sfOpp) : null));
        }));
    })),
    (() => {
      const parked = all.filter((p) => ['Pausado', 'Descartado'].includes(p.stage));
      return parked.length ? section(`Pausadas / descartadas (${parked.length})`, null, table(parked, preCols(true), { onRow: (p) => openForm('prospects', p) })) : null;
    })(),
  );
}

function list(params) {
  const rows = filtered(params);
  return h('div', null, filters(params), section(`${rows.length} iniciativas`, null, table(rows, preCols(true), { onRow: (p) => openForm('prospects', p), search: true, sort: { key: 'nextStepDate', dir: 1 } })));
}

function whitespace() {
  const db = store.db;
  const tops = db.accounts.filter((a) => a.status !== 'Saiu da carteira' && (!a.parentId || !db.accounts.some((x) => x.id === a.parentId)))
    .sort((a, b) => (a.segmentGroup || '').localeCompare(b.segmentGroup || '') || a.name.localeCompare(b.name, 'pt-BR'));
  const rows = [];
  tops.forEach((a) => {
    rows.push({ label: a.name, href: `#/account/${a.id}?tab=pre`, row: whitespaceRow(a), onCycle: (k) => cycleWs('accounts', a, k) });
    childrenOf(a.id).filter((c) => c.status !== 'Saiu da carteira').forEach((c) => rows.push({ label: '↳ ' + c.name, href: `#/account/${c.id}?tab=pre`, row: whitespaceRow(c), onCycle: (k) => cycleWs('accounts', c, k) }));
  });
  return section('Contas × famílias de produto', h('small', { class: 'muted' }, 'calculado a partir das licenças do portal, iniciativas e avaliações; “E” = já teve e expirou (bom candidato a reativação)'), wsMatrix(rows));
}

function research() {
  const db = store.db;
  const accs = db.accounts.filter((a) => a.status !== 'Saiu da carteira').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const q = (a, extra) => encodeURIComponent(`"${a.name.replace(/\s*[-–(].*$/, '')}" ${extra}`);
  return section('Atalhos de pesquisa por conta', h('small', { class: 'muted' }, 'notícias, editais, pessoas e vagas — registre o que achar como iniciativa'),
    h('ul', { class: 'list compact' }, accs.map((a) => h('li', null,
      h('div', { class: 'li-main' }, h('b', null, a.name), h('small', null, [a.segment, a.city].filter(Boolean).join(' · '))),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://news.google.com/search?q=${q(a, '')}&hl=pt-BR&gl=BR&ceid=BR:pt-419` }, 'Notícias'),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://www.google.com/search?q=${q(a, 'edital OR Finep OR Embrapii OR BNDES OR PADIS projeto')}` }, 'Editais / fomento'),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://www.linkedin.com/search/results/people/?keywords=${q(a, 'diretor OR gerente engenharia')}` }, 'LinkedIn'),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://www.google.com/search?q=${q(a, 'vaga engenheiro simulação Ansys OR Abaqus OR "Star-CCM" OR COMSOL')}` }, 'Vagas'),
      btn('＋ iniciativa', () => openForm('prospects', { accountId: a.id, direction: 'Fora → dentro', source: 'Notícia / edital / fomento' }), 'tiny'),
    ))));
}
