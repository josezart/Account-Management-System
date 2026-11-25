# Gestão de Contas · CAE

Web app pessoal para acompanhamento de contas de software de simulação (Ansys / Synopsys).
Roda 100% no navegador e é hospedado de graça no GitHub Pages. Não há servidor nem banco de dados:
os dados ficam num **cofre criptografado** (`data/vault.json`) que só abre com a sua senha.

## O que tem

| Tela | Para quê |
|---|---|
| **Painel** | Atingimento da meta do trimestre (USD NTA), MRP, pré-pipeline, contas em risco, encontros executivos e prioridades sugeridas |
| **Minha semana** | Quadro de tarefas, % ligado a vendas, carga x capacidade, prioridades sugeridas e revisão semanal |
| **Contas** | Contas e subcontas (ex.: Marinha → CPSN, DDNM…), com saúde, próxima ação, MRP e pré-pipeline. Na ficha: **mapa da conta** (unidades, pessoas-chave, desafios, soluções Ansys, hipótese de valor, matriz unidade × domínio), pessoas & agenda executiva, licenças/MRP/vendas, pré-pipeline, histórico, técnico e briefing |
| **Pré-pipeline** | Tudo o que vem antes do Salesforce: hipóteses e whitespaces por estágio (Hipótese → Pronto para o Salesforce), MEDDIC, whitespace da carteira e atalhos de pesquisa |
| **Renovações & licenças** | MRP por trimestre fiscal (USD NTA), licenças do Ansys Licensing Portal e histórico de vendas NB/RR |
| **Técnico** | Atividades técnicas, Tech Pool / Temp Keys e treinamentos (ALH) |
| **Planejamento** | Ano → trimestre → mês: meta editável (Renewals e New Business), agenda executiva (8 Pillars), objetivos e notas |
| **Registro rápido** | Registra reunião/visita, cria o follow-up e gera o texto para o Salesforce |

## Atualizar uma versão já publicada

1. Envie os arquivos novos por *Add file → Upload files* (o GitHub substitui os de mesmo nome). A pasta `data/` não está no pacote, então seus dados no repositório não são tocados.
2. Aguarde 1–2 minutos e recarregue o site com **Ctrl+F5**.
3. Se recebeu uma base nova (`dados-v2.json`): *Configurações → Dados / importação → Importar JSON* no modo **Substituir tudo**. O token do GitHub é mantido.

## Publicar no GitHub (uma vez, ~10 minutos)

1. **Crie um repositório** em github.com → *New repository* (ex.: `gestao-contas`).
   O GitHub Pages gratuito exige repositório **público** — tudo bem: o código não tem nada sensível e os dados vão criptografados.
2. **Envie os arquivos**: no repositório, *Add file → Upload files* e arraste **o conteúdo** desta pasta
   (`index.html`, `css/`, `js/`, `vendor/`, `tools/`, `README.md`, `.nojekyll`, `.gitignore`). *Commit changes*.
3. **Ative o Pages**: *Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save*.
   Em 1–2 minutos o site fica em `https://SEU-USUARIO.github.io/gestao-contas/`.
4. **Primeiro acesso**: abra o endereço, crie uma senha forte (mín. 10 caracteres) e, em *Dados iniciais*, escolha o arquivo
   `dados-iniciais.json` (enviado separadamente — **não** suba esse arquivo para o GitHub, ele não é criptografado).
5. **Crie um token** para o app salvar no repositório: GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*
   - *Repository access*: **Only select repositories** → o repositório do app
   - *Permissions → Repository permissions → Contents*: **Read and write**
   - Expiração: 1 ano (anote para renovar)
6. No app: **Configurações → Sincronização GitHub** → preencha usuário, repositório e token → *Salvar e testar* → *Enviar agora*.
   A partir daí, cada alteração é enviada sozinha (o indicador no canto inferior esquerdo mostra o status).
7. Apague o `dados-iniciais.json` do seu computador.

Em outro dispositivo, é só abrir o endereço e entrar com a mesma senha.

## Atualizações em lote (planilhas) com o Claude

1. *Configurações → Dados → Exportar backup (.json)*.
2. Envie o backup + a planilha (ex.: histórico de vendas) ao Claude e peça a atualização.
3. Importe o arquivo devolvido em *Importar JSON* no modo **Mesclar**.

Também dá para importar CSV direto (*Importar planilha (CSV)*) — baixe o modelo para ver as colunas.
O backup nunca contém o token do GitHub.

## Segurança

- AES-256-GCM com chave derivada da senha (PBKDF2-SHA256, 310 mil iterações). Sem a senha, o `vault.json` é ilegível.
- **A senha não pode ser recuperada.** Guarde-a num gerenciador de senhas e mantenha um backup exportado.
- Bloqueio automático após 30 min sem uso (ajustável).
- O site tem `noindex`, mas o endereço é público — a proteção real é a criptografia.

## Linha de comando (opcional)

```bash
node tools/vault.mjs decrypt data/vault.json backup.json   # pede a senha
node tools/vault.mjs encrypt backup.json data/vault.json
```
