import { store, patch } from '../store.js';
import { h, section, openForm, btn, tabs, kpi, badge } from '../ui.js';
import { whitespaceRow, accName } from '../engine.js';
import { ENUMS, FAMILIES } from '../schema.js';
import { today, daysBetween } from '../util.js';
import { setParam, go } from '../main.js';
import { WS_STATES, cycleWhitespace } from './accounts.js';

export default function prospectingView({ params }) {
  const tab = params.tab || 'board';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Prospecção'), h('div', { class: 'actions' },
      btn('＋ Fora → dentro', () => openForm('prospects', { direction: 'Fora → dentro', source: 'Notícia' }), 'primary'),
      btn('＋ Dentro → fora', () => openForm('prospects', { direction: 'Dentro → fora', source: 'Interação com cliente' })))),
    tabs([['board', 'Funil de prospecção'], ['whitespace', 'Mapa de whitespace'], ['research', 'Pesquisa por conta']], tab, (k) => setParam('tab', k)),
    tab === 'whitespace' ? whitespace() : tab === 'research' ? research() : board(params),
  );
}

function board(params) {
  const db = store.db;
  const dir = params.dir || '';
  const list = db.prospects.filter((p) => !dir || p.direction === dir);
  const stages = ENUMS.prospectStatus;
  const active = list.filter((p) => !['Virou oportunidade', 'Descartado', 'Pausado'].includes(p.status));
  const conv = list.filter((p) => p.status === 'Virou oportunidade').length;
  return h('div', null,
    h('div', { class: 'kpis' },
      kpi('Itens ativos', active.length, 'em investigação'),
      kpi('Fora → dentro', list.filter((p) => p.direction === 'Fora → dentro').length, 'pesquisa, notícias, whitespace', '', () => setParam('dir', 'Fora → dentro')),
      kpi('Dentro → fora', list.filter((p) => p.direction === 'Dentro → fora').length, 'interações, indicações', '', () => setParam('dir', 'Dentro → fora')),
      kpi('Viraram oportunidade', conv, list.length ? Math.round((conv / list.length) * 100) + '% de conversão' : ''),
    ),
    dir ? h('div', { class: 'filters' }, badge(dir, 'info'), btn('limpar filtro', () => setParam('dir', ''), 'tiny ghost')) : null,
    h('div', { class: 'kanban wide' }, stages.map((st) => {
      const l = list.filter((p) => (p.status || 'Ideia') === st);
      return h('div', { class: 'col' + (['Descartado', 'Pausado'].includes(st) ? ' dim' : '') },
        h('div', { class: 'col-head' }, st, h('span', { class: 'count' }, l.length)),
        l.map((p) => {
          const idle = daysBetween((p.updatedAt || p.createdAt || today()).slice(0, 10), today());
          return h('div', { class: 'task', onclick: () => openForm('prospects', p) },
            h('b', null, p.title),
            h('small', { class: 'block muted' }, p.accountId ? accName(p.accountId) : p.company || ''),
            h('div', { class: 'task-meta' }, badge(p.direction === 'Fora → dentro' ? '↘ fora→dentro' : '↗ dentro→fora', 'muted'), h('small', null, p.source || ''), idle > 14 ? badge(`parado ${idle}d`, 'warn') : null),
            p.nextStep ? h('small', { class: 'block' }, '→ ' + p.nextStep) : null,
            h('div', { class: 'task-actions' },
              st !== 'Virou oportunidade' ? h('button', { class: 'btn tiny ghost', onclick: (e) => { e.stopPropagation(); const i = stages.indexOf(st); patch('prospects', p.id, { status: stages[Math.min(i + 1, 4)] }); } }, 'avançar →') : null,
              st !== 'Virou oportunidade' && p.accountId ? h('button', { class: 'btn tiny', onclick: (e) => { e.stopPropagation(); openForm('opportunities', { accountId: p.accountId, name: p.title, products: p.products, value: p.potential, stage: '0 · Seeding', notes: p.description }, { onSaved: () => patch('prospects', p.id, { status: 'Virou oportunidade' }) }); } }, 'criar oportunidade') : null));
        }));
    })),
  );
}

function whitespace() {
  const db = store.db;
  const accs = db.accounts.filter((a) => !['Repassada', 'Ex-cliente'].includes(a.status)).sort((a, b) => (a.group || a.name).localeCompare(b.group || b.name, 'pt-BR'));
  const totals = Object.fromEntries(FAMILIES.map((f) => [f.key, 0]));
  const rows = accs.map((a) => {
    const r = whitespaceRow(a);
    FAMILIES.forEach((f) => !r[f.key] && totals[f.key]++);
    return [a, r];
  });
  return section('Contas × famílias de produto', h('small', { class: 'muted' }, 'Células livres = espaço em branco. Clique para marcar Potencial → Sem fit → limpar.'),
    h('div', { class: 'ws-table-wrap' },
      h('table', { class: 'ws-table' },
        h('thead', null, h('tr', null, h('th', null, 'Conta'), FAMILIES.map((f) => h('th', { class: 'rot' }, h('span', null, f.label))))),
        h('tbody', null, rows.map(([a, r]) => h('tr', null,
          h('td', null, h('a', { href: `#/account/${a.id}?tab=whitespace`, class: 'link' }, a.name)),
          FAMILIES.map((f) => {
            const c = r[f.key];
            const [label, cls, ab] = c ? WS_STATES[c.state] : ['', 'free', ''];
            return h('td', { class: `ws ${cls}`, title: `${f.label}: ${label || 'Livre'}`, onclick: () => (!c || c.manual) && cycleWhitespace(a, f.key) }, ab);
          }))),
          h('tr', { class: 'tot' }, h('td', null, 'Contas livres'), FAMILIES.map((f) => h('td', null, totals[f.key]))),
        ),
      ),
    ),
    h('div', { class: 'legend' }, Object.values(WS_STATES).map(([l, c, ab]) => h('span', { class: 'ws-dot ' + c }, `${ab} ${l}`)), h('span', { class: 'ws-dot free' }, 'vazio = livre')),
  );
}

function research() {
  const db = store.db;
  const accs = db.accounts.filter((a) => a.status !== 'Repassada').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const q = (a, extra) => encodeURIComponent(`"${a.name}" ${extra}`);
  return section('Pesquisa de fora para dentro', h('small', { class: 'muted' }, 'Atalhos de busca por conta — registre o que achar como item de prospecção'),
    h('ul', { class: 'list compact' }, accs.map((a) => h('li', null,
      h('div', { class: 'li-main' }, h('b', null, a.name), h('small', null, [a.segment, a.city].filter(Boolean).join(' · '))),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://news.google.com/search?q=${q(a, '')}&hl=pt-BR&gl=BR&ceid=BR:pt-419` }, 'Notícias'),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://www.google.com/search?q=${q(a, 'edital OR licitação OR Finep OR projeto simulação')}` }, 'Editais / projetos'),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://www.linkedin.com/search/results/people/?keywords=${q(a, 'simulação OR CAE OR engenharia')}` }, 'LinkedIn'),
      h('a', { class: 'btn tiny ghost', target: '_blank', href: `https://www.google.com/search?q=${q(a, 'vagas engenheiro simulação Ansys OR Abaqus OR "Star-CCM"')}` }, 'Vagas (sinal de demanda)'),
      btn('＋ registrar', () => openForm('prospects', { accountId: a.id, direction: 'Fora → dentro', source: 'Notícia' }), 'tiny'),
    ))),
  );
}
