// Componentes de interface: elementos, modal, formulários, tabelas, abas.
import { store, upsert, remove, all } from './store.js';
import { FIELDS, ENTITIES, DEFAULTS, PRODUCTS } from './schema.js';
import { fmt, norm, today } from './util.js';

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'multiple', 'indeterminate']);
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- Toast ----------
export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) document.body.append((box = h('div', { id: 'toasts' })));
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

// ---------- Modal ----------
export function modal(title, body, { actions = [], wide = false, onClose } = {}) {
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const back = h('div', { class: 'modal-back', onmousedown: (e) => e.target === back && close() },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', title: 'Fechar', onclick: close }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', { class: 'btn ' + (a.kind || ''), onclick: () => a.onClick(close) }, a.label))) : null,
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  const first = back.querySelector('input:not([type=checkbox]),textarea,select');
  first && setTimeout(() => first.focus(), 30);
  return close;
}
export function confirmBox(msg, okLabel = 'Confirmar') {
  return new Promise((res) => {
    modal('Confirmar', h('p', null, msg), {
      actions: [
        { label: 'Cancelar', onClick: (c) => (c(), res(false)) },
        { label: okLabel, kind: 'danger', onClick: (c) => (c(), res(true)) },
      ],
    });
  });
}

// ---------- Badges ----------
export const badge = (text, cls = '') => h('span', { class: 'badge ' + cls }, text);
export function healthBadge(st) {
  if (st.level === 'na') return badge('—', 'muted');
  return h('span', { class: 'health ' + st.level, title: st.reasons.map((r) => '• ' + r.t).join('\n') || 'Tudo em dia' }, h('b', null, st.score), ' ', { ok: 'Saudável', warn: 'Atenção', risk: 'Risco' }[st.level]);
}
const STAGE_CLS = (s) => (s === 'Ganha' ? 'ok' : s === 'Perdida' ? 'risk' : s === 'Em espera' ? 'muted' : 'info');
export const stageBadge = (s) => badge(s || '—', STAGE_CLS(s));
export function engagementDots(n) {
  n = Number(n) || 0;
  return h('span', { class: 'dots', title: `Engajamento ${n}/5` }, [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= n ? 'on' : '' })));
}
export function dueBadge(date) {
  if (!date) return null;
  const d = date < today() ? 'risk' : date === today() ? 'warn' : 'muted';
  return badge(fmt.rel(date), d);
}

// ---------- Abas ----------
export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs' }, items.map(([k, label, count]) => h('button', { class: 'tab' + (k === active ? ' on' : ''), onclick: () => onChange(k) }, label, count != null ? h('span', { class: 'count' }, count) : null)));
}

// ---------- Tabela ----------
export function table(rows, cols, { onRow, empty = 'Nada por aqui ainda.', search = false, sort, pageSize = 0 } = {}) {
  let q = '';
  let sortKey = sort?.key ?? null;
  let sortDir = sort?.dir ?? 1;
  const wrap = h('div', { class: 'table-wrap' });
  const body = h('div');
  const draw = () => {
    let list = rows;
    if (q) {
      const nq = norm(q);
      list = list.filter((r) => norm(cols.map((c) => (c.text ? c.text(r) : c.sort ? c.sort(r) : r[c.key])).join(' ')).includes(nq));
    }
    if (sortKey != null) {
      const col = cols.find((c) => (c.key || c.label) === sortKey);
      const val = col.sort || ((r) => r[col.key]);
      list = [...list].sort((a, b) => {
        const x = val(a) ?? '';
        const y = val(b) ?? '';
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })) * sortDir;
      });
    }
    body.innerHTML = '';
    if (!list.length) return body.append(h('div', { class: 'empty' }, empty));
    const t = h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, cols.map((c) => {
        const k = c.key || c.label;
        return h('th', { class: (c.cls || '') + (c.nosort ? '' : ' sortable'), onclick: c.nosort ? null : () => { sortDir = sortKey === k ? -sortDir : 1; sortKey = k; draw(); } }, c.label, sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
      }))),
      h('tbody', null, list.map((r) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? (e) => !e.target.closest('button,a,input,select') && onRow(r) : null },
        cols.map((c) => { const v = c.render ? c.render(r) : r[c.key]; return h('td', { class: c.cls || '' }, v ?? '—'); })))),
    );
    body.append(t);
  };
  if (search) wrap.append(h('input', { class: 'search', placeholder: 'Filtrar…', oninput: (e) => { q = e.target.value; draw(); } }));
  wrap.append(body);
  draw();
  return wrap;
}

