# Gestão de Contas · CAE

Web app pessoal para acompanhamento de contas de software de simulação (Ansys / Synopsys).
Roda 100% no navegador e é hospedado de graça no GitHub Pages. Não há servidor nem banco de dados:
os dados ficam num **cofre criptografado** (`data/vault.json`) que só abre com a sua senha.

## O que tem

| Tela | Para quê |
|---|---|
| **Painel** | KPIs da carteira, prioridades sugeridas, contas em risco, renovações, follow-ups, qualidade dos dados |
| **Minha semana** | Quadro de tarefas, % de tarefas ligadas a vendas, carga x capacidade, meta de prospecção, prioridades sugeridas automaticamente e checklist da revisão semanal |
| **Contas** | Lista com saúde, último contato, próxima ação e renovação; ficha da conta com resumo, contatos (organograma + engajamento), licenças, comercial (MEDDIC), histórico, técnico, treinamentos, whitespace e **briefing** pronto para reunião |
| **Comercial** | Pipeline por estágio, lista de oportunidades e histórico de vendas por ano fiscal |
| **Licenças** | Parque, calendário de renovações, TECS expirado |
| **Técnico** | Atividades técnicas (PoC, apresentações, sessões, visitas…) com métricas, Tech Pool / Temp Keys e treinamentos |
| **Prospecção** | Funil fora→dentro / dentro→fora, mapa de whitespace (contas × famílias de produto) e atalhos de pesquisa por conta |
| **Planejamento** | Objetivos anuais → trimestrais → mensais (ano fiscal terminando em outubro), com métricas automáticas do período |
| **Mapa** | Contas no mapa, coloridas pela saúde |
| **Registro rápido** | Registra uma reunião/visita em 1 minuto, cria a tarefa de follow-up, a atividade técnica e gera o texto pronto para colar no Salesforce |

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
