// Regras de negócio: saúde das contas, prioridades sugeridas, whitespace, metas e métricas.
import { store } from './store.js';
import { FAMILIES, SALES_CATEGORIES, OPEN_PRE, SOLUTION_HINTS } from './schema.js';
import { today, daysBetween, addDays, maxDate, minDate, weekStart, periodBounds, currentPeriods, inRange, norm, fyOf, fyQuarterOf } from './util.js';

const TIER_BONUS = { 'Estratégica': 15, 'Chave': 8, 'SMB': 0 };
const EXEC_ROLES = ['Gerente', 'Diretor / Comandante', 'Decisor (Economic Buyer)'];
const CLIENT = ['Cliente ativo', 'Conta global'];
export const isOpenPre = OPEN_PRE;
export const accById = (id) => store.db.accounts.find((a) => a.id === id);
export const accName = (id) => accById(id)?.name || '—';
export function accPath(id) {
  const a = accById(id);
  if (!a) return '—';
  const p = a.parentId && accById(a.parentId);
  return p ? `${p.name} › ${a.name}` : a.name;
}
export const contactName = (id) => store.db.contacts.find((c) => c.id === id)?.name || '';
export const unitName = (id) => store.db.units.find((u) => u.id === id)?.name || '';
export const childrenOf = (id) => store.db.accounts.filter((a) => a.parentId === id);
export function familyIds(acc) {
  const ids = [acc.id];
  const walk = (pid) => childrenOf(pid).forEach((c) => { ids.push(c.id); walk(c.id); });
  walk(acc.id);
  return ids;
}
export function quarterKey(d = today()) {
  const fe = store.db.settings.fyEndMonth;
  return `FY${fyOf(d, fe)}-T${fyQuarterOf(d, fe)}`;
}
export function shiftQuarter(key, n) {
  let fy = Number(key.slice(2, 6));
  let q = Number(key.slice(-1)) + n;
  while (q > 4) (q -= 4), fy++;
  while (q < 1) (q += 4), fy--;
  return `FY${fy}-T${q}`;
}

export function cadenceFor(acc) {
  const c = store.db.settings.cadence;
  return c[acc.tier] || c['SMB'] || { contact: 30, tech: 90 };
}

const cache = new Map();
let cacheStamp = null;
export function accountStats(acc) {
  const stamp = store.db.meta.updatedAt + today();
  if (stamp !== cacheStamp) {
    cache.clear();
    cacheStamp = stamp;
  }
  if (cache.has(acc.id)) return cache.get(acc.id);
  const s = computeStats(acc);
  cache.set(acc.id, s);
  return s;
}

