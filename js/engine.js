// Regras de negócio: saúde das contas, prioridades sugeridas, whitespace e métricas.
import { store } from './store.js';
import { FAMILIES, CLOSED_STAGES, SALES_CATEGORIES } from './schema.js';
import { today, daysBetween, addDays, maxDate, minDate, weekStart, periodBounds, currentPeriods, inRange, norm } from './util.js';

const TIER_BONUS = { 'Estratégica': 15, 'Chave': 8, 'SMB': 0 };
const EXEC_ROLES = ['Gerente', 'Diretor / Comandante', 'Decisor (Economic Buyer)'];
export const isOpenOpp = (o) => !CLOSED_STAGES.includes(o.stage);
export const accName = (id) => store.db.accounts.find((a) => a.id === id)?.name || '—';
export const contactName = (id) => store.db.contacts.find((c) => c.id === id)?.name || '';

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
  const ints = db.interactions.filter((i) => i.accountId === acc.id && i.date && i.date <= ref && i.type !== 'Interno');
  const lastContact = maxDate(ints.map((i) => i.date));
  const techs = db.techActivities.filter((t) => t.accountId === acc.id && t.date && t.date <= ref && t.status !== 'Cancelada' && t.status !== 'Planejada');
  const lastTech = maxDate(techs.map((t) => t.date));
  const contacts = db.contacts.filter((c) => c.accountId === acc.id && !c.inactive);
  const followUps = db.interactions.filter((i) => i.accountId === acc.id && i.followUpDate && !i.followUpDone);
  const overdueFU = followUps.filter((i) => i.followUpDate < ref);
  const lic = db.licenses.filter((l) => l.accountId === acc.id && l.status !== 'Cancelada' && l.status !== 'Proposta');
  const upcoming = lic.filter((l) => l.renewalDate && l.renewalDate >= ref).sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
  const nextRenewal = upcoming[0] || null;
  const opps = db.opportunities.filter((o) => o.accountId === acc.id && isOpenOpp(o));
  const pipeline = opps.reduce((s, o) => s + (Number(o.value) || 0), 0);
  const pool = db.techPool.filter((p) => p.accountId === acc.id && p.status === 'Ativa');

  const reasons = [];
  let score = 100;
  const skip = acc.status === 'Repassada';
  const isClient = ['Cliente ativo', 'Cliente sem TECS'].includes(acc.status);
  const dContact = lastContact ? daysBetween(lastContact, ref) : null;
  const dTech = lastTech ? daysBetween(lastTech, ref) : null;

  if (!skip) {
    if (dContact === null) {
      score -= 30;
      reasons.push({ t: 'Nenhuma interação registrada', w: 30 });
    } else if (dContact > cad.contact * 2) {
      score -= 35;
      reasons.push({ t: `Sem contato há ${dContact} dias (meta: ${cad.contact})`, w: 35 });
    } else if (dContact > cad.contact) {
      score -= 20;
      reasons.push({ t: `Contato atrasado: ${dContact} dias (meta: ${cad.contact})`, w: 20 });
    }
    if (isClient) {
      if (dTech === null) {
        score -= 15;
        reasons.push({ t: 'Nenhuma atividade técnica registrada', w: 15 });
      } else if (dTech > cad.tech) {
        score -= 15;
        reasons.push({ t: `Sem atividade técnica há ${dTech} dias (meta: ${cad.tech})`, w: 15 });
      }
    }
    if (!contacts.some((c) => c.role === 'Champion')) {
      score -= isClient ? 10 : 5;
      reasons.push({ t: 'Sem champion mapeado', w: 10 });
    }
    if (!contacts.some((c) => EXEC_ROLES.includes(c.role) && Number(c.engagement || 0) >= 3)) {
      score -= isClient ? 10 : 5;
      reasons.push({ t: 'Sem engajamento executivo (gerente/diretor ≥ 3)', w: 10 });
    }
    if (nextRenewal) {
      const d = daysBetween(ref, nextRenewal.renewalDate);
      const hasRenewOpp = opps.some((o) => o.type === 'Renovação');
      if (d <= 90 && !hasRenewOpp) {
        score -= 20;
        reasons.push({ t: `Renovação em ${d} dias sem oportunidade aberta`, w: 20 });
      }
    }
    if (lic.some((l) => l.status === 'TECS expirado')) {
      score -= 5;
      reasons.push({ t: 'Licenças com TECS expirado (reativação)', w: 5 });
    }
    if (overdueFU.length) {
      score -= 10;
      reasons.push({ t: `${overdueFU.length} follow-up(s) vencido(s)`, w: 10 });
    }
  }
  score = Math.max(0, Math.min(100, score));
  const level = skip ? 'na' : score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'risk';

  // Próxima ação: follow-up mais próximo ou data em que o contato vence
  const contactDue = lastContact ? addDays(lastContact, cad.contact) : ref;
  const fu = minDate(followUps.map((i) => i.followUpDate));
  let nextAction = { date: contactDue, label: 'Contato de cadência' };
  if (fu && fu <= contactDue) nextAction = { date: fu, label: 'Follow-up' };

  return { score, level, reasons: reasons.sort((a, b) => b.w - a.w), lastContact, lastTech, dContact, dTech, contacts, followUps, overdueFU, lic, nextRenewal, opps, pipeline, pool, nextAction, cad };
}

