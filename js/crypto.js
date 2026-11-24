// Criptografia do cofre de dados (AES-GCM 256 com chave derivada da senha via PBKDF2-SHA256).
// Funciona no navegador e no Node 20+ (tools/vault.mjs reutiliza este arquivo).
const te = new TextEncoder();
const td = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const DEFAULT_ITERATIONS = 310000;
export const FORMAT = 'cae-accounts-vault';

export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBuf(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function randomB64(n) {
  return bufToB64(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

// Retorna { raw (base64 da chave), salt, iterations }
export async function deriveKeyCtx(password, salt = randomB64(16), iterations = DEFAULT_ITERATIONS) {
  const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', salt: b64ToBuf(salt), iterations, hash: 'SHA-256' }, base, 256);
  return { raw: bufToB64(bits), salt, iterations };
}

async function aesKey(raw) {
  return subtle.importKey('raw', b64ToBuf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptVault(obj, keyCtx) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(keyCtx.raw);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return {
    format: FORMAT,
    v: 1,
    kdf: { alg: 'PBKDF2-SHA256', iterations: keyCtx.iterations, salt: keyCtx.salt },
    iv: bufToB64(iv),
    ct: bufToB64(ct),
    updatedAt: (obj.meta && obj.meta.updatedAt) || new Date().toISOString(),
  };
}

// Descriptografa com senha (deriva a chave a partir do salt do próprio cofre).
export async function decryptWithPassword(vault, password) {
  const keyCtx = await deriveKeyCtx(password, vault.kdf.salt, vault.kdf.iterations);
  const data = await decryptWithKey(vault, keyCtx);
  return { data, keyCtx };
}

export async function decryptWithKey(vault, keyCtx) {
  if (!vault || vault.format !== FORMAT) throw new Error('Arquivo de dados inválido');
  if (vault.kdf.salt !== keyCtx.salt) throw new Error('Chave não corresponde a este cofre');
  const key = await aesKey(keyCtx.raw);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(vault.iv) }, key, b64ToBuf(vault.ct));
  return JSON.parse(td.decode(pt));
}