function computeStats(acc) {
  const db = store.db;
  const ref = today();
  const cad = cadenceFor(acc);
  const ids = new Set(familyIds(acc));
  const mine = (r) => ids.has(r.accountId);
  const ints = db.interactions.filter((i) => mine(i) && i.date && i.date <= ref && i.type !== 'Interno');
  const lastContact = maxDate(ints.map((i) => i.date));
  const techs = db.techActivities.filter((t) => mine(t) && t.date && t.date <= ref && t.status === 'Realizada');
  const lastTech = maxDate(techs.map((t) => t.date));
  const contacts = db.contacts.filter((c) => mine(c) && !c.inactive);
  const followUps = db.interactions.filter((i) => mine(i) && i.followUpDate && !i.followUpDone);
  const overdueFU = followUps.filter((i) => i.followUpDate < ref);
  const lic = db.licenses.filter((l) => mine(l) && ['Ativa', 'Não iniciada'].includes(l.status));
  const upcoming = lic.filter((l) => l.renewalDate && l.renewalDate >= ref && l.type !== 'Perpetual').sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
  const nextExpiry = upcoming[0] || null;
  const pre = db.prospects.filter((p) => mine(p) && OPEN_PRE(p));
  const prePotential = pre.reduce((s, p) => s + (Number(p.potential) || 0), 0);
  const pool = db.techPool.filter((p) => mine(p) && p.status === 'Ativa');
  const units = db.units.filter((u) => mine(u));
  const qk = quarterKey(ref);
  const mrp = db.mrp.filter((m) => mine(m));
  const mrpNow = mrp.filter((m) => m.period === qk);
  const mrpNext = mrp.filter((m) => m.period >= qk).sort((a, b) => a.period.localeCompare(b.period))[0] || null;
  const mrpFy = mrp.filter((m) => m.period.slice(0, 6) === qk.slice(0, 6)).reduce((s, m) => s + (Number(m.value) || 0), 0);
  const execDone = db.engagements.filter((e) => mine(e) && e.status === 'Realizada' && e.date >= addDays(ref, -180));
  const execNext = db.engagements.filter((e) => mine(e) && ['Planejada', 'Agendada'].includes(e.status) && e.date >= ref).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const sales = db.sales.filter((s) => mine(s));

  const reasons = [];
  let score = 100;
  const skip = acc.status === 'Saiu da carteira' || acc.reactive;
  const isClient = CLIENT.includes(acc.status);
  const dContact = lastContact ? daysBetween(lastContact, ref) : null;
  const dTech = lastTech ? daysBetween(lastTech, ref) : null;
  const pen = (w, t) => { score -= w; reasons.push({ t, w }); };

  if (!skip) {
    if (dContact === null) pen(30, 'Nenhuma interação registrada');
    else if (dContact > cad.contact * 2) pen(35, `Sem contato há ${dContact} dias (meta: ${cad.contact})`);
    else if (dContact > cad.contact) pen(20, `Contato atrasado: ${dContact} dias (meta: ${cad.contact})`);
    if (isClient) {
      if (dTech === null) pen(15, 'Nenhuma atividade técnica registrada');
      else if (dTech > cad.tech) pen(15, `Sem atividade técnica há ${dTech} dias (meta: ${cad.tech})`);
    }
    if (!contacts.some((c) => c.role === 'Champion')) pen(isClient ? 10 : 5, 'Sem champion mapeado');
    const execContact = contacts.some((c) => EXEC_ROLES.includes(c.role) && Number(c.engagement || 0) >= 3);
    if (!execContact && !execDone.length) pen(isClient ? 10 : 5, 'Sem relacionamento executivo (contato ≥ 3 ou reunião nos últimos 6 meses)');
    if (acc.tier !== 'SMB' && !units.length && !acc.parentId) pen(10, 'Mapa da conta vazio');
    const openNow = mrpNow.filter((m) => m.status === 'Aberto');
    if (openNow.length) pen(10, `Renovação aberta neste trimestre (MRP ${fmtUsd(openNow.reduce((s, m) => s + (Number(m.value) || 0), 0))})`);
    if (isClient && !pre.length) pen(5, 'Nenhuma iniciativa de pré-pipeline aberta');
    if (overdueFU.length) pen(10, `${overdueFU.length} follow-up(s) vencido(s)`);
  }
  score = Math.max(0, Math.min(100, score));
  const level = skip ? 'na' : score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'risk';

  const contactDue = lastContact ? addDays(lastContact, cad.contact) : ref;
  const fu = minDate(followUps.map((i) => i.followUpDate));
  const preStep = minDate(pre.map((p) => p.nextStepDate));
  let nextAction = { date: contactDue, label: 'Contato de cadência' };
  if (fu && fu <= nextAction.date) nextAction = { date: fu, label: 'Follow-up' };
  if (preStep && preStep <= nextAction.date) nextAction = { date: preStep, label: 'Passo do pré-pipeline' };

  return { reactive: !!acc.reactive, score, level, reasons: reasons.sort((a, b) => b.w - a.w), lastContact, lastTech, dContact, dTech, contacts, followUps, overdueFU, lic, nextExpiry, pre, prePotential, pool, units, mrp, mrpNow, mrpNext, mrpFy, execDone, execNext, sales, nextAction, cad, ids };
}
const fmtUsd = (v) => '$' + Math.round((v || 0) / 1000) + 'k';