export const HEALTH_LABEL = { ok: 'Saudável', warn: 'Atenção', risk: 'Risco', na: '—' };

// ---------- Whitespace ----------
export function familiesOf(text) {
  const t = norm(text);
  return FAMILIES.filter((f) => f.kw.some((k) => t.includes(k))).map((f) => f.key);
}
export function whitespaceRow(acc) {
  const db = store.db;
  const row = {};
  const mark = (txt, state, rank) => familiesOf(txt).forEach((k) => {
    if (!row[k] || row[k].rank < rank) row[k] = { state, rank };
  });
  db.licenses.filter((l) => l.accountId === acc.id && ['Ativa', 'Em renovação'].includes(l.status)).forEach((l) => mark(l.product, 'owned', 5));
  db.licenses.filter((l) => l.accountId === acc.id && l.status === 'TECS expirado').forEach((l) => mark(l.product, 'lapsed', 4));
  db.opportunities.filter((o) => o.accountId === acc.id && isOpenOpp(o)).forEach((o) => mark(`${o.products || ''} ${o.name}`, 'opp', 3));
  db.techPool.filter((p) => p.accountId === acc.id && ['Ativa', 'Solicitada'].includes(p.status)).forEach((p) => mark(p.products, 'trial', 2));
  const manual = acc.whitespace || {};
  FAMILIES.forEach((f) => {
    if (!row[f.key] && manual[f.key]) row[f.key] = { state: manual[f.key], rank: 1, manual: true };
  });
  return row;
}

