import * as S from '../store.js';
import { h, section, btn, tabs, toast, confirmBox, modal } from '../ui.js';
import { FIELDS, ENTITIES } from '../schema.js';
import { download, today, norm, fmt } from '../util.js';
import { setParam } from '../main.js';
import { testConnection, configured } from '../github.js';

export default function settingsView({ params }) {
  const tab = params.tab || 'general';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Configurações')),
    tabs([['general', 'Geral'], ['team', 'Time ESSS'], ['sync', 'Sincronização GitHub'], ['security', 'Segurança'], ['data', 'Dados / importação']], tab, (k) => setParam('tab', k)),
    { general, team, sync, security, data }[tab](),
  );
}

const F = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', null, hint) : null);

function general() {
  const st = S.store.db.settings;
  const name = h('input', { value: st.userName || '' });
  const fy = h('select', null, ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'].map((m, i) => h('option', { value: i + 1, selected: st.fyEndMonth === i + 1 }, m)));
  const cap = h('input', { type: 'number', value: st.weeklyCapacityHours });
  const pro = h('input', { type: 'number', value: st.prospectingHoursWeek });
  const cad = {};
  const cadRows = Object.entries(st.cadence).map(([tier, c]) => {
    cad[tier] = { contact: h('input', { type: 'number', value: c.contact }), tech: h('input', { type: 'number', value: c.tech }) };
    return h('tr', null, h('td', null, h('b', null, tier)), h('td', null, cad[tier].contact), h('td', null, cad[tier].tech));
  });
  const saveIt = () => {
    const cadence = {};
    Object.entries(cad).forEach(([t, c]) => (cadence[t] = { contact: Number(c.contact.value) || 30, tech: Number(c.tech.value) || 90 }));
    S.setSettings({ userName: name.value.trim(), fyEndMonth: Number(fy.value), weeklyCapacityHours: Number(cap.value) || 30, prospectingHoursWeek: Number(pro.value) || 0, cadence });
    toast('Configurações salvas');
  };
  return h('div', null,
    section('Preferências', null, h('div', { class: 'form-grid' },
      F('Seu nome', name), F('Mês de encerramento do ano fiscal', fy, 'ESSS/Ansys: outubro'),
      F('Capacidade semanal planejável (h)', cap, 'Horas disponíveis para tarefas, descontando reuniões fixas'),
      F('Meta de prospecção (h/semana)', pro))),
    section('Cadência por classificação de conta', h('small', { class: 'muted' }, 'usada no diagnóstico de saúde e nas sugestões'),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Classificação'), h('th', null, 'Contato a cada (dias)'), h('th', null, 'Atividade técnica a cada (dias)'))), h('tbody', null, cadRows))),
    h('div', { class: 'toolbar' }, btn('Salvar', saveIt, 'primary')),
  );
}

function team() {
  const st = S.store.db.settings;
  const ta = h('textarea', { rows: 10, placeholder: 'Nome; função; e-mail (um por linha)' }, (st.team || []).map((t) => [t.name, t.role, t.email].filter((x) => x != null).join('; ')).join('\n'));
  return h('div', null,
    section('Time ESSS (especialistas, TAMs, gestores)', h('small', { class: 'muted' }, 'aparece como sugestão nos campos “Especialista” e “TAM”'),
      ta, h('div', { class: 'toolbar' }, btn('Salvar', () => {
        const teamList = ta.value.split('\n').map((l) => l.split(';').map((x) => x.trim())).filter((p) => p[0]).map(([name, role, email]) => ({ name, role: role || '', email: email || '' }));
        S.setSettings({ team: teamList });
        toast('Time salvo');
      }, 'primary'))),
  );
}

function sync() {
  const g = S.store.db.settings.github;
  const owner = h('input', { value: g.owner, placeholder: 'seu-usuario' });
  const repo = h('input', { value: g.repo, placeholder: 'gestao-contas' });
  const branch = h('input', { value: g.branch || 'main' });
  const path = h('input', { value: g.path || 'data/vault.json' });
  const token = h('input', { type: 'password', value: g.token, placeholder: 'github_pat_…' });
  const auto = h('input', { type: 'checkbox', checked: g.autoSync !== false });
  const read = () => ({ owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() || 'main', path: path.value.trim() || 'data/vault.json', token: token.value.trim(), autoSync: auto.checked });
  const st = S.store.syncState;
  return h('div', null,
    section('Repositório', null,
      h('p', { class: 'muted small' }, 'Os dados são enviados ao seu repositório já criptografados (arquivo data/vault.json). O token fica guardado dentro do cofre criptografado.'),
      h('div', { class: 'form-grid' }, F('Usuário / organização', owner), F('Repositório', repo), F('Branch', branch), F('Caminho do arquivo', path),
        F('Token (fine-grained, Contents: Read and write, só neste repositório)', token, 'GitHub → Settings → Developer settings → Fine-grained tokens'),
        h('label', { class: 'field check' }, auto, h('span', null, 'Enviar automaticamente a cada alteração'))),
      h('div', { class: 'toolbar' },
        btn('Salvar e testar', async () => {
          const cfg = read();
          try {
            await testConnection(cfg);
            S.setSettings({ github: cfg });
            toast('Conexão OK — token com permissão de escrita');
          } catch (e) {
            toast(e.message, 'err');
          }
        }, 'primary'),
        btn('Enviar agora', async () => { try { await S.pushNow(); toast('Enviado'); } catch (e) { toast(e.message, 'err'); } }),
        btn('Baixar versão do GitHub', async () => {
          if (!(await confirmBox('Substituir os dados deste navegador pela versão que está no GitHub?', 'Baixar'))) return;
          const ok = await S.pullIfNewer(true);
          toast(ok ? 'Dados atualizados a partir do GitHub' : S.store.syncError || 'Nada para baixar', ok ? 'ok' : 'warn');
        }, 'ghost')),
    ),
    section('Status', null, h('dl', { class: 'dl' },
      h('dt', null, 'Configurado'), h('dd', null, configured(g) ? 'sim' : 'não'),
      h('dt', null, 'Último envio'), h('dd', null, st.lastPush ? fmt.dt(st.lastPush) : '—'),
      h('dt', null, 'Último download'), h('dd', null, st.lastPull ? fmt.dt(st.lastPull) : '—'),
      h('dt', null, 'Alterações pendentes desde'), h('dd', null, st.pendingSince ? fmt.dt(st.pendingSince) : '—'),
      h('dt', null, 'Último erro'), h('dd', null, S.store.syncError || '—'))),
  );
}

function security() {
  const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const lockM = h('input', { type: 'number', value: S.store.db.settings.lockMinutes || 30 });
  return h('div', null,
    section('Alterar senha', null,
      h('p', { class: 'muted small' }, 'A senha deriva a chave que criptografa os dados (AES-256-GCM, PBKDF2 com 310 mil iterações). Ao trocar, os dados são recriptografados; envie ao GitHub em seguida para que outros dispositivos usem a nova senha.'),
      h('div', { class: 'form-grid' }, F('Nova senha (mín. 10 caracteres)', p1), F('Repita', p2)),
      h('div', { class: 'toolbar' }, btn('Alterar senha', async () => {
        if (p1.value.length < 10) return toast('Use ao menos 10 caracteres', 'err');
        if (p1.value !== p2.value) return toast('As senhas não conferem', 'err');
        await S.changePassword(p1.value);
        p1.value = p2.value = '';
        toast('Senha alterada');
      }, 'primary'))),
    section('Bloqueio automático', null, h('div', { class: 'form-grid' }, F('Bloquear após (minutos sem uso)', lockM)),
      h('div', { class: 'toolbar' }, btn('Salvar', () => { S.setSettings({ lockMinutes: Number(lockM.value) || 30 }); toast('Salvo'); }, 'primary'))),
    section('Este navegador', null, h('p', { class: 'muted small' }, 'Apaga a cópia local criptografada. Os dados no GitHub não são afetados.'),
      btn('Apagar dados deste navegador', async () => {
        if (!(await confirmBox('Apagar a cópia local? Se não houver cópia no GitHub, os dados serão perdidos.', 'Apagar'))) return;
        localStorage.removeItem('caeacc.vault');
        localStorage.removeItem('caeacc.sync');
        S.lock();
        location.reload();
      }, 'danger')),
  );
}

// ---------- Dados ----------
function parseCSV(text) {
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
function toDate(v) {
  v = String(v || '').trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return v.slice(0, 10);
}
function toNum(v) {
  v = String(v ?? '').replace(/[R$\s]/g, '');
  if (!v) return null;
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  return isNaN(Number(v)) ? null : Number(v);
}
function importCsv(entity, text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Planilha vazia');
  const fields = FIELDS[entity].filter((f) => f.type !== 'section');
  const head = rows[0].map((c) => norm(c.trim()));
  const map = head.map((hd) => {
    if (hd === 'id') return { key: 'id', type: 'text' };
    if (['conta', 'account', 'cliente', 'empresa'].includes(hd) && entity !== 'accounts') return { key: 'accountId', type: 'account' };
    return fields.find((f) => norm(f.key) === hd || norm(f.label) === hd || norm(f.label).startsWith(hd));
  });
  const accs = S.store.db.accounts;
  let ok = 0;
  const miss = new Set();
  rows.slice(1).forEach((r) => {
    const rec = {};
    r.forEach((v, i) => {
      const f = map[i];
      if (!f || v === '') return;
      if (f.type === 'account') {
        const a = accs.find((x) => x.id === v || norm(x.name) === norm(v) || (x.ansysNumber && String(x.ansysNumber) === String(v).trim()));
        if (a) rec.accountId = a.id;
        else miss.add(v);
      } else if (f.type === 'date') rec[f.key] = toDate(v);
      else if (['number', 'money', 'rating'].includes(f.type)) rec[f.key] = toNum(v);
      else if (f.type === 'check') rec[f.key] = /^(1|sim|s|x|true|yes)$/i.test(v.trim());
      else if (f.type === 'contacts') rec[f.key] = [];
      else if (f.type === 'divisions') rec[f.key] = v.split('|').map((n) => ({ name: n.trim(), subs: [] }));
      else rec[f.key] = v.trim();
    });
    if (entity !== 'accounts' && !rec.accountId && FIELDS[entity].some((f) => f.key === 'accountId' && f.required)) return;
    const existing = rec.id && S.get(entity, rec.id);
    S.upsert(entity, existing ? { ...existing, ...rec } : rec);
    ok++;
  });
  return { ok, miss: [...miss] };
}

function data() {
  const db = S.store.db;
  const ent = h('select', null, Object.entries(ENTITIES).filter(([k]) => k !== 'plans').map(([k, v]) => h('option', { value: k }, v.plural)));
  const csvFile = h('input', { type: 'file', accept: '.csv,text/csv' });
  const jsonFile = h('input', { type: 'file', accept: '.json' });
  const mode = h('select', null, h('option', { value: 'merge' }, 'Mesclar (atualiza por id, adiciona novos)'), h('option', { value: 'replace' }, 'Substituir tudo'));
  const counts = Object.entries(ENTITIES).map(([k, v]) => h('li', null, `${v.plural}: `, h('b', null, db[k].length)));
  return h('div', null,
    section('Backup e atualização via Claude', null,
      h('p', { class: 'muted small' }, 'Para atualizações em lote (ex.: novo histórico de vendas), exporte o backup, envie-o com a planilha ao Claude e importe o arquivo devolvido no modo “Mesclar”. O token do GitHub nunca é exportado.'),
      h('ul', { class: 'inline-list' }, counts),
      h('div', { class: 'toolbar' },
        btn('Exportar backup (.json)', () => download(`contas-backup-${today()}.json`, S.exportJson()), 'primary'),
      ),
      h('div', { class: 'form-grid' }, F('Arquivo .json para importar', jsonFile), F('Modo', mode)),
      h('div', { class: 'toolbar' }, btn('Importar JSON', async () => {
        if (!jsonFile.files[0]) return toast('Escolha um arquivo', 'err');
        try {
          const obj = JSON.parse(await jsonFile.files[0].text());
          if (mode.value === 'replace' && !(await confirmBox('Substituir TODOS os dados atuais pelo arquivo?', 'Substituir'))) return;
          S.importJson(obj, mode.value);
          toast('Dados importados');
        } catch (e) {
          toast('Arquivo inválido: ' + e.message, 'err');
        }
      })),
    ),
    section('Importar planilha (CSV)', null,
      h('p', { class: 'muted small' }, 'A primeira linha deve ter os nomes das colunas (iguais aos rótulos dos campos ou às chaves do modelo). Para vincular à conta, use uma coluna “Conta” com o nome exato da conta ou o Ansys Number. Datas em dd/mm/aaaa ou aaaa-mm-dd.'),
      h('div', { class: 'form-grid' }, F('Tipo de registro', ent), F('Arquivo .csv', csvFile)),
      h('div', { class: 'toolbar' },
        btn('Importar CSV', async () => {
          if (!csvFile.files[0]) return toast('Escolha um arquivo', 'err');
          try {
            const r = importCsv(ent.value, await csvFile.files[0].text());
            toast(`${r.ok} registros importados`);
            if (r.miss.length) modal('Contas não encontradas', h('div', null, h('p', null, 'Estas linhas foram ignoradas porque a conta não existe no sistema:'), h('ul', null, r.miss.map((m) => h('li', null, m)))));
          } catch (e) {
            toast(e.message, 'err');
          }
        }, 'primary'),
        btn('Baixar modelo CSV', () => {
          const fields = FIELDS[ent.value].filter((f) => f.type !== 'section');
          const cols = fields.map((f) => (f.type === 'account' ? 'Conta' : f.label));
          download(`modelo-${ent.value}.csv`, '﻿' + cols.join(';') + '\n', 'text/csv');
        }, 'ghost'),
      ),
    ),
  );
}
