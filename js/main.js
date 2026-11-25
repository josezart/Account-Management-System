// Inicialização, login, layout e rotas.
import * as S from './store.js';
import { h, modal, toast, buildForm, copyText, accountOptions } from './ui.js';
import { today, addDays, weekStart, fmt, norm } from './util.js';
import { accName, contactName } from './engine.js';
import dashboard from './views/dashboard.js';
import { accountsView, accountDetail } from './views/accounts.js';
import weekView from './views/week.js';
import prepipelineView from './views/prepipeline.js';
import renewalsView from './views/renewals.js';
import technicalView from './views/technical.js';
import contactsView from './views/contacts.js';
import planningView from './views/planning.js';
import mapView from './views/map.js';
import settingsView from './views/settings.js';

const app = document.getElementById('app');

const NAV = [
  ['dashboard', 'Painel', '◧'],
  ['week', 'Minha semana', '☑'],
  ['accounts', 'Contas', '▦'],
  ['prepipeline', 'Pré-pipeline', '◆'],
  ['renewals', 'Renovações & licenças', '⧉'],
  ['technical', 'Técnico', '⚙'],
  ['contacts', 'Contatos', '☺'],
  ['planning', 'Planejamento', '◷'],
  ['map', 'Mapa', '⌖'],
  ['settings', 'Configurações', '≡'],
];
const VIEWS = { dashboard, week: weekView, accounts: accountsView, account: accountDetail, prepipeline: prepipelineView, renewals: renewalsView, technical: technicalView, contacts: contactsView, planning: planningView, map: mapView, settings: settingsView };

export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = raw.split('?');
  const parts = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  return { view: parts[0], id: parts[1], params };
}
export function go(hash) {
  location.hash = hash;
}
export function setParam(k, v) {
  const r = parseRoute();
  const p = new URLSearchParams(r.params);
  if (v == null || v === '') p.delete(k);
  else p.set(k, v);
  const base = r.id ? `#/${r.view}/${r.id}` : `#/${r.view}`;
  history.replaceState(null, '', base + (p.toString() ? '?' + p : ''));
  render();
}

// ---------- Login / configuração inicial ----------
async function showLogin() {
  const exists = await S.hasAnyVault();
  app.innerHTML = '';
  const msg = h('div', { class: 'login-msg' });
  const pwd = h('input', { type: 'password', placeholder: 'Senha', autocomplete: 'current-password' });
  const pwd2 = h('input', { type: 'password', placeholder: 'Repita a senha', autocomplete: 'new-password' });
  const file = h('input', { type: 'file', accept: '.json' });
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, exists ? 'Entrar' : 'Criar acesso');
  const onSubmit = async (e) => {
    e.preventDefault();
    msg.textContent = '';
    submit.disabled = true;
    submit.textContent = exists ? 'Abrindo…' : 'Criando…';
    try {
      if (exists) {
        await S.unlock(pwd.value);
      } else {
        if (pwd.value.length < 10) throw new Error('Use ao menos 10 caracteres');
        if (pwd.value !== pwd2.value) throw new Error('As senhas não conferem');
        let initial = null;
        if (file.files[0]) initial = JSON.parse(await file.files[0].text());
        await S.setup(pwd.value, initial);
        toast('Acesso criado. Configure a sincronização com o GitHub em Configurações.');
      }
      startApp();
    } catch (err) {
      msg.textContent = err.message;
      submit.disabled = false;
      submit.textContent = exists ? 'Entrar' : 'Criar acesso';
    }
  };
  app.append(
    h('div', { class: 'login' },
      h('form', { class: 'login-card', onsubmit: onSubmit },
        h('div', { class: 'brand big' }, h('span', { class: 'logo' }, 'CAE'), h('div', null, h('b', null, 'Gestão de Contas'), h('small', null, 'Simulação · Ansys / Synopsys'))),
        exists ? h('p', { class: 'muted' }, 'Entre com sua senha. Ela também descriptografa seus dados.') : h('p', { class: 'muted' }, 'Primeiro acesso: crie uma senha forte. Ela criptografa todos os dados — não há como recuperá-la se for esquecida.'),
        pwd,
        exists ? null : pwd2,
        exists ? null : h('label', { class: 'field' }, h('span', null, 'Dados iniciais (opcional, .json)'), file),
        submit,
        msg,
      ),
    ),
  );
  pwd.focus();
}

