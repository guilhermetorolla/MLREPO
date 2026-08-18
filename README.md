# ofertas-ml

Curadoria e divulgação de ofertas de afiliado do Mercado Livre, com **aprovação manual**
antes de qualquer publicação.

Projeto pessoal. Roda no Mac, sem servidor, sem Docker. Ver [PLANO.md](./PLANO.md) para o
levantamento técnico e as decisões.

---

## Como funciona

```
coletar  →  ranquear  →  gerar link  →  VOCÊ aprova  →  publica no canal
 (hub)      (score)      (2 caminhos)    (Telegram)      (Telegram)
```

O ponto central do ranking: **a comissão é medida em reais, não em percentual.**
Do feed real, 17/08/2026:

```
scooter     16% de R$ 8.399  =  R$ 1.343,84   ← vence
compressor  62% de R$    66  =  R$    40,92
```

Ordenar por percentual escolhe o item errado.

## Instalação

```bash
npm install
npx playwright install chromium
cp env.exemplo .env      # preencha o .env
```

Na primeira execução o navegador abre visível para você fazer login no Mercado Livre.
A sessão fica em `.browser-profile/` (fora do git — **contém acesso à sua conta**).

## Uso

```bash
npm run coletar     # lê o feed do hub e salva em data/ofertas.db
npm run fila        # mostra o ranking no terminal, sem publicar nada
npm run bot         # manda as ofertas para você aprovar no Telegram
npm run site        # gera docs/index.html e docs/feed.json
npm run motor -- --simular   # mostra o que publicaria, sem enviar nada
npm run motor       # publica de verdade nos destinos liberados pela agenda
npm run painel      # painel web em http://localhost:4477
npm test            # 97 testes
```

## Decisões que valem saber

**Geração de link tem dois caminhos** (`src/link/`):

- `linkbuilder` (padrão) — usa o gerador oficial do painel, em lote. Os links são
  determinísticos por (produto, etiqueta), então ficam em cache e nunca são gerados
  duas vezes.
- `montado` — monta `?matt_word=<etiqueta>&matt_tool=<id>` na URL do produto. 100%
  automático, **mas a atribuição ainda não foi comprovada** (Fase 0 do PLANO.md).

**Uma etiqueta por canal.** É o que faz a aba "Etiquetas de rastreamento" do painel dizer
qual canal converte, em vez de um número agregado inútil.

**O parser é o ponto frágil** (`src/parser.ts`). A API do hub é interna e não documentada.
Todo conhecimento do formato está nesse arquivo, com teste de contrato que falha alto se o
ML mudar a estrutura — em vez de devolver lista vazia em silêncio.

**O que este projeto não faz:** não chama `createLink` por HTTP (é protegido por reCAPTCHA
Enterprise e browser-assessment), não paraleliza requisições, não dispara para quem não
pediu, e não publica nada sem aprovação.

## Estrutura

```
src/
  parser.ts        traduz o feed do hub → Oferta       (frágil: API interna)
  score.ts         ranking por ganho em reais
  coletor.ts       Playwright com sessão persistente
  db.ts            SQLite: ofertas, histórico de preço, links, publicações
  telegram.ts      aprovação e publicação
  site/            página estática na identidade visual do ML + feed.json
  link/            os dois caminhos de geração de link
  motor/           agenda por destino + régua de corte
  cli/             coletar · fila · bot · site · motor
test/              97 testes + fixture capturada do feed real
```

## O site

`npm run site` gera `docs/index.html` e `docs/feed.json` a partir do banco.

Visual na linguagem do Mercado Livre — amarelo `#FFE600` na barra, azul `#3483FA` na ação,
verde `#00A650` no desconto, cards brancos sobre `#EBEBEB` — porque quem chega já sabe ler
esse padrão. Sem logo do ML e sem nome que sugira relação oficial: o rodapé diz que é site
independente e que os links são de afiliado.

O que a página tem que uma vitrine comum não tem é a **conferência de preço**: cada card
mostra onde o preço de hoje cai entre o menor e o maior que já registramos, e o parecer
correspondente. Com menos de duas leituras ela diz "primeira leitura deste preço" em vez de
desenhar uma régua sem lastro.

Detalhes que custaram bug e viraram teste: preço acima de mil precisa de separador
(`R$ 8.399,00`), e o desconto **trunca** em vez de arredondar — 199,90 → 78,90 dá 60,53%, e o
ML exibe 60%; arredondar mostraria 61% e o visitante veria dois números para a mesma oferta.

## O motor de publicação

`npm run motor` faz **uma rodada**: olha cada destino e publica no máximo uma oferta em cada
um que a agenda liberar. Quem controla o ritmo é a janela de cada destino, não a frequência
da chamada — rodar de mais não publica de mais.

Agende no macOS com `launchd` (ou `cron`) a cada 15 minutos:

```
*/15 * * * * cd ~/pessoal/ofertas-ml && /usr/local/bin/npm run motor >> motor.log 2>&1
```

**Destinos** ficam em `destinos.json` (fora do git — tem id de grupo privado). Copie de
`destinos.exemplo.json`. Cada destino tem janelas de horário, teto diário e intervalo mínimo
entre posts. Configuração torta faz o motor recusar subir, em vez de publicar na hora errada.

