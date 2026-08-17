# Ofertas ML — automação de divulgação de links de afiliado

Projeto **pessoal**. Fora da infra Ibiunet: repo em `~/pessoal/`, remoto no GitHub pessoal,
identidade git configurada com `--local` (a global é corporativa). Nada de Gitea, nada de
`whatsapp-api` da vm-apps-01.

Levantamento feito em 17/08/2026 direto no painel de afiliado logado.

---

## 1. O que foi verificado na prática

| # | Achado | Como foi verificado | Consequência |
|---|--------|---------------------|--------------|
| 1 | **API pública do ML fechou** | `GET /sites/MLB/search` → 403, `/items/<id>` → 403 (`PolicyAgent`), `/products/<id>` → 401 | Não dá pra fazer curadoria por API anônima. Fonte de dados passa a ser o hub logado |
| 2 | **O hub tem um endpoint de feed** | `POST /affiliate-program/api/hub/search?is_affiliate=true&device=desktop` → 200 | É a fonte boa: traz o dado que a API pública **nunca** teve — o percentual de comissão |
| 3 | **O feed traz tudo que interessa** | `polycard_client_model.polycards[]`, 18 por página. Cada item: `metadata.id`, `product_id`, `url`, `url_params`, `extra_commission`, `brand_commission`, + `affiliates_commission_chip`, preço e desconto nos components | Curadoria automatizável de ponta a ponta |
| 4 | **Filtros e ordenação do feed** | `filters`: `category`, `extra_commission`, `best_seller`. `available_sorts`: menor preço, maior preço (atual: mais relevantes) | Dá pra varrer por categoria e por comissão extra |
| 5 | **Gerador aceita lote** | `/afiliados/linkbuilder`: "Insira 1 ou mais URLs separados por 1 linha" + botão "Copiar todos" | Fallback viável e rápido pra dezenas de links |
| 6 | **Link é determinístico** | Gerei o mesmo produto 2×, mesma etiqueta → mesmo shortlink `meli.la/1YptXom` | Dá pra cachear: nunca gerar duas vezes o mesmo link |
| 7 | **`createLink` é protegido** | `POST /affiliate-program/api/v2/affiliates/createLink` dispara junto `browser-assessment` + reCAPTCHA Enterprise | **Não automatizar esse endpoint por HTTP.** Contornar antibot está fora de escopo |
| 8 | **O link do gerador NÃO é link de produto** | O oficial resolve para `/social/<etiqueta>?…&ref=<opaco>` = Perfil Social com o produto embutido | São dois produtos distintos: vitrine × link direto |
| 9 | **`ref` é opaco** | Base64 que não decodifica em texto, sem MLB em claro | Link de vitrine não é montável à mão |
| 10 | **Link direto montado à mão carrega** | `/p/MLB66686279?matt_word=<etiqueta>&matt_tool=48395341` abriu o produto com os params preservados | Atribuição **ainda não comprovada** — ver Fase 0 |
| 11 | **Existe métrica por etiqueta** | Métricas → aba "Etiquetas de rastreamento": Etiqueta · Cliques · Unidades vendidas · Taxa de conversão · Ganho estimado | É o instrumento de validação e de atribuição por canal |
| 12 | **Dado do painel indisponível hoje** | Aviso do próprio ML: dificuldades nos dados de 16/08 e 17/08; atualizado às 14h49 | O teste da Fase 0 só pode ser lido a partir de 18/08 |

---

## 2. Decisão de arquitetura

Três camadas. Duas são 100% automatizáveis hoje; uma depende do teste da Fase 0.

```
[1] Coletor  →  [2] Curadoria  →  [3] Link  →  [4] Aprovação  →  [5] Publicação  →  [6] Métricas
   hub/search     ranking          A ou B       você decide       TG / site / social   por etiqueta
   (browser)      (código)                      (bot Telegram)                          ↑
                                                                                        └── realimenta [2]
```

### [1] Coletor
Playwright com **perfil persistente** (`userDataDir`), headful, sessão logada reaproveitada.
Chama `hub/search` paginando e por categoria; normaliza para SQLite.

Por que browser e não HTTP puro com cookie: a sessão é protegida por fingerprint de
navegador. Rodar dentro do browser real é o caminho honesto — e é a sua própria conta,
lendo a sua própria vitrine.

Ritmo: 1–2 varreduras por dia, sequencial, sem paralelismo. Não é crawler de terceiros.

### [2] Curadoria
Score por oferta, em código puro:
- comissão efetiva em R$ (`% × preço final`) — não o percentual isolado, senão item de R$ 20 a 62% ganha de item de R$ 500 a 10%
- desconto **real** (histórico próprio de preço, ver Fase 2) — "60% OFF" sobre preço inflado é ruído
- reputação/volume de vendas
- penalidade por categoria repetida no mesmo dia (variedade no canal)
- cooldown: não republicar o mesmo produto em N dias