export const HEALTH_LABEL = { ok: 'Saudável', warn: 'Atenção', risk: 'Risco', na: '—' };

// ---------- Whitespace ----------
export function familiesOf(text) {
  const t = norm(text);
  return FAMILIES.filter((f) => f.kw.some((k) => t.includes(k))).map((f) => f.key);
}
function wsRow(filter, manual = {}) {
  const db = store.db;
  const row = {};
  const mark = (txt, state, rank) => familiesOf(txt).forEach((k) => {
    if (!row[k] || row[k].rank < rank) row[k] = { state, rank };
  });
  db.licenses.filter((l) => filter(l) && ['Ativa', 'Não iniciada'].includes(l.status)).forEach((l) => mark(l.product, l.maintenance === 'Manutenção vencida' ? 'lapsed' : 'owned', l.maintenance === 'Manutenção vencida' ? 4 : 5));
  db.licenses.filter((l) => filter(l) && l.status === 'Expirada').forEach((l) => mark(l.product, 'expired', 1.5));
  db.prospects.filter((p) => filter(p) && OPEN_PRE(p)).forEach((p) => mark(`${p.products || ''} ${p.title}`, 'opp', 3));
  db.techPool.filter((p) => filter(p) && ['Ativa', 'Solicitada'].includes(p.status)).forEach((p) => mark(p.products, 'trial', 2));
  FAMILIES.forEach((f) => {
    if ((!row[f.key] || row[f.key].state === 'expired') && manual[f.key]) row[f.key] = { state: manual[f.key], rank: 1, manual: true };
  });
  return row;
}
export function whitespaceRow(acc) {
  const ids = new Set(familyIds(acc));
  return wsRow((r) => ids.has(r.accountId), acc.whitespace || {});
}
export function unitWhitespace(unit) {
  const db = store.db;
  const sub = new Set([unit.id]);
  let grew = true;
  while (grew) {
    grew = false;
    db.units.forEach((u) => { if (u.parentUnitId && sub.has(u.parentUnitId) && !sub.has(u.id)) { sub.add(u.id); grew = true; } });
  }
  return wsRow((r) => r.unitId && sub.has(r.unitId), unit.whitespace || {});
}
export function suggestSolutions(text) {
  const t = norm(text);
  return SOLUTION_HINTS.filter(([kws]) => kws.some((k) => t.includes(norm(k)))).map(([, s]) => s);
}

// ---------- Metas (USD NTA) ----------
export function quotaFor(period) {
  return store.db.quotas.find((q) => q.period === period) || null;
}
export function quotaSummary(period) {
  const db = store.db;
  let q = quotaFor(period);
  if (!q && /^FY\d{4}$/.test(period)) {
    const qs = [1, 2, 3, 4].map((i) => quotaFor(`${period}-T${i}`)).filter(Boolean);
    if (qs.length) q = { period, derived: true, ...['rrTarget', 'rrDone', 'nbTarget', 'nbDone'].reduce((o, k) => ((o[k] = qs.reduce((s, x) => s + (Number(x[k]) || 0), 0)), o), {}) };
  }
  const b = periodBounds(period, db.settings.fyEndMonth);
  const sold = db.sales.filter((s) => inRange(s.date, b));
  const ref = {
    rr: sold.filter((s) => s.type === 'RR').reduce((s, x) => s + (Number(x.value) || 0), 0),
    nb: sold.filter((s) => s.type === 'NB').reduce((s, x) => s + (Number(x.value) || 0), 0),
  };
  const mrp = db.mrp.filter((m) => (/^FY\d{4}$/.test(period) ? m.period.startsWith(period) : m.period === period)).reduce((s, m) => s + (Number(m.value) || 0), 0);
  return { q, ref, mrp };
}

