import { store } from '../store.js';
import { h, section, table, openForm, btn, badge, engagementDots } from '../ui.js';
import { accPath, unitName } from '../engine.js';
import { ENUMS } from '../schema.js';
import { fmt } from '../util.js';
import { setParam } from '../main.js';
import { roleCls, lastContactOf } from './accounts.js';

export default function contactsView({ params }) {
  const db = store.db;
  let rows = db.contacts;
  if (params.role) rows = rows.filter((c) => c.role === params.role);
  if (params.level) rows = rows.filter((c) => c.level === params.level);
  if (!params.inactive) rows = rows.filter((c) => !c.inactive);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Contatos'), h('div', { class: 'actions' }, btn('＋ Contato', () => openForm('contacts', {}), 'primary'))),
    h('div', { class: 'filters' },
      h('select', { onchange: (e) => setParam('role', e.target.value) }, h('option', { value: '' }, 'Todos os papéis'), ENUMS.contactRole.map((r) => h('option', { selected: r === params.role }, r))),
      h('select', { onchange: (e) => setParam('level', e.target.value) }, h('option', { value: '' }, 'Todos os níveis'), ENUMS.contactLevel.map((r) => h('option', { selected: r === params.level }, r))),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: !!params.inactive, onchange: (e) => setParam('inactive', e.target.checked ? '1' : '') }), ' incluir inativos'),
    ),
    section(`${rows.length} contatos`, null, table(rows, [
      { label: 'Nome', key: 'name', render: (c) => h('div', null, h('b', null, c.name), h('small', { class: 'block muted' }, c.title || '')) },
      { label: 'Conta', sort: (c) => accPath(c.accountId), render: (c) => h('a', { href: `#/account/${c.accountId}?tab=contacts`, class: 'link' }, accPath(c.accountId)) },
      { label: 'Unidade', sort: (c) => unitName(c.unitId), render: (c) => unitName(c.unitId) || '—' },
      { label: 'Papel', key: 'role', render: (c) => badge(c.role || '—', roleCls(c.role)) },
      { label: 'Nível', key: 'level' },
      { label: 'Engajamento', key: 'engagement', render: (c) => engagementDots(c.engagement) },
      { label: 'Último contato', sort: (c) => lastContactOf(c.id) || '', render: (c) => fmt.date(lastContactOf(c.id)) },
      { label: 'E-mail', key: 'email', render: (c) => (c.email ? h('a', { href: 'mailto:' + c.email }, c.email) : '—') },
    ], { onRow: (c) => openForm('contacts', c), search: true, sort: { key: 'name', dir: 1 } })),
  );
}
