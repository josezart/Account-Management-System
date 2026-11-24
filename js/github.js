// Sincronização do cofre criptografado com o repositório GitHub (API Contents).
export const configured = (g) => !!(g && g.owner && g.repo && g.token);

function api(g) {
  const path = (g.path || 'data/vault.json').replace(/^\/+/, '');
  return `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${path}`;
}
function headers(g, extra = {}) {
  return { Authorization: `Bearer ${g.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
}
function utf8ToB64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function currentSha(g) {
  const r = await fetch(`${api(g)}?ref=${encodeURIComponent(g.branch || 'main')}&t=${Date.now()}`, { headers: headers(g), cache: 'no-store' });
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error('Token do GitHub inválido ou expirado');
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
  return (await r.json()).sha;
}

export async function pushVault(g, vault) {
  const sha = await currentSha(g);
  const body = {
    message: `Atualiza dados (${new Date().toLocaleString('pt-BR')})`,
    content: utf8ToB64(JSON.stringify(vault)),
    branch: g.branch || 'main',
  };
  if (sha) body.sha = sha;
  const r = await fetch(api(g), { method: 'PUT', headers: headers(g, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 401) throw new Error('Token do GitHub inválido ou expirado');
    if (r.status === 403 || r.status === 404) throw new Error('Sem permissão de escrita no repositório (confira o token e o nome do repositório)');
    if (r.status === 409) throw new Error('Conflito de versão no GitHub — tente sincronizar novamente');
    throw new Error(`Falha ao enviar (${r.status}): ${t.slice(0, 120)}`);
  }
  return true;
}

export async function pullVault(g) {
  const r = await fetch(`${api(g)}?ref=${encodeURIComponent(g.branch || 'main')}&t=${Date.now()}`, {
    headers: headers(g, { Accept: 'application/vnd.github.raw+json' }),
    cache: 'no-store',
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
  return JSON.parse(await r.text());
}

export async function testConnection(g) {
  const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}`, { headers: headers(g) });
  if (r.status === 401) throw new Error('Token inválido');
  if (r.status === 404) throw new Error('Repositório não encontrado (ou o token não tem acesso a ele)');
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
  const j = await r.json();
  if (j.permissions && !j.permissions.push) throw new Error('O token não tem permissão de escrita (Contents: Read and write)');
  return j;
}