// ---------- Sugestões de prioridade semanal ----------
export function suggestions() {
  const db = store.db;
  const ref = today();
  const ws = weekStart(ref);
  const we = addDays(ws, 6);
  const qk = quarterKey(ref);
  const accs = Object.fromEntries(db.accounts.map((a) => [a.id, a]));
  const active = (a) => a && a.status !== 'Saiu da carteira' && !a.reactive;
  const tb = (a) => TIER_BONUS[a?.tier] || 0;
  const out = [];
  const add = (s) => out.push(s);
  const br = (d) => (d ? d.split('-').reverse().join('/') : '—');

  db.interactions.forEach((i) => {
    const a = accs[i.accountId];
    if (!active(a) || !i.followUpDate || i.followUpDone || i.followUpDate > addDays(we, 3)) return;
    const late = daysBetween(i.followUpDate, ref);
    add({ key: 'fu:' + i.id, title: `Follow-up: ${i.subject || 'interação'}`, accountId: a.id, category: 'Relacionamento', reason: late > 0 ? `Vencido há ${late} dias (${i.type} de ${br(i.date)})` : `Previsto para ${br(i.followUpDate)}`, score: 80 + Math.min(15, Math.max(0, late)) + tb(a), due: i.followUpDate });
  });

  db.prospects.filter(OPEN_PRE).forEach((p) => {
    const a = accs[p.accountId];
    if (!active(a)) return;
    if (p.stage === '6 · Pronto para o Salesforce') {
      add({ key: 'sf:' + p.id, title: `Criar oportunidade no Salesforce: ${p.title}`, accountId: a.id, prospectId: p.id, category: 'Pré-pipeline', reason: `Iniciativa qualificada${p.potential ? ' · potencial ' + fmtUsd(p.potential) : ''}`, score: 88 + tb(a), estMin: 30 });
      return;
    }
    if (p.nextStepDate && p.nextStepDate <= addDays(we, 3)) {
      const late = daysBetween(p.nextStepDate, ref);
      add({ key: 'pre:' + p.id + ':' + p.nextStepDate, title: `${p.nextStep || 'Avançar iniciativa'} · ${p.title}`, accountId: a.id, prospectId: p.id, category: 'Pré-pipeline', reason: `${p.stage}${late > 0 ? ` · passo vencido há ${late} dias` : ` · previsto para ${br(p.nextStepDate)}`}`, score: 76 + Math.min(12, Math.max(0, late)) + tb(a) + Math.min(10, (Number(p.potential) || 0) / 20000), due: p.nextStepDate });
    } else {
      const idle = daysBetween((p.updatedAt || p.createdAt || ref).slice(0, 10), ref);
      if (idle >= 21) add({ key: 'idle:' + p.id, title: `Iniciativa parada: ${p.title}`, accountId: a.id, prospectId: p.id, category: 'Pré-pipeline', reason: `Sem atualização há ${idle} dias · ${p.stage}${p.nextStepDate ? '' : ' · sem data de próximo passo'}`, score: 52 + Math.min(12, idle / 7) + tb(a) });
    }
  });

  db.mrp.forEach((m) => {
    const a = accs[m.accountId];
    if (!active(a) || m.status !== 'Aberto' || !(m.period === qk || m.period === shiftQuarter(qk, 1))) return;
    const end = periodBounds(m.period, db.settings.fyEndMonth).end;
    const d = daysBetween(ref, end);
    add({ key: 'mrp:' + m.id, title: `Renovação ${m.period.replace('FY20', 'FY').replace('-T', ' Q')} · ${a.name}`, accountId: a.id, category: 'Renovação', reason: `MRP ${fmtUsd(m.value)} · trimestre termina em ${d} dias${m.sfOpp ? '' : ' · sem oportunidade registrada'}`, score: 60 + Math.max(0, (120 - d) / 4) + Math.min(15, (Number(m.value) || 0) / 20000) + tb(a), due: end });
  });

  const expGroups = {};
  db.licenses.forEach((l) => {
    const a = accs[l.accountId];
    if (!active(a) || l.type === 'Perpetual' || l.status !== 'Ativa' || !l.renewalDate) return;
    const d = daysBetween(ref, l.renewalDate);
    if (d < 0 || d > 45) return;
    const k = a.id + '|' + l.renewalDate;
    (expGroups[k] = expGroups[k] || { a, date: l.renewalDate, d, items: [] }).items.push(l.product);
  });
  Object.entries(expGroups).forEach(([k, g]) => add({ key: 'exp:' + k, title: `Licenças expiram · ${g.a.name}`, accountId: g.a.id, category: 'Renovação', reason: `${g.items.length} item(ns) em ${g.d} dias: ${g.items.slice(0, 3).join(', ')}${g.items.length > 3 ? '…' : ''}`, score: 62 + (45 - g.d) / 3 + tb(g.a), due: g.date }));

  db.techPool.forEach((p) => {
    const a = accs[p.accountId];
    if (!active(a) || !p.endDate || p.status !== 'Ativa') return;
    const d = daysBetween(ref, p.endDate);
    if (d <= 21) add({ key: 'pool:' + p.id, title: `Converter avaliação: ${p.products}`, accountId: a.id, prospectId: p.prospectId, category: 'Pré-pipeline', reason: d < 0 ? `${p.kind} terminou há ${-d} dias sem resultado registrado` : `${p.kind} termina em ${d} dias`, score: 74 + tb(a), due: p.endDate });
  });

  db.engagements.forEach((e) => {
    if (!['Planejada', 'Agendada'].includes(e.status) || !e.date) return;
    const a = accs[e.accountId];
    const d = daysBetween(ref, e.date);
    if (d < -3 || d > 30) return;
    if (e.status === 'Planejada' && !e.dateTbd) add({ key: 'eng-s:' + e.id, title: `Agendar: ${e.title}`, accountId: e.accountId, category: 'Relacionamento', reason: `${e.type} prevista para ${br(e.date)} ainda não agendada`, score: 70 + tb(a) });
    else if (d <= 10) add({ key: 'eng-p:' + e.id, title: `Preparar: ${e.title}`, accountId: e.accountId, category: 'Relacionamento', reason: `${e.type} em ${d} dias${e.objective ? ' · ' + e.objective.slice(0, 80) : ''}`, score: 72 + tb(a), due: e.date });
  });

  db.accounts.filter(active).forEach((a) => {
    const s = accountStats(a);
    if (a.status === 'Prospect' && !s.lastContact) return;
    if (s.dContact === null || s.dContact > s.cad.contact) {
      const over = s.dContact === null ? s.cad.contact : s.dContact - s.cad.contact;
      add({ key: 'eng:' + a.id, title: `Re-engajar ${a.name}`, accountId: a.id, category: 'Relacionamento', reason: s.dContact === null ? 'Nenhum contato registrado' : `Último contato há ${s.dContact} dias (cadência ${s.cad.contact})`, score: 46 + Math.min(25, over / 2) + tb(a) });
    }
    if (a.tier === 'Estratégica' && !a.parentId) {
      const empty = s.units.filter((u) => !u.challenges || !u.solutions);
      if (!s.units.length || empty.length) add({ key: 'map:' + a.id, title: `Mapear ${a.name}`, accountId: a.id, category: 'Mapeamento de conta', reason: !s.units.length ? 'Mapa da conta vazio' : `${empty.length} unidade(s) sem desafios ou soluções preenchidos`, score: 50 + tb(a) });
    }
    if (CLIENT.includes(a.status) && a.tier !== 'SMB' && (s.dTech === null || s.dTech > s.cad.tech)) {
      add({ key: 'tech:' + a.id, title: `Agendar atividade técnica · ${a.name}`, accountId: a.id, category: 'Técnica (com time)', reason: s.dTech === null ? 'Nenhuma atividade técnica registrada' : `Última atividade técnica há ${s.dTech} dias`, score: 42 + tb(a) });
    }
  });

  const h = db.settings.prospectingHoursWeek || 0;
  if (h) add({ key: `blk:pro:${ws}`, title: `Bloco de prospecção (${h} h na semana)`, category: 'Prospecção', reason: 'Meta semanal — whitespaces, hipóteses e pesquisa de fora para dentro', score: 66, estMin: h * 60 });
  add({ key: `blk:rev:${ws}`, title: 'Revisão semanal (sexta de manhã)', category: 'Planejamento', reason: 'Fecha a semana e escolhe as prioridades da próxima', score: 64, estMin: 45, due: addDays(ws, 4) });

  const dismissed = db.settings.dismissed || {};
  const inWeek = new Set(db.tasks.filter((t) => t.week === ws && t.sugKey).map((t) => t.sugKey));
  return out
    .filter((s) => !(dismissed[s.key] && dismissed[s.key] >= ref) && !inWeek.has(s.key))
    .sort((a, b) => b.score - a.score)
    .map((s) => ({ ...s, score: Math.round(s.score) }));
}

