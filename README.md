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
npm test            # 49 testes
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
test/              49 testes + fixture capturada do feed real
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
