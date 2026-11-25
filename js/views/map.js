import { store, patch } from '../store.js';
import { h, section, btn, toast, healthBadge } from '../ui.js';
import { accountStats } from '../engine.js';
import { go } from '../main.js';

const COLORS = { ok: '#16A34A', warn: '#F59E0B', risk: '#DC2626', na: '#9CA3AF' };
const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; OpenStreetMap';

function marker(L, a) {
  const st = accountStats(a);
  return L.circleMarker([Number(a.lat), Number(a.lng)], { radius: a.tier === 'Estratégica' ? 10 : 7, color: '#fff', weight: 2, fillColor: COLORS[st.level], fillOpacity: 0.95 });
}

export async function geocode(a) {
  const q = [a.address, a.city, a.state, 'Brasil'].filter(Boolean).join(', ');
  if (!q.replace('Brasil', '').trim()) throw new Error('Preencha endereço ou cidade primeiro');
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'pt-BR' } });
  const j = await r.json();
  if (!j.length) throw new Error('Endereço não encontrado');
  return { lat: Number(Number(j[0].lat).toFixed(5)), lng: Number(Number(j[0].lon).toFixed(5)) };
}
async function locate(a) {
  try {
    const p = await geocode(a);
    patch('accounts', a.id, p);
    toast('Localização encontrada');
  } catch (e) {
    toast(e.message, 'err');
  }
}

export function miniMap(a) {
  const has = a.lat != null && a.lat !== '' && a.lng != null && a.lng !== '';
  const box = h('div', { class: 'minimap' });
  const wrap = h('div', null, box,
    h('div', { class: 'toolbar small' },
      h('span', { class: 'muted small' }, [a.address, a.city, a.state].filter(Boolean).join(', ') || 'Sem endereço'),
      btn(has ? 'Atualizar pelo endereço' : 'Localizar pelo endereço', () => locate(a), 'small ghost'),
      has ? h('a', { class: 'btn small ghost', target: '_blank', href: `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}` }, 'Abrir no Google Maps') : null),
  );
  if (!has) {
    box.classList.add('empty');
    box.textContent = 'Sem coordenadas. Preencha o endereço e clique em “Localizar”.';
    return wrap;
  }
  requestAnimationFrame(() => {
    if (!window.L || !box.isConnected) return;
    const L = window.L;
    const m = L.map(box, { scrollWheelZoom: false }).setView([Number(a.lat), Number(a.lng)], 12);
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 18 }).addTo(m);
    marker(L, a).addTo(m);
  });
  return wrap;
}

export default function mapView() {
  const db = store.db;
  const accs = db.accounts.filter((a) => a.status !== 'Saiu da carteira');
  const located = accs.filter((a) => a.lat != null && a.lat !== '' && a.lng != null && a.lng !== '');
  const missing = accs.filter((a) => !located.includes(a));
  const box = h('div', { class: 'bigmap' });
  requestAnimationFrame(() => {
    if (!window.L || !box.isConnected) return;
    const L = window.L;
    const m = L.map(box).setView([-23.5, -47.5], 5);
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 18 }).addTo(m);
    const pts = [];
    located.forEach((a) => {
      const st = accountStats(a);
      const mk = marker(L, a).addTo(m);
      const pop = h('div', { class: 'pop' }, h('b', null, a.name), h('div', null, `${a.tier || ''} · ${a.status || ''}`), h('div', null, healthBadge(st)), h('a', { href: '#/account/' + a.id }, 'Abrir conta →'));
      mk.bindPopup(pop);
      pts.push([Number(a.lat), Number(a.lng)]);
    });
    if (pts.length > 1) m.fitBounds(pts, { padding: [40, 40], maxZoom: 8 });
  });
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Mapa das contas'), h('div', { class: 'legend' }, h('span', { class: 'ws-dot ok' }, 'Saudável'), h('span', { class: 'ws-dot warn' }, 'Atenção'), h('span', { class: 'ws-dot risk' }, 'Risco'), h('small', { class: 'muted' }, 'círculo maior = estratégica'))),
    section(`${located.length} contas no mapa`, null, box),
    missing.length ? section(`${missing.length} contas sem localização`, null,
      h('ul', { class: 'list compact' }, missing.map((a) => h('li', null, h('div', { class: 'li-main' }, h('b', null, a.name), h('small', null, [a.city, a.state].filter(Boolean).join('/') || 'sem cidade')),
        btn('Localizar', () => locate(a), 'small'), btn('Editar', () => go('#/account/' + a.id), 'small ghost'))))) : null,
  );
}