### [3] Geração do link — dois caminhos
- **Caminho A** (se a Fase 0 der positivo): montar `<url-do-produto>?matt_word=<etiqueta>&matt_tool=<id>`.
  100% automático, zero passo manual, link direto pro produto.
- **Caminho B** (fallback): abrir `/afiliados/linkbuilder` no mesmo browser da sessão, colar o
  lote de URLs, ler os links gerados. Semi-automático, mas em lote e **cacheável** (achado #6),
  então o custo marginal tende a zero com o tempo.

O código encapsula isso atrás de uma interface `LinkProvider` com as duas implementações —
trocar de B para A é mudar uma linha, sem tocar no resto.

### [4] Aprovação
Bot do Telegram te manda o card (foto, título, preço, desconto, comissão estimada em R$) com
botões **Aprovar / Rejeitar / Adiar**. Nada vai ao ar sem seu toque — foi o que você pediu.

### [5] Publicação
- **Telegram**: Bot API oficial, canal próprio. É o alvo primário — sem risco de ban por volume.
- **Site/feed**: página estática regenerada a cada rodada. Tráfego orgânico, custo zero.
- **Redes sociais**: fase 3, cada rede com sua regra de disclosure de publi.

**Uma etiqueta de rastreamento por canal** (`telegram`, `site`, `instagram`). O painel já
suporta gerenciar etiquetas, e a aba "Etiquetas de rastreamento" passa a dizer qual canal
converte de verdade.

### [6] Métricas
Ler a aba de etiquetas e gravar histórico. Fecha o ciclo: o score da camada [2] passa a
aprender com o que realmente vendeu, não com o que parecia bom.

---

## 3. Fases

### Fase 0 — Validar atribuição (bloqueia a escolha A × B)
1. A partir de 18/08, reler Métricas → Etiquetas de rastreamento.
2. Se a etiqueta registrou clique do link montado à mão → **Caminho A**, automação total.
3. Se não registrou → **Caminho B**, com o lote do linkbuilder.
4. Criar as etiquetas por canal.

Custo: ~15 min. **Nada mais deve ser decidido antes disso.**

### Fase 1 — MVP (Telegram + aprovação)
- Coletor Playwright + SQLite
- Score e fila
- `LinkProvider` (B primeiro, A se a Fase 0 liberar)
- Bot de aprovação + publicação no canal
- Meta: você aprova de 10 a 20 ofertas por dia em 5 minutos

### Fase 2 — Confiabilidade da oferta
- Histórico de preço próprio (mata o "desconto" falso)
- Revalidação de preço **imediatamente antes** de publicar — link com preço vencido queima audiência
- Expiração: comissão extra é temporária (achado do card "GANHOS EXTRAS"); registrar `visto_em` e vencer a oferta

### Fase 3 — Escala
- Site/feed público
- Redes sociais
- Relatório de performance por etiqueta realimentando o score

---

## 4. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Runtime | Node 20 + TypeScript | mesmo terreno que você já domina |
| Browser | Playwright, perfil persistente, headful | sessão logada estável |
| Dados | SQLite (`better-sqlite3`) | single-file, sem infra, roda no Mac |
| Bot | Telegram Bot API (`fetch` puro ou Telegraf) | oficial, sem risco de ban |
| Agendamento | `launchd` no Mac ou cron | sem servidor no MVP |

Sem Docker, sem VM, sem Postgres. Se um dia virar recorrente de verdade, migra — não antes.

---

## 5. Riscos e como tratar

| Risco | Gravidade | Tratamento |
|---|---|---|
| Automação em área logada vs. ToS do ML | Alta | Só a própria conta, ritmo humano, sequencial, volume baixo, **nunca** burlar captcha. `createLink` fica na UI |
| Endpoint interno mudar sem aviso | Média | É API não documentada. Isolar num único adapter; teste de contrato que falha alto |
| Comissão extra expirar antes do post | Média | `visto_em` + revalidação antes de publicar |
| Desconto falso (preço inflado antes) | Média | Histórico próprio de preço (Fase 2) |
| Canal virar spam e perder audiência | Alta | Aprovação manual + cooldown por produto + limite diário |
| Compra própria não gera ganho | Baixa | O painel avisa explicitamente; não testar conversão comprando |
| Métrica do painel instável | Baixa | Já aconteceu em 16–17/08. Guardar histórico próprio, não confiar em leitura única |

---

## 6. O que precisa de você

1. **Fase 0**: rodar a leitura em 18/08 (eu faço, com o navegador logado).
2. **Nome do repo** e criação no GitHub pessoal (não crio conta nem repo remoto por você).
3. **Canal do Telegram** criado + token do BotFather.
4. Decidir volume diário alvo do canal.

---

## 7. Estado

- [x] Levantamento técnico (17/08/2026)
- [ ] Fase 0 — validar atribuição (a partir de 18/08)
- [ ] Fase 1 — MVP
- [ ] Fase 2
- [ ] Fase 3

Nenhuma linha de código escrita até aqui — de propósito. O plano espera aprovação.