// ---------- Formulários ----------
function divisionsToText(divs = []) {
  return divs.map((d) => [d.name, ...(d.subs || []).map((s) => '  - ' + s)].join('\n')).join('\n');
}
function textToDivisions(txt) {
  const out = [];
  txt.split('\n').forEach((line) => {
    if (!line.trim()) return;
    if (/^\s+|^-/.test(line) && out.length) out[out.length - 1].subs.push(line.replace(/^\s*-?\s*/, '').trim());
    else out.push({ name: line.trim(), subs: [] });
  });
  return out;
}
export function accountOptions() {
  return [...all('accounts')].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function buildForm(entity, rec) {
  const fields = FIELDS[entity];
  const inputs = {};
  const form = h('form', { class: 'form-grid', onsubmit: (e) => e.preventDefault() });
  const lists = h('div', { style: { display: 'none' } });
  const contactSelects = [];
  const oppSelects = [];
  const divLists = [];

  const getAcc = () => (inputs.accountId ? inputs.accountId.value : rec.accountId);
  const fillContacts = (sel, multi, value) => {
    const accId = getAcc();
    const list = all('contacts').filter((c) => !accId || c.accountId === accId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    sel.innerHTML = '';
    if (!multi) sel.append(h('option', { value: '' }, '—'));
    list.forEach((c) => sel.append(h('option', { value: c.id, selected: multi ? (value || []).includes(c.id) : value === c.id }, c.name + (c.title ? ` · ${c.title}` : ''))));
  };
  const fillOpps = (sel, value) => {
    const accId = getAcc();
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, '—'));
    all('opportunities').filter((o) => !accId || o.accountId === accId).forEach((o) => sel.append(h('option', { value: o.id, selected: value === o.id }, o.name)));
  };
  const fillDivs = (dl) => {
    const acc = all('accounts').find((a) => a.id === getAcc());
    dl.innerHTML = '';
    (acc?.divisions || []).forEach((d) => {
      dl.append(h('option', { value: d.name }));
      (d.subs || []).forEach((s) => dl.append(h('option', { value: `${d.name} › ${s}` })));
    });
  };

  for (const f of fields) {
    if (f.type === 'section') {
      form.append(h('div', { class: 'form-section' }, f.label));
      continue;
    }
    const v = rec[f.key];
    let input;
    const id = 'f_' + f.key;
    switch (f.type) {
      case 'textarea':
        input = h('textarea', { id, rows: 3 }, v ?? '');
        break;
      case 'divisions':
        input = h('textarea', { id, rows: 5, placeholder: 'Divisão A\n  - Subdivisão A1\nDivisão B' }, divisionsToText(v));
        break;
      case 'select':
        input = h('select', { id }, h('option', { value: '' }, '—'), f.options.map((o) => h('option', { value: o, selected: v === o }, o)));
        break;
      case 'check':
        input = h('input', { id, type: 'checkbox', checked: !!v });
        break;
      case 'rating':
        input = h('select', { id }, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: Number(v) === n }, `${n} — ${['frio', 'pouco', 'neutro', 'engajado', 'muito engajado'][n - 1]}`)));
        break;
      case 'account':
        input = h('select', { id }, h('option', { value: '' }, '—'), accountOptions().map((a) => h('option', { value: a.id, selected: v === a.id }, a.name)));
        input.addEventListener('change', () => {
          contactSelects.forEach(([s, m]) => fillContacts(s, m, m ? [...s.selectedOptions].map((o) => o.value) : s.value));
          oppSelects.forEach((s) => fillOpps(s, s.value));
          divLists.forEach(fillDivs);
        });
        break;
      case 'contact':
        input = h('select', { id });
        contactSelects.push([input, false]);
        break;
      case 'contacts':
        input = h('select', { id, multiple: true, size: 4 });
        contactSelects.push([input, true]);
        break;
      case 'opportunity':
        input = h('select', { id });
        oppSelects.push(input);
        break;
      case 'team': {
        input = h('input', { id, type: 'text', value: v ?? '', list: 'dl_team' });
        if (!lists.querySelector('#dl_team')) lists.append(h('datalist', { id: 'dl_team' }, (store.db.settings.team || []).map((t) => h('option', { value: t.name }, t.role))));
        break;
      }
      case 'money':
      case 'number':
        input = h('input', { id, type: 'number', step: f.step || (f.type === 'money' ? '0.01' : '1'), value: v ?? '' });
        break;
      default:
        input = h('input', { id, type: { date: 'date', url: 'url', email: 'email' }[f.type] || 'text', value: v ?? '' });
    }
    if (f.datalist === 'products') {
      input.setAttribute('list', 'dl_products');
      if (!lists.querySelector('#dl_products')) lists.append(h('datalist', { id: 'dl_products' }, PRODUCTS.map((p) => h('option', { value: p }))));
    }
    if (f.datalist === 'divisions') {
      const dl = h('datalist', { id: 'dl_div_' + f.key });
      lists.append(dl);
      divLists.push(dl);
      input.setAttribute('list', dl.id);
    }
    if (f.required) input.required = true;
    inputs[f.key] = input;
    const wrap = f.type === 'check'
      ? h('label', { class: 'field check' + (f.wide ? ' wide' : '') }, input, h('span', null, f.label))
      : h('label', { class: 'field' + (f.wide || ['textarea', 'divisions', 'contacts'].includes(f.type) ? ' wide' : '') }, h('span', null, f.label, f.required ? ' *' : ''), input, f.hint ? h('small', null, f.hint) : null);
    form.append(wrap);
  }
  form.append(lists);
  contactSelects.forEach(([s, m]) => {
    const f = fields.find((x) => inputs[x.key] === s);
    fillContacts(s, m, rec[f.key]);
  });
  oppSelects.forEach((s) => {
    const f = fields.find((x) => inputs[x.key] === s);
    fillOpps(s, rec[f.key]);
  });
  divLists.forEach(fillDivs);

  const read = () => {
    const out = { ...rec };
    for (const f of fields) {
      if (f.type === 'section') continue;
      const el = inputs[f.key];
      let v;
      if (f.type === 'check') v = el.checked;
      else if (f.type === 'contacts') v = [...el.selectedOptions].map((o) => o.value);
      else if (f.type === 'divisions') v = textToDivisions(el.value);
      else if (['number', 'money', 'rating'].includes(f.type)) v = el.value === '' ? null : Number(el.value);
      else v = el.value.trim();
      out[f.key] = v;
    }
    return out;
  };
  const validate = () => {
    for (const f of fields) {
      if (f.required && inputs[f.key] && !String(inputs[f.key].value || '').trim()) {
        inputs[f.key].focus();
        toast(`Preencha: ${f.label}`, 'err');
        return false;
      }
    }
    return true;
  };
  return { el: form, read, validate, inputs };
}