// ---------- Sugestões de prioridade semanal ----------
export function suggestions() {
  const db = store.db;
  const ref = today();
  const ws = weekStart(ref);
  const we = addDays(ws, 6);
  const fyEnd = periodBounds(currentPeriods(ref, db.settings.fyEndMonth).year, db.settings.fyEndMonth).end;
  const daysToFy = daysBetween(ref, fyEnd);
  const accs = Object.fromEntries(db.accounts.map((a) => [a.id, a]));
  const active = (a) => a && a.status !== 'Repassada';
  const tb = (a) => TIER_BONUS[a?.tier] || 0;
  const out = [];
  const add = (s) => out.push(s);

  db.interactions.forEach((i) => {
    const a = accs[i.accountId];
    if (!active(a) || !i.followUpDate || i.followUpDone || i.followUpDate > addDays(we, 3)) return;
    const late = daysBetween(i.followUpDate, ref);
    add({
      key: 'fu:' + i.id, title: `Follow-up: ${i.subject || 'interação'}`, accountId: a.id, category: 'Relacionamento',
      reason: late > 0 ? `Vencido há ${late} dias (${i.type} de ${i.date ? i.date.split('-').reverse().join('/') : '—'})` : `Previsto para ${i.followUpDate.split('-').reverse().join('/')}`,
      score: 80 + Math.min(15, Math.max(0, late)) + tb(a), due: i.followUpDate, ref: { c: 'interactions', id: i.id },
    });
  });

  db.opportunities.filter(isOpenOpp).forEach((o) => {
    const a = accs[o.accountId];
    if (!active(a)) return;
    const prob = Number(o.probability) || 0;
    const fyBoost = o.closeDate && daysToFy <= 75 && o.closeDate <= fyEnd ? 15 : 0;
    if (o.closeDate && o.closeDate <= addDays(ref, 30) && o.stage !== 'Em espera') {
      const d = daysBetween(ref, o.closeDate);
      add({
        key: 'opp:' + o.id, title: `Avançar: ${o.name}`, accountId: a.id, oppId: o.id, category: o.type === 'Renovação' ? 'Renovação' : 'Venda / oportunidade',
        reason: (d < 0 ? `Fechamento previsto passou há ${-d} dias` : `Fechamento previsto em ${d} dias`) + (o.nextStep ? ` · Próximo passo: ${o.nextStep}` : '') + (fyBoost ? ' · fecha dentro do FY' : ''),
        score: 72 + prob / 5 + tb(a) + fyBoost + (d < 0 ? 5 : 0), due: o.closeDate,
      });
    } else {
      const idle = daysBetween((o.updatedAt || o.createdAt || ref).slice(0, 10), ref);
      if (idle >= 21 && !o.stage.startsWith('0')) {
        add({
          key: 'stale:' + o.id, title: `Oportunidade parada: ${o.name}`, accountId: a.id, oppId: o.id, category: 'Venda / oportunidade',
          reason: `Sem atualização há ${idle} dias · estágio ${o.stage}`, score: 55 + Math.min(15, idle / 7) + tb(a) + fyBoost,
        });
      }
    }
  });

  const renGroups = {};
  db.licenses.forEach((l) => {
    const a = accs[l.accountId];
    if (!active(a) || !l.renewalDate || ['Cancelada', 'Proposta'].includes(l.status)) return;
    const d = daysBetween(ref, l.renewalDate);
    if (d < -30 || d > 150) return;
    const k = a.id + '|' + l.renewalDate;
    (renGroups[k] = renGroups[k] || { a, date: l.renewalDate, d, items: [], ids: [] }).items.push(l.product);
    renGroups[k].ids.push(l.id);
  });
  Object.values(renGroups).forEach(({ a, date, d, items, ids }) => {
    const hasOpp = db.opportunities.some((o) => o.accountId === a.id && isOpenOpp(o) && o.type === 'Renovação');
    add({
      key: 'ren:' + ids.sort().join(','), title: `Renovação · ${a.name}`, accountId: a.id, category: 'Renovação',
      reason: (d < 0 ? `Venceu há ${-d} dias` : `Vence em ${d} dias`) + ` · ${items.join(', ')}` + (hasOpp ? '' : ' · sem oportunidade de renovação aberta'),
      score: 58 + Math.max(0, (150 - d) / 5) + (hasOpp ? 0 : 10) + tb(a), due: date,
    });
  });

  db.techPool.forEach((p) => {
    const a = accs[p.accountId];
    if (!active(a) || !p.endDate) return;
    const d = daysBetween(ref, p.endDate);
    if (p.status === 'Ativa' && d <= 21) {
      add({
        key: 'pool:' + p.id, title: `Converter avaliação: ${p.products}`, accountId: a.id, oppId: p.oppId, category: 'Venda / oportunidade',
        reason: d < 0 ? `${p.kind} terminou há ${-d} dias sem resultado registrado` : `${p.kind} termina em ${d} dias`, score: 74 + tb(a), due: p.endDate,
      });
    }
  });

  db.accounts.filter(active).forEach((a) => {
    const s = accountStats(a);
    if (a.status === 'Prospect' && !s.lastContact) return;
    if (s.dContact === null || s.dContact > s.cad.contact) {
      const over = s.dContact === null ? s.cad.contact : s.dContact - s.cad.contact;
      add({
        key: 'eng:' + a.id, title: `Re-engajar ${a.name}`, accountId: a.id, category: 'Relacionamento',
        reason: s.dContact === null ? 'Nenhum contato registrado' : `Último contato há ${s.dContact} dias (cadência ${s.cad.contact})`,
        score: 48 + Math.min(25, over / 2) + tb(a),
      });
    }
    if (['Cliente ativo', 'Cliente sem TECS'].includes(a.status) && (s.dTech === null || s.dTech > s.cad.tech) && a.tier !== 'SMB') {
      add({
        key: 'tech:' + a.id, title: `Agendar atividade técnica · ${a.name}`, accountId: a.id, category: 'Técnica (com time)',
        reason: s.dTech === null ? 'Nenhuma atividade técnica registrada' : `Última atividade técnica há ${s.dTech} dias`, score: 42 + tb(a),
      });
    }
  });

  db.prospects.forEach((p) => {
    if (['Virou oportunidade', 'Descartado', 'Pausado'].includes(p.status)) return;
    const idle = daysBetween((p.updatedAt || p.createdAt || ref).slice(0, 10), ref);
    if (idle >= 14) {
      add({
        key: 'pro:' + p.id, title: `Prospecção: ${p.title}`, accountId: p.accountId, category: 'Prospecção',
        reason: `Parado há ${idle} dias · ${p.status}${p.nextStep ? ' · ' + p.nextStep : ''}`, score: 38 + Math.min(10, idle / 7),
      });
    }
  });

  const h = db.settings.prospectingHoursWeek || 0;
  if (h) add({ key: `blk:pro:${ws}`, title: `Bloco de prospecção (${h} h na semana)`, category: 'Prospecção', reason: 'Meta semanal de prospecção — reserve na agenda', score: 66, estMin: h * 60 });
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
  const pros = db.prospects.filter((p) => inRange((p.createdAt || '').slice(0, 10), b));
  const oppsNew = db.opportunities.filter((o) => inRange((o.createdAt || '').slice(0, 10), b));
  const won = db.opportunities.filter((o) => o.stage === 'Ganha' && inRange(o.closeDate, b));
  const tasks = db.tasks.filter((t) => inRange(t.week || t.due, b));
  const done = tasks.filter((t) => t.status === 'Feito');
  return {
    bounds: b,
    salesValue: sales.reduce((s, x) => s + (Number(x.value) || 0), 0),
    salesCount: sales.length,
    techCount: techs.length,
    techHours: techs.reduce((s, t) => s + (Number(t.hours) || 0), 0),
    interactions: ints.length,
    visits: visits.length,
    prospects: pros.length,
    newOpps: oppsNew.length,
    won: won.length,
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
  db.accounts.filter((a) => a.status !== 'Repassada').forEach((a) => {
    const miss = [];
    if (!a.ansysNumber && a.status !== 'Prospect') miss.push('Ansys Number');
    if (!a.city) miss.push('cidade');
    if (a.lat == null || a.lat === '') miss.push('localização no mapa');
    if (!db.contacts.some((c) => c.accountId === a.id)) miss.push('contatos');
    const lic = db.licenses.filter((l) => l.accountId === a.id);
    if (['Cliente ativo', 'Cliente sem TECS'].includes(a.status) && !lic.length) miss.push('licenças');
    if (lic.some((l) => !l.renewalDate && l.status === 'Ativa')) miss.push('data de renovação');
    if (miss.length) gaps.push({ account: a, miss });
  });
  const notLogged = db.interactions.filter((i) => !i.sfLogged && i.type !== 'Interno' && i.date && i.date >= addDays(today(), -30)).length;
  return { gaps, notLogged };
}
