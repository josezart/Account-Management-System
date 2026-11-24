#!/usr/bin/env node
// Ferramenta de linha de comando para o cofre de dados.
//   node tools/vault.mjs decrypt data/vault.json backup.json   (pede a senha)
//   node tools/vault.mjs encrypt backup.json data/vault.json   (pede a senha)
// A senha também pode vir da variável de ambiente VAULT_PASSWORD.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { encryptVault, decryptWithPassword, deriveKeyCtx } from '../js/crypto.js';

const [cmd, input, output] = process.argv.slice(2);
if (!['encrypt', 'decrypt'].includes(cmd) || !input || !output) {
  console.log('Uso: node tools/vault.mjs <encrypt|decrypt> <entrada> <saída>');
  process.exit(1);
}
const ask = (q) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});
const password = process.env.VAULT_PASSWORD || (await ask('Senha: '));
const src = JSON.parse(readFileSync(input, 'utf8'));
if (cmd === 'decrypt') {
  const { data } = await decryptWithPassword(src, password);
  writeFileSync(output, JSON.stringify(data, null, 2));
  console.log('Descriptografado em', output);
} else {
  src.meta = { ...(src.meta || {}), updatedAt: new Date().toISOString() };
  const vault = await encryptVault(src, await deriveKeyCtx(password));
  writeFileSync(output, JSON.stringify(vault));
  console.log('Criptografado em', output);
}