// ---------- Métricas de período ----------
export function periodMetrics(key) {
  const db = store.db;
  const b = periodBounds(key, db.settings.fyEndMonth);
  const sales = db.sales.filter((s) => inRange(s.date, b));
  const techs = db.techActivities.filter((t) => inRange(t.date, b) && t.status === 'Realizada');
  const ints = db.interactions.filter((i) => inRange(i.date, b) && i.type !== 'Interno');
  const visits = ints.filter((i) => i.type === 'Visita presencial');
  const pre = db.prospects.filter((p) => inRange((p.createdAt || '').slice(0, 10), b));
  const toSf = db.prospects.filter((p) => p.stage === '✓ No Salesforce' && inRange(p.sfAt, b));
  const execs = db.engagements.filter((e) => inRange(e.date, b));
  const tasks = db.tasks.filter((t) => inRange(t.week || t.due, b));
  const done = tasks.filter((t) => t.status === 'Feito');
  return {
    bounds: b,
    nb: sales.filter((s) => s.type === 'NB').reduce((s, x) => s + (Number(x.value) || 0), 0),
    rr: sales.filter((s) => s.type === 'RR').reduce((s, x) => s + (Number(x.value) || 0), 0),
    techCount: techs.length,
    techHours: techs.reduce((s, t) => s + (Number(t.hours) || 0), 0),
    interactions: ints.length,
    visits: visits.length,
    newPre: pre.length,
    toSf: toSf.length,
    toSfValue: toSf.reduce((s, p) => s + (Number(p.potential) || 0), 0),
    execPlanned: execs.length,
    execDone: execs.filter((e) => e.status === 'Realizada').length,
    tasks: tasks.length,
    tasksDone: done.length,
    salesRatio: tasks.length ? Math.round((tasks.filter((t) => SALES_CATEGORIES.includes(t.category)).length / tasks.length) * 100) : null,
  };
}