// ---------- Layout ----------
let mainEl, syncEl;
function shell() {
  app.innerHTML = '';
  mainEl = h('main', { class: 'main' });
  syncEl = h('button', { class: 'sync', onclick: () => doSync() });
  const searchBox = globalSearch();
  const navEl = h('nav', { class: 'nav' }, NAV.map(([k, label, ic]) => h('a', { href: '#/' + k, 'data-k': k }, h('i', null, ic), h('span', null, label))));
  app.append(
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'CAE'), h('div', null, h('b', null, 'Gestão de Contas'), h('small', null, S.store.db.settings.userName || ''))),
      navEl,
      h('div', { class: 'side-foot' }, syncEl, h('button', { class: 'btn ghost small', onclick: () => { S.lock(); showLogin(); } }, '🔒 Bloquear')),
    ),
    h('div', { class: 'content' },
      h('header', { class: 'top' },
        h('button', { class: 'icon-btn menu', onclick: () => document.body.classList.toggle('nav-open') }, '☰'),
        searchBox,
        h('div', { class: 'top-actions' },
          h('button', { class: 'btn primary', onclick: () => quickLog() }, '＋ Registro rápido'),
          h('button', { class: 'btn', onclick: () => quickTask() }, '＋ Tarefa'),
        ),
      ),
      mainEl,
    ),
  );
  updateSync();
}

function updateSync() {
  if (!syncEl) return;
  const st = S.store;
  const g = st.db?.settings?.github;
  let label, cls;
  if (st.syncing) [label, cls] = ['Sincronizando…', 'busy'];
  else if (!g || !g.token) [label, cls] = ['GitHub não configurado', 'off'];
  else if (st.syncError) [label, cls] = ['Erro de sincronização', 'err'];
  else if (S.syncPending()) [label, cls] = ['Alterações não enviadas', 'pend'];
  else [label, cls] = ['Sincronizado ' + (st.syncState.lastPush ? fmt.dt(st.syncState.lastPush) : ''), 'ok'];
  syncEl.className = 'sync ' + cls;
  syncEl.title = st.syncError || 'Clique para sincronizar agora';
  syncEl.textContent = '● ' + label;
}
async function doSync() {
  const g = S.store.db.settings.github;
  if (!g.token) return go('#/settings?tab=sync');
  try {
    await S.pushNow();
    toast('Dados enviados ao GitHub');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function globalSearch() {
  const input = h('input', { class: 'gsearch', placeholder: 'Buscar conta, contato, oportunidade…  ( / )' });
  const results = h('div', { class: 'gresults' });
  const run = () => {
    const q = norm(input.value);
    results.innerHTML = '';
    if (q.length < 2) return results.classList.remove('on');
    const db = S.store.db;
    const hits = [
      ...db.accounts.filter((a) => norm(`${a.name} ${a.sfName} ${a.ansysNumber} ${a.city}`).includes(q)).map((a) => ['Conta', a.name, `#/account/${a.id}`]),
      ...db.contacts.filter((c) => norm(`${c.name} ${c.title} ${c.email}`).includes(q)).map((c) => ['Contato', `${c.name} · ${accName(c.accountId)}`, `#/account/${c.accountId}?tab=contacts`]),
      ...db.units.filter((u) => norm(`${u.name} ${u.products} ${u.challenges}`).includes(q)).map((u) => ['Unidade', `${u.name} · ${accName(u.accountId)}`, `#/account/${u.accountId}?tab=map`]),
      ...db.prospects.filter((o) => norm(`${o.title} ${o.products} ${o.sfOpp}`).includes(q)).map((o) => ['Pré-pipeline', `${o.title} · ${accName(o.accountId)}`, `#/account/${o.accountId}?tab=pre`]),
      ...db.licenses.filter((l) => norm(l.product).includes(q)).map((l) => ['Licença', `${l.product} · ${accName(l.accountId)}`, `#/account/${l.accountId}?tab=licenses`]),
    ].slice(0, 12);
    if (!hits.length) results.append(h('div', { class: 'gr-empty' }, 'Nada encontrado'));
    hits.forEach(([k, t, href]) => results.append(h('a', { href, onclick: () => { input.value = ''; results.classList.remove('on'); } }, h('small', null, k), t)));
    results.classList.add('on');
  };
  input.addEventListener('input', run);
  input.addEventListener('blur', () => setTimeout(() => results.classList.remove('on'), 200));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') results.querySelector('a')?.click();
    if (e.key === 'Escape') input.blur();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
  return h('div', { class: 'gsearch-wrap' }, input, results);
}

// ---------- Registro rápido (interação + follow-up + atividade técnica) ----------
export function quickLog(preset = {}) {
  const f = buildForm('interactions', { date: today(), type: 'Reunião online', ...preset });
  const mkTask = h('input', { type: 'checkbox', checked: true });
  const mkTech = h('input', { type: 'checkbox' });
  const techType = h('select', null, ['Apresentação técnica', 'Sessão técnica / hands-on', 'Prova de conceito (PoC)', 'Visita técnica', 'Treinamento', 'Workshop', 'Levantamento técnico', 'Mentoria'].map((t) => h('option', null, t)));
  const extra = h('div', { class: 'quick-extra' },
    h('label', { class: 'field check' }, mkTask, h('span', null, 'Criar tarefa de follow-up na semana da data de follow-up')),
    h('label', { class: 'field check' }, mkTech, h('span', null, 'Também registrar como atividade técnica:'), techType),
  );
  modal('Registro rápido de interação', h('div', null, f.el, extra), {
    wide: true,
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: (c) => c() },
      {
        label: 'Salvar', kind: 'primary',
        onClick: (close) => {
          if (!f.validate()) return;
          const rec = S.upsert('interactions', f.read());
          if (mkTask.checked && rec.followUpDate) {
            S.upsert('tasks', { title: `Follow-up: ${rec.subject}`, accountId: rec.accountId, prospectId: rec.prospectId, category: 'Relacionamento', priority: 'Alta', status: 'A fazer', week: weekStart(rec.followUpDate), due: rec.followUpDate, estMin: 30, linkInteraction: rec.id });
          }
          if (mkTech.checked) {
            S.upsert('techActivities', { accountId: rec.accountId, date: rec.date, type: techType.value, title: rec.subject, status: rec.date > today() ? 'Planejada' : 'Realizada', result: '—', specialist: rec.esssTeam, prospectId: rec.prospectId, unitId: rec.unitId, notes: rec.summary });
          }
          close();
          showReport(rec);
        },
      },
    ],
  });
}

