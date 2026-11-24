// Estado da aplicação, persistência criptografada (localStorage + GitHub) e CRUD.
import { encryptVault, decryptWithPassword, decryptWithKey, deriveKeyCtx } from './crypto.js';
import { uid, today } from './util.js';
import * as gh from './github.js';

const LS_VAULT = 'caeacc.vault';
const LS_SYNC = 'caeacc.sync'; // { pendingSince, lastPush, lastPull }
const SS_KEY = 'caeacc.session';
export const COLLECTIONS = ['accounts', 'contacts', 'licenses', 'opportunities', 'sales', 'interactions', 'techActivities', 'techPool', 'trainings', 'prospects', 'tasks', 'plans'];

export const store = {
  db: null,
  keyCtx: null,
  listeners: new Set(),
  syncState: JSON.parse(localStorage.getItem(LS_SYNC) || '{}'),
  syncing: false,
  syncError: null,
};

export function defaultSettings() {
  return {
    userName: 'José',
    fyEndMonth: 10,
    weeklyCapacityHours: 30,
    prospectingHoursWeek: 5,
    lockMinutes: 30,
    cadence: {
      'Estratégica': { contact: 14, tech: 45 },
      'Chave': { contact: 30, tech: 90 },
      'SMB': { contact: 45, tech: 120 },
    },
    team: [],
    github: { owner: '', repo: '', branch: 'main', path: 'data/vault.json', token: '', autoSync: true },
    dismissed: {},
  };
}

export function emptyDb() {
  const db = { meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, settings: defaultSettings(), weekReviews: {} };
  COLLECTIONS.forEach((c) => (db[c] = []));
  return db;
}

export function normalizeDb(db) {
  const base = emptyDb();
  db = { ...base, ...db };
  db.meta = { ...base.meta, ...(db.meta || {}) };
  const ds = defaultSettings();
  db.settings = { ...ds, ...(db.settings || {}) };
  db.settings.github = { ...ds.github, ...(db.settings.github || {}) };
  db.settings.cadence = { ...ds.cadence, ...(db.settings.cadence || {}) };
  db.weekReviews = db.weekReviews || {};
  COLLECTIONS.forEach((c) => (db[c] = Array.isArray(db[c]) ? db[c] : []));
  return db;
}