export function meddicScore(o) {
  const keys = ['m_metrics', 'm_economicBuyer', 'm_decisionCriteria', 'm_decisionProcess', 'm_pain', 'm_champion'];
  return keys.filter((k) => o[k] && String(o[k]).trim()).length;
}

// Qualidade de dados — o que falta preencher
export function dataGaps() {
  const db = store.db;
  const gaps = [];
  db.accounts.filter((a) => a.status !== 'Saiu da carteira' && !a.reactive).forEach((a) => {
    const miss = [];
    const isGroup = db.accounts.some((x) => x.parentId === a.id);
    if (!a.ansysNumber && a.status !== 'Prospect' && !isGroup) miss.push('Ansys Number');
    if (!a.city && !a.parentId && !isGroup) miss.push('cidade');
    if ((a.lat == null || a.lat === '') && !a.parentId && !isGroup) miss.push('localização no mapa');
    if (!db.contacts.some((c) => c.accountId === a.id)) miss.push('contatos');
    if (a.tier !== 'SMB' && !a.parentId && !db.units.some((u) => u.accountId === a.id)) miss.push('mapa da conta');
    if (miss.length) gaps.push({ account: a, miss });
  });
  const notLogged = db.interactions.filter((i) => !i.sfLogged && i.type !== 'Interno' && i.date && i.date >= addDays(today(), -30)).length;
  return { gaps, notLogged };
}
export { currentPeriods };