**Régua de corte**: só vai ao ar sozinho o que passa em ganho mínimo, nota, volume de vendas
e teto de preço. Na prática, com os dados reais de 17/08, isso reprovou a scooter de
R$ 1.343,84 de comissão — que lidera o ranking mas não tem nota nem vendas registradas.

O motor **sempre diz por que não publicou**. "Nenhuma oferta passou no corte" vem acompanhado
do motivo do primeiro item da fila; "fora da janela" informa a que horas abre. Motor automático
que fica em silêncio é motor que ninguém consegue depurar.

Use `--simular` para ver a decisão sem enviar nada.

### Limites que o motor respeita

Um bot do Telegram só publica onde foi adicionado por um administrador — não existe caminho de
disparo em massa não consentido, e o projeto não tenta abrir um. O teto diário e o intervalo
mínimo por destino existem para não cansar a audiência nem tomar restrição da plataforma.

### O que o motor ainda NÃO faz

Não revalida o preço no instante do envio. Se o preço mudou entre a coleta e a publicação, o
anúncio sai com valor vencido. É o item pendente da Fase 2 e o erro que mais destrói confiança
em grupo de oferta.

## O painel

`npm run painel` sobe um Fastify local com quatro telas: **Fila** (aprovar, descartar,
programar), **Programados**, **Destinos** (CRUD, sem editar JSON na mão) e **Motor**
(situação de cada destino agora e histórico do que saiu).

Acesso pela tailnet: `http://mac-mini-de-guilherme:4477`.

**Token obrigatório.** Sua tailnet tem máquinas de outras pessoas; sem autenticação
qualquer uma delas dispararia post em nome do seu afiliado. Gere com
`openssl rand -hex 16` e ponha em `PAINEL_TOKEN` no `.env` — o servidor se recusa a subir
sem ele. O token vai em header `x-painel-token`, guardado no localStorage do navegador,
nunca na URL.

O `preHandler` de autenticação é `async` explícito: em Fastify v4+, hook não-async é tratado
como assinatura legada e a rota fica pendurada para sempre, sem erro e sem timeout.

### Como o motor mudou

Uma rodada agora tem duas fases:

1. **agendamentos vencidos** — você marcou a hora, então ignoram a régua de corte. Respeitam
   só o intervalo mínimo do destino, para dois posts não saírem colados.
2. **grade automática** — janela + limite + corte, um post por destino livre.

Ofertas **rejeitadas** no painel saem da fila; **aprovadas** têm preferência sobre as que
apenas passaram no corte.

Destinos passaram a viver no banco (editáveis pela tela). O `destinos.json` continua servindo
de semente na primeira execução.

## Automações

Uma **automação** decide *quando* enviar e *o que* enviar; o **destino** decide *para onde* e
guarda o teto de proteção do grupo. Separar os dois permite ter "Eletrônicos de manhã" e
"Moda à noite" apontando para os mesmos grupos com regras diferentes — e o grupo continua
protegido por limite próprio, não importa quantas automações mirem nele.

Cada automação tem:

- **dias da semana** (vazio = todos), **janelas** de horário, **intervalo** entre execuções e
  **teto diário** próprio
- **filtro de conteúdo**: ganho mínimo em reais, nota, volume de vendas, faixa de preço,
  somente comissão extra, e palavras-chave para incluir ou excluir pelo título

A tela mostra, para cada automação, **quantas ofertas da base passam no filtro dela agora** —
é o número que revela filtro apertado demais.

O motor roda em duas fases: agendamentos manuais primeiro (ignoram o filtro, respeitam o
intervalo do destino), depois cada automação liberada pela sua própria agenda.

## O painel

Navegação lateral com Início, Fila, Automações, Destinos, Programados, Motor e Eventos.

A tela **Início** é um checklist do que falta para o motor rodar sozinho (ofertas, links,
destino, automação, Telegram), com botão de resolver em cada passo pendente, mais as métricas
do dia.

## Multi-marketplace

Cada marketplace implementa duas interfaces em `src/fontes/`:

- `FonteDeOfertas` — de onde vêm os produtos
- `ProvedorDeLink` — como nasce o link de afiliado

Por baixo eles são muito diferentes, e é exatamente por isso que existe a abstração:

| Marketplace | Ofertas | Link de afiliado |
|---|---|---|
| Mercado Livre | endpoint interno do hub, exige sessão de navegador | gerador do painel (lote) ou link montado |
| Shopee | **API oficial** GraphQL + HMAC-SHA256 | **API oficial**, `generateShortLink` |
| Amazon | PA-API (ainda não implementada) | PA-API |

A Shopee é o caso fácil: link gerado por API, sem navegador, sem captcha, sem lote manual.
O Mercado Livre é o difícil. Isso inverte a intuição de quem começa pelo ML.

**Identidade das ofertas:** com mais de um marketplace o id nativo deixa de ser único, então
a chave é `<marketplace>:<id>` (`ml:MLB123`, `shopee:456`). Registros anteriores ao prefixo
são migrados automaticamente na abertura do banco, em todas as tabelas que referenciam
`item_id`.

**Falha isolada:** fonte sem credencial é pulada com aviso e não derruba a coleta das outras.
`npm run coletar --fonte=shopee` limita a uma fonte.