// ---------- Cofre ----------
export function localVault() {
  try {
    return JSON.parse(localStorage.getItem(LS_VAULT) || 'null');
  } catch {
    return null;
  }
}
export async function remoteVault() {
  try {
    const r = await fetch('data/vault.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
export async function hasAnyVault() {
  return !!(localVault() || (await remoteVault()));
}

function setSession(keyCtx) {
  store.keyCtx = keyCtx;
  sessionStorage.setItem(SS_KEY, JSON.stringify({ ...keyCtx, at: Date.now() }));
}
export function lock() {
  sessionStorage.removeItem(SS_KEY);
  store.db = null;
  store.keyCtx = null;
}

// Escolhe a versão mais recente entre o cofre local e o publicado no site.
async function openBest(candidates, opener) {
  let best = null;
  let lastErr = null;
  for (const v of candidates.filter(Boolean)) {
    try {
      const res = await opener(v);
      if (!best || (res.data.meta?.updatedAt || '') > (best.data.meta?.updatedAt || '')) best = res;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!best) throw lastErr || new Error('Nenhum dado encontrado');
  return best;
}

export async function unlock(password) {
  const cands = [localVault(), await remoteVault()];
  const best = await openBest(cands, (v) => decryptWithPassword(v, password)).catch(() => {
    throw new Error('Senha incorreta');
  });
  store.db = normalizeDb(best.data);
  setSession(best.keyCtx);
  await persistLocal();
  pullIfNewer();
  return store.db;
}

export async function resume() {
  const s = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
  if (!s) return false;
  try {
    const keyCtx = { raw: s.raw, salt: s.salt, iterations: s.iterations };
    const best = await openBest([localVault(), await remoteVault()], async (v) => ({ data: await decryptWithKey(v, keyCtx), keyCtx }));
    store.db = normalizeDb(best.data);
    setSession(keyCtx);
    pullIfNewer();
    return true;
  } catch {
    sessionStorage.removeItem(SS_KEY);
    return false;
  }
}

export async function setup(password, initial) {
  const keyCtx = await deriveKeyCtx(password);
  store.db = normalizeDb(initial || emptyDb());
  store.db.meta.updatedAt = new Date().toISOString();
  setSession(keyCtx);
  await persistLocal(true);
}

export async function changePassword(newPassword) {
  const keyCtx = await deriveKeyCtx(newPassword);
  setSession(keyCtx);
  touch();
  await persistLocal(true);
}

// ---------- Persistência ----------
let saveTimer = null;
let syncTimer = null;
function touch() {
  store.db.meta.updatedAt = new Date().toISOString();
}
export function save() {
  touch();
  emit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistLocal(true), 300);
}
async function persistLocal(markPending = false) {
  if (!store.db || !store.keyCtx) return;
  const vault = await encryptVault(store.db, store.keyCtx);
  localStorage.setItem(LS_VAULT, JSON.stringify(vault));
  if (markPending) {
    store.syncState.pendingSince = store.syncState.pendingSince || new Date().toISOString();
    saveSync();
    scheduleSync();
  }
  return vault;
}
function saveSync() {
  localStorage.setItem(LS_SYNC, JSON.stringify(store.syncState));
}
function scheduleSync() {
  const g = store.db?.settings?.github;
  if (!g || !g.autoSync || !gh.configured(g)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushNow().catch(() => {}), 4000);
}

export async function pushNow() {
  const g = store.db.settings.github;
  if (!gh.configured(g)) throw new Error('Configure a sincronização com o GitHub em Configurações');
  store.syncing = true;
  store.syncError = null;
  emit(true);
  try {
    const vault = await persistLocal(false);
    await gh.pushVault(g, vault);
    store.syncState.pendingSince = null;
    store.syncState.lastPush = new Date().toISOString();
    saveSync();
  } catch (e) {
    store.syncError = e.message;
    throw e;
  } finally {
    store.syncing = false;
    emit(true);
  }
}

// Ao abrir, verifica se o GitHub tem uma versão mais nova (outro dispositivo).
export async function pullIfNewer(force = false) {
  const g = store.db?.settings?.github;
  if (!gh.configured(g)) return false;
  try {
    const v = await gh.pullVault(g);
    if (!v) return false;
    if (!force && (v.updatedAt || '') <= (store.db.meta.updatedAt || '')) return false;
    let data;
    try {
      data = await decryptWithKey(v, store.keyCtx);
    } catch {
      store.syncError = 'A versão do GitHub usa outra senha. Entre com ela ou envie esta versão.';
      emit(true);
      return false;
    }
    store.db = normalizeDb(data);
    await persistLocal(false);
    store.syncState.pendingSince = null;
    store.syncState.lastPull = new Date().toISOString();
    saveSync();
    emit();
    return true;
  } catch (e) {
    store.syncError = e.message;
    emit(true);
    return false;
  }
}

// ---------- Eventos ----------
export function subscribe(fn) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}
function emit(statusOnly = false) {
  store.listeners.forEach((fn) => fn(statusOnly));
}

// ---------- CRUD ----------
export const all = (c) => store.db[c];
export const get = (c, id) => store.db[c].find((r) => r.id === id);
export function upsert(c, rec) {
  const now = new Date().toISOString();
  if (!rec.id) {
    rec = { id: uid(c.slice(0, 2)), createdAt: now, ...rec };
    rec.updatedAt = now;
    store.db[c].push(rec);
  } else {
    const i = store.db[c].findIndex((r) => r.id === rec.id);
    rec = { ...rec, updatedAt: now };
    if (i >= 0) store.db[c][i] = rec;
    else store.db[c].push(rec);
  }
  save();
  return rec;
}
export function patch(c, id, changes) {
  const r = get(c, id);
  if (!r) return;
  return upsert(c, { ...r, ...changes });
}
export function remove(c, id) {
  store.db[c] = store.db[c].filter((r) => r.id !== id);
  if (c === 'accounts') {
    COLLECTIONS.forEach((k) => {
      if (k !== 'accounts' && k !== 'plans') store.db[k] = store.db[k].filter((r) => r.accountId !== id);
    });
  }
  save();
}
export function setSettings(changes) {
  store.db.settings = { ...store.db.settings, ...changes };
  save();
}

// ---------- Importação / exportação ----------
export function exportJson() {
  const copy = JSON.parse(JSON.stringify(store.db));
  copy.settings.github = { ...copy.settings.github, token: '' }; // nunca exporta o token
  return JSON.stringify(copy, null, 2);
}
export function importJson(obj, mode = 'merge') {
  const incoming = normalizeDb(obj);
  if (mode === 'replace') {
    const keepGh = store.db.settings.github;
    store.db = incoming;
    if (!incoming.settings.github.token) store.db.settings.github = keepGh;
  } else {
    COLLECTIONS.forEach((c) => {
      for (const rec of incoming[c]) {
        const i = store.db[c].findIndex((r) => r.id === rec.id);
        if (i >= 0) store.db[c][i] = { ...store.db[c][i], ...rec };
        else store.db[c].push(rec);
      }
    });
    if (obj.weekReviews) Object.assign(store.db.weekReviews, obj.weekReviews);
  }
  save();
}
export const syncPending = () => !!store.syncState.pendingSince;
export { today };
