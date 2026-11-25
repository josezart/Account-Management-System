import { store, all, upsert, patch, setSettings, save } from '../store.js';
import { h, section, btn, badge, openForm, kpi, toast, dueBadge, accountOptions } from '../ui.js';
import { suggestions, accName } from '../engine.js';
import { ENUMS, SALES_CATEGORIES, WEEK_REVIEW } from '../schema.js';
import { fmt, today, addDays, weekStart } from '../util.js';
import { setParam, go } from '../main.js';

const PRIO_CLS = { Alta: 'risk', Média: 'warn', Baixa: 'muted' };

export default function weekView({ params }) {
  const db = store.db;
  const ws = params.w || weekStart(today());
  const we = addDays(ws, 6);
  const isCurrent = ws === weekStart(today());
  const tasks = db.tasks.filter((t) => t.week === ws);
  const carry = isCurrent ? db.tasks.filter((t) => t.week && t.week < ws && t.status !== 'Feito') : [];
  const allT = [...tasks, ...carry];
  const done = tasks.filter((t) => t.status === 'Feito');
  const salesT = allT.filter((t) => SALES_CATEGORIES.includes(t.category));
  const ratio = allT.length ? Math.round((salesT.length / allT.length) * 100) : 0;
  const minutes = allT.filter((t) => t.status !== 'Feito').reduce((s, t) => s + (Number(t.estMin) || 0), 0);
  const cap = (db.settings.weeklyCapacityHours || 30) * 60;
  const prospMin = allT.filter((t) => t.category === 'Prospecção').reduce((s, t) => s + (Number(t.estMin) || 0), 0);
  const prospGoal = (db.settings.prospectingHoursWeek || 0) * 60;
  const sugg = isCurrent ? suggestions() : [];

  const addFromSuggestion = (s) => {
    upsert('tasks', { title: s.title, accountId: s.accountId || '', prospectId: s.prospectId || '', category: s.category, priority: s.score >= 80 ? 'Alta' : s.score >= 60 ? 'Média' : 'Baixa', status: 'A fazer', week: ws, due: s.due && s.due >= ws && s.due <= we ? s.due : '', estMin: s.estMin || 60, notes: s.reason, sugKey: s.key });
    toast('Adicionada à semana');
  };
  const dismiss = (s, days) => {
    const d = { ...(db.settings.dismissed || {}) };
    d[s.key] = addDays(today(), days);
    setSettings({ dismissed: d });
  };

  // Adição rápida
  const qTitle = h('input', { placeholder: 'Nova tarefa… (Enter para adicionar)' });
  const qCat = h('select', null, ENUMS.taskCategory.map((c) => h('option', null, c)));
  const qAcc = h('select', null, h('option', { value: '' }, 'Sem conta'), accountOptions().map((a) => h('option', { value: a.id }, a.label)));
  const qPri = h('select', null, ENUMS.priority.map((p) => h('option', { selected: p === 'Média' }, p)));
  const quickAdd = () => {
    if (!qTitle.value.trim()) return;
    upsert('tasks', { title: qTitle.value.trim(), category: qCat.value, accountId: qAcc.value, priority: qPri.value, status: 'A fazer', week: ws, estMin: 60 });
    qTitle.value = '';
  };
  qTitle.addEventListener('keydown', (e) => e.key === 'Enter' && quickAdd());

  const taskCard = (t, isCarry) => h('div', { class: 'task' + (t.status === 'Feito' ? ' done' : ''), onclick: () => openForm('tasks', t) },
    h('div', { class: 'task-top' },
      h('input', { type: 'checkbox', checked: t.status === 'Feito', onclick: (e) => e.stopPropagation(), onchange: (e) => patch('tasks', t.id, { status: e.target.checked ? 'Feito' : 'A fazer', doneAt: e.target.checked ? today() : null }) }),
      h('b', null, t.title)),
    h('div', { class: 'task-meta' },
      badge(t.priority || '—', PRIO_CLS[t.priority]),
      h('span', { class: 'cat ' + (SALES_CATEGORIES.includes(t.category) ? 'sales' : 'admin') }, t.category || '—'),
      t.accountId ? h('a', { href: `#/account/${t.accountId}`, class: 'link small' }, accName(t.accountId)) : null,
      t.due ? dueBadge(t.due) : null,
      t.estMin ? h('small', { class: 'muted' }, `${Math.round(t.estMin / 6) / 10} h`) : null,
      isCarry ? badge('da semana ' + fmt.dateShort(t.week), 'warn') : null,
    ),
    h('div', { class: 'task-actions' }, ENUMS.taskStatus.filter((s) => s !== t.status && s !== 'Feito').map((s) => h('button', { class: 'btn tiny ghost', onclick: (e) => { e.stopPropagation(); patch('tasks', t.id, { status: s, ...(isCarry && s !== 'Feito' ? { week: ws } : {}) }); } }, '→ ' + s)),
      isCarry ? h('button', { class: 'btn tiny', onclick: (e) => { e.stopPropagation(); patch('tasks', t.id, { week: ws }); } }, 'trazer p/ esta semana') : null),
  );
  const prioRank = { Alta: 0, Média: 1, Baixa: 2 };
  const columns = ENUMS.taskStatus.map((st) => {
    const list = allT.filter((t) => (t.status || 'A fazer') === st).sort((a, b) => (prioRank[a.priority] ?? 3) - (prioRank[b.priority] ?? 3) || (a.due || 'z').localeCompare(b.due || 'z'));
    return h('div', { class: 'col' }, h('div', { class: 'col-head' }, st, h('span', { class: 'count' }, list.length)), list.map((t) => taskCard(t, carry.includes(t))));
  });

  // Revisão semanal
  const rev = db.weekReviews[ws] || { items: {}, notes: '' };
  const setRev = (changes) => {
    db.weekReviews[ws] = { ...rev, ...changes };
    save();
  };
  const review = section('Revisão semanal', h('small', { class: 'muted' }, 'sexta de manhã · 30–45 min'),
    h('ul', { class: 'checklist' }, WEEK_REVIEW.map((item, i) => h('li', null, h('label', null, h('input', { type: 'checkbox', checked: !!rev.items[i], onchange: (e) => setRev({ items: { ...rev.items, [i]: e.target.checked } }) }), item)))),
    h('textarea', { rows: 3, placeholder: 'Notas da semana: o que funcionou, o que travou, aprendizados…', onchange: (e) => setRev({ notes: e.target.value }) }, rev.notes || ''),
  );

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Minha semana'), h('p', { class: 'muted' }, `${fmt.date(ws)} a ${fmt.date(we)}${isCurrent ? ' · semana atual' : ''}`)),
      h('div', { class: 'actions' },
        btn('← Anterior', () => setParam('w', addDays(ws, -7)), 'ghost'),
        isCurrent ? null : btn('Hoje', () => setParam('w', ''), 'ghost'),
        btn('Próxima →', () => setParam('w', addDays(ws, 7)), 'ghost')),
    ),
    h('div', { class: 'kpis' },
      kpi('Concluídas', `${done.length}/${tasks.length}`, carry.length ? `+ ${carry.length} pendentes de semanas anteriores` : 'tarefas da semana'),
      kpi('Ligadas a vendas', allT.length ? ratio + '%' : '—', `${salesT.length} de ${allT.length} tarefas · meta ≥ 70%`, allT.length && ratio < 70 ? 'warn' : 'ok'),
      kpi('Carga planejada', `${Math.round(minutes / 60)} h`, `de ${cap / 60} h de capacidade`, minutes > cap ? 'risk' : minutes > cap * 0.85 ? 'warn' : ''),
      kpi('Prospecção', `${Math.round(prospMin / 6) / 10} h`, `meta ${prospGoal / 60} h/semana`, prospMin < prospGoal ? 'warn' : 'ok'),
    ),
    minutes > cap ? h('div', { class: 'alert warn' }, `Semana sobrecarregada: ${Math.round(minutes / 60)} h planejadas para ${cap / 60} h de capacidade. Mova para a próxima semana o que for “Interna / administrativa” ou de baixa prioridade.`) : null,
    h('div', { class: 'week-layout' },
      h('div', null,
        section('Adicionar tarefa', null, h('div', { class: 'quickadd' }, qTitle, qCat, qAcc, qPri, btn('Adicionar', quickAdd, 'primary'))),
        h('div', { class: 'kanban' }, columns),
        review,
      ),
      isCurrent ? section('Prioridades sugeridas', h('small', { class: 'muted' }, 'pontuação = urgência × importância da conta'),
        sugg.length ? h('ul', { class: 'sugg' }, sugg.slice(0, 18).map((s) => h('li', null,
          h('div', { class: 'sugg-head' }, h('span', { class: 'score' }, s.score), h('b', null, s.title)),
          h('small', { class: 'muted block' }, s.reason),
          h('div', { class: 'sugg-actions' },
            h('span', { class: 'cat ' + (SALES_CATEGORIES.includes(s.category) ? 'sales' : 'admin') }, s.category),
            s.accountId ? h('a', { href: `#/account/${s.accountId}`, class: 'link small' }, accName(s.accountId)) : null,
            h('span', { class: 'spacer' }),
            btn('＋ Semana', () => addFromSuggestion(s), 'tiny primary'),
            btn('Adiar 7d', () => dismiss(s, 7), 'tiny ghost'),
          )))) : h('div', { class: 'empty' }, 'Sem sugestões no momento.'),
      ) : section('Semana futura/passada', null, h('p', { class: 'muted' }, 'As sugestões automáticas aparecem na semana atual.')),
    ),
  );
}