export function openForm(entity, rec = {}, { title, onSaved, extra } = {}) {
  const isNew = !rec.id;
  const base = isNew ? { ...DEFAULTS[entity], ...rec } : rec;
  const f = buildForm(entity, base);
  const body = h('div', null, f.el, extra ? extra(f) : null);
  const actions = [];
  if (!isNew)
    actions.push({
      label: 'Excluir', kind: 'danger ghost left',
      onClick: async (close) => {
        if (await confirmBox(entity === 'accounts' ? 'Excluir esta conta e TODOS os registros ligados a ela?' : 'Excluir este registro?', 'Excluir')) {
          remove(entity, rec.id);
          close();
          toast('Excluído');
        }
      },
    });
  actions.push({ label: 'Cancelar', kind: 'ghost', onClick: (c) => c() });
  actions.push({
    label: 'Salvar', kind: 'primary',
    onClick: (close) => {
      if (!f.validate()) return;
      const saved = upsert(entity, f.read());
      close();
      toast('Salvo');
      onSaved && onSaved(saved);
    },
  });
  modal(title || `${isNew ? 'Novo' : 'Editar'}: ${ENTITIES[entity].label}`, body, { actions, wide: FIELDS[entity].length > 9 });
  return f;
}

export function section(title, actions, ...content) {
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, title), h('div', { class: 'card-actions' }, actions)), content);
}
export function kpi(label, value, sub, cls = '', onClick) {
  return h('div', { class: 'kpi ' + cls + (onClick ? ' click' : ''), onclick: onClick }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}
export const btn = (label, onClick, kind = '') => h('button', { class: 'btn ' + kind, onclick: onClick }, label);
export const link = (label, href) => h('a', { href, class: 'link' }, label);
export function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copiado para a área de transferência'), () => toast('Não foi possível copiar', 'err'));
}

// Gráficos (Chart.js carregado globalmente)
const charts = new WeakMap();
export function chart(config, height = 220) {
  const canvas = h('canvas');
  const box = h('div', { class: 'chart', style: { height: height + 'px' } }, canvas);
  requestAnimationFrame(() => {
    if (!window.Chart || !canvas.isConnected) return;
    const css = getComputedStyle(document.documentElement);
    window.Chart.defaults.color = css.getPropertyValue('--muted').trim() || '#666';
    window.Chart.defaults.font.family = css.getPropertyValue('--font').trim() || 'system-ui';
    window.Chart.defaults.borderColor = css.getPropertyValue('--line').trim() || '#e5e5e5';
    charts.set(canvas, new window.Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, ...(config.options || {}) } }));
  });
  return box;
}