export function reportText(rec) {
  const contacts = (rec.contactIds || []).map(contactName).filter(Boolean).join(', ');
  return [
    `${rec.type} — ${accName(rec.accountId)} — ${fmt.date(rec.date)}`,
    `Assunto: ${rec.subject}`,
    contacts ? `Participantes (cliente): ${contacts}` : null,
    rec.esssTeam ? `Participantes (ESSS): ${rec.esssTeam}` : null,
    '',
    rec.summary ? `Resumo:\n${rec.summary}` : null,
    '',
    rec.nextSteps ? `Próximos passos:\n${rec.nextSteps}` : null,
    rec.followUpDate ? `Follow-up: ${fmt.date(rec.followUpDate)}` : null,
  ].filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}
function showReport(rec) {
  const text = reportText(rec);
  const sf = h('input', { type: 'checkbox', checked: !!rec.sfLogged, onchange: (e) => S.patch('interactions', rec.id, { sfLogged: e.target.checked }) });
  modal('Interação registrada ✓', h('div', null,
    h('p', { class: 'muted' }, 'Texto pronto para colar no Salesforce ou no e-mail de follow-up:'),
    h('pre', { class: 'report' }, text),
    h('label', { class: 'field check' }, sf, h('span', null, 'Já registrei no Salesforce')),
  ), {
    actions: [
      { label: 'Fechar', kind: 'ghost', onClick: (c) => c() },
      { label: 'Copiar texto', kind: 'primary', onClick: () => copyText(text) },
    ],
  });
}

export function quickTask(preset = {}) {
  import('./ui.js').then(({ openForm }) => openForm('tasks', { week: weekStart(today()), ...preset }, { title: 'Nova tarefa' }));
}

// ---------- Render ----------
let scheduled = false;
export function render() {
  if (!S.store.db || !mainEl) return;
  const r = parseRoute();
  if (r.view === 'commercial' || r.view === 'prospecting') r.view = 'prepipeline';
  if (r.view === 'licenses') r.view = 'renewals';
  const view = VIEWS[r.view] || dashboard;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === (r.view === 'account' ? 'accounts' : r.view)));
  const y = window.scrollY;
  mainEl.innerHTML = '';
  try {
    mainEl.append(view(r));
  } catch (e) {
    console.error(e);
    mainEl.append(h('div', { class: 'card' }, h('h3', null, 'Erro ao montar a tela'), h('pre', null, e.stack)));
  }
  if (r.sameView) window.scrollTo(0, y);
  document.body.classList.remove('nav-open');
}
function scheduleRender(statusOnly) {
  updateSync();
  if (statusOnly || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });
}

let started = false;
function startApp() {
  shell();
  if (!started) {
    started = true;
    S.subscribe(scheduleRender);
    window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
    setupAutoLock();
  }
  render();
}

function setupAutoLock() {
  let last = Date.now();
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => (last = Date.now()), { passive: true }));
  setInterval(() => {
    const mins = S.store.db?.settings?.lockMinutes || 30;
    if (S.store.db && Date.now() - last > mins * 60000) {
      S.lock();
      showLogin();
      toast('Sessão bloqueada por inatividade', 'warn');
    }
  }, 30000);
}

(async function boot() {
  if (await S.resume()) startApp();
  else showLogin();
})();

window.addEventListener('beforeunload', (e) => {
  if (S.store.db && S.syncPending() && S.store.db.settings.github.token && S.store.syncing) {
    e.preventDefault();
    e.returnValue = '';
  }
});
export { accountOptions, addDays };
