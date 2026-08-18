import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HistoricoPreco, Oferta } from './tipos.ts'

export const CAMINHO_PADRAO = new URL('../data/ofertas.db', import.meta.url).pathname

export function abrir(caminho = CAMINHO_PADRAO): Database.Database {
  mkdirSync(dirname(caminho), { recursive: true })
  const db = new Database(caminho)
  db.pragma('journal_mode = WAL')
  migrar(db)
  return db
}

function migrar(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ofertas (
      item_id        TEXT PRIMARY KEY,
      product_id     TEXT,
      titulo         TEXT NOT NULL,
      url            TEXT NOT NULL,
      preco_atual    REAL NOT NULL,
      preco_anterior REAL,
      comissao_pct   REAL NOT NULL,
      comissao_extra INTEGER NOT NULL DEFAULT 0,
      vendas         INTEGER,
      rating         REAL,
      categoria      TEXT,
      imagem_id      TEXT,
      visto_em       TEXT NOT NULL
    );

    -- Histórico próprio de preço. É o que permite distinguir desconto real
    -- de preço inflado antes da "promoção".
    CREATE TABLE IF NOT EXISTS precos (
      item_id  TEXT NOT NULL,
      preco    REAL NOT NULL,
      visto_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_precos_item ON precos(item_id);

    -- Links de afiliado já gerados. São determinísticos por (item, etiqueta),
    -- então nunca geramos o mesmo link duas vezes.
    CREATE TABLE IF NOT EXISTS links (
      item_id    TEXT NOT NULL,
      etiqueta   TEXT NOT NULL,
      url        TEXT NOT NULL,
      criado_em  TEXT NOT NULL,
      PRIMARY KEY (item_id, etiqueta)
    );

    -- Sua decisão sobre cada oferta, tomada no painel.
    CREATE TABLE IF NOT EXISTS decisoes (
      item_id     TEXT PRIMARY KEY,
      estado      TEXT NOT NULL CHECK (estado IN ('aprovado','rejeitado','adiado')),
      adiado_ate  TEXT,
      decidido_em TEXT NOT NULL
    );

    -- Post marcado para um horário específico. Tem precedência sobre a grade
    -- automática: se você marcou a hora, você quis.
    CREATE TABLE IF NOT EXISTS agendamentos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id      TEXT NOT NULL,
      destino_id   TEXT NOT NULL,
      quando       TEXT NOT NULL,
      estado       TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (estado IN ('pendente','publicado','cancelado','falhou')),
      erro         TEXT,
      criado_em    TEXT NOT NULL,
      publicado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agend_pendente ON agendamentos(estado, quando);

    -- Destinos vivem no banco para poderem ser editados pelo painel.
    -- O destinos.json continua servindo como semente na primeira execução.
    CREATE TABLE IF NOT EXISTS destinos (
      id                TEXT PRIMARY KEY,
      chat_id           TEXT NOT NULL,
      nome              TEXT NOT NULL,
      janelas           TEXT NOT NULL,
      limite_diario     INTEGER NOT NULL,
      intervalo_minutos INTEGER NOT NULL,
      ativo             INTEGER NOT NULL DEFAULT 1
    );

    -- Automação: quando enviar e o que enviar. O destino continua guardando
    -- o teto de proteção do grupo, para não depender de quantas automações
    -- mirem nele.
    CREATE TABLE IF NOT EXISTS automacoes (
      id                TEXT PRIMARY KEY,
      nome              TEXT NOT NULL,
      descricao         TEXT,
      ativa             INTEGER NOT NULL DEFAULT 1,
      dias_semana       TEXT NOT NULL DEFAULT '[]',
      janelas           TEXT NOT NULL DEFAULT '[]',
      intervalo_minutos INTEGER NOT NULL DEFAULT 60,
      limite_diario     INTEGER NOT NULL DEFAULT 10,
      filtro            TEXT NOT NULL DEFAULT '{}',
      criado_em         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automacao_destinos (
      automacao_id TEXT NOT NULL,
      destino_id   TEXT NOT NULL,
      PRIMARY KEY (automacao_id, destino_id)
    );

    -- Diário do motor: o que deu certo e o que falhou, com o erro cru.
    -- Sem isso o motor automático pode passar dias quebrado em silêncio.
    CREATE TABLE IF NOT EXISTS eventos (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      quando    TEXT NOT NULL,
      nivel     TEXT NOT NULL CHECK (nivel IN ('info','erro')),
      origem    TEXT NOT NULL,
      mensagem  TEXT NOT NULL,
      detalhe   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_eventos_quando ON eventos(quando DESC);

    CREATE TABLE IF NOT EXISTS publicacoes (
      item_id       TEXT NOT NULL,
      canal         TEXT NOT NULL,
      publicado_em  TEXT NOT NULL,
      preco_na_hora REAL NOT NULL,
      PRIMARY KEY (item_id, canal, publicado_em)
    );
    CREATE INDEX IF NOT EXISTS idx_pub_item ON publicacoes(item_id);
  `)

  // Bancos criados antes de a foto existir: adiciona a coluna sem perder dados.
  const colunas = (db.prepare('PRAGMA table_info(ofertas)').all() as { name: string }[]).map((c) => c.name)
  if (!colunas.includes('imagem_id')) {
    db.exec('ALTER TABLE ofertas ADD COLUMN imagem_id TEXT')
  }

  const colPub = (db.prepare('PRAGMA table_info(publicacoes)').all() as { name: string }[]).map((c) => c.name)
  if (!colPub.includes('automacao_id')) {
    db.exec('ALTER TABLE publicacoes ADD COLUMN automacao_id TEXT')
  }
}

export function salvarOfertas(db: Database.Database, ofertas: Oferta[]): void {
  const upsert = db.prepare(`
    INSERT INTO ofertas (item_id, product_id, titulo, url, preco_atual, preco_anterior,
                         comissao_pct, comissao_extra, vendas, rating, categoria, imagem_id, visto_em)
    VALUES (@itemId, @productId, @titulo, @url, @precoAtual, @precoAnterior,
            @comissaoPct, @comissaoExtra, @vendas, @rating, @categoria, @imagemId, @vistoEm)
    ON CONFLICT(item_id) DO UPDATE SET
      preco_atual = excluded.preco_atual, preco_anterior = excluded.preco_anterior,
      comissao_pct = excluded.comissao_pct, comissao_extra = excluded.comissao_extra,
      vendas = excluded.vendas, rating = excluded.rating, imagem_id = excluded.imagem_id,
      visto_em = excluded.visto_em
  `)
  const preco = db.prepare('INSERT INTO precos (item_id, preco, visto_em) VALUES (?, ?, ?)')

  db.transaction((lista: Oferta[]) => {
    for (const o of lista) {
      upsert.run({
        itemId: o.itemId,
        productId: o.productId ?? null,
        titulo: o.titulo,
        url: o.url,
        precoAtual: o.precoAtual,
        precoAnterior: o.precoAnterior ?? null,
        comissaoPct: o.comissaoPct,
        comissaoExtra: o.comissaoExtra ? 1 : 0,
        vendas: o.vendas ?? null,
        rating: o.rating ?? null,
        categoria: o.categoria ?? null,
        imagemId: o.imagemId ?? null,
        vistoEm: o.vistoEm,
      })
      preco.run(o.itemId, o.precoAtual, o.vistoEm)
    }
  })(ofertas)
}

export function historicos(db: Database.Database): Map<string, HistoricoPreco> {
  const linhas = db
    .prepare(
      `SELECT item_id AS itemId, MIN(preco) AS menorPreco, COUNT(*) AS amostras,
              MIN(visto_em) AS menorPrecoEm
       FROM precos GROUP BY item_id`,
    )
    .all() as HistoricoPreco[]
  return new Map(linhas.map((h) => [h.itemId, h]))
}

/**
 * Menor e maior preço já observados por item — é o que sustenta a régua do site.
 * Sem duas leituras não há auditoria possível, e a página diz isso em vez de fingir.
 */
export function faixasPreco(db: Database.Database): Map<string, { min: number; max: number; amostras: number }> {
  const linhas = db
    .prepare(
      `SELECT item_id AS itemId, MIN(preco) AS min, MAX(preco) AS max, COUNT(*) AS amostras
       FROM precos GROUP BY item_id`,
    )
    .all() as { itemId: string; min: number; max: number; amostras: number }[]
  return new Map(linhas.map((l) => [l.itemId, { min: l.min, max: l.max, amostras: l.amostras }]))
}

/** Itens publicados nos últimos N dias — entram em cooldown. */
export function publicadosRecentemente(db: Database.Database, dias = 14): Set<string> {
  const corte = new Date(Date.now() - dias * 86_400_000).toISOString()
  const linhas = db
    .prepare('SELECT DISTINCT item_id AS itemId FROM publicacoes WHERE publicado_em >= ?')
    .all(corte) as { itemId: string }[]
  return new Set(linhas.map((l) => l.itemId))
}

/**
 * Publicações recentes, no formato que o motor usa para decidir a agenda.
 * A coluna `canal` guarda o id do destino.
 */
export function publicacoesRecentes(
  db: Database.Database,
  dias = 30,
): { itemId: string; destinoId: string; publicadoEm: string }[] {
  const corte = new Date(Date.now() - dias * 86_400_000).toISOString()
  return db
    .prepare(
      `SELECT item_id AS itemId, canal AS destinoId, publicado_em AS publicadoEm
       FROM publicacoes WHERE publicado_em >= ? ORDER BY publicado_em DESC`,
    )
    .all(corte) as { itemId: string; destinoId: string; publicadoEm: string }[]
}

/** Itens já publicados NESTE destino — não repetir no mesmo grupo. */
export function publicadosNoDestino(
  db: Database.Database,
  destinoId: string,
  dias = 30,
): Set<string> {
  const corte = new Date(Date.now() - dias * 86_400_000).toISOString()
  const linhas = db
    .prepare('SELECT DISTINCT item_id AS itemId FROM publicacoes WHERE canal = ? AND publicado_em >= ?')
    .all(destinoId, corte) as { itemId: string }[]
  return new Set(linhas.map((l) => l.itemId))
}

export function linkSalvo(db: Database.Database, itemId: string, etiqueta: string): string | undefined {
  const l = db
    .prepare('SELECT url FROM links WHERE item_id = ? AND etiqueta = ?')
    .get(itemId, etiqueta) as { url: string } | undefined
  return l?.url
}

export function salvarLink(db: Database.Database, itemId: string, etiqueta: string, url: string): void {
  db.prepare(
    `INSERT INTO links (item_id, etiqueta, url, criado_em) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id, etiqueta) DO UPDATE SET url = excluded.url`,
  ).run(itemId, etiqueta, url, new Date().toISOString())
}

export function registrarPublicacao(
  db: Database.Database,
  itemId: string,
  canal: string,
  precoNaHora: number,
  automacaoId?: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO publicacoes (item_id, canal, publicado_em, preco_na_hora, automacao_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(itemId, canal, new Date().toISOString(), precoNaHora, automacaoId ?? null)
}

export function ofertasSalvas(db: Database.Database): Oferta[] {
  const linhas = db
    .prepare(
      `SELECT item_id AS itemId, product_id AS productId, titulo, url,
              preco_atual AS precoAtual, preco_anterior AS precoAnterior,
              comissao_pct AS comissaoPct, comissao_extra AS comissaoExtra,
              vendas, rating, categoria, imagem_id AS imagemId, visto_em AS vistoEm
       FROM ofertas`,
    )
    .all() as any[]
  return linhas.map((l) => ({
    ...l,
    comissaoExtra: Boolean(l.comissaoExtra),
    productId: l.productId ?? undefined,
    precoAnterior: l.precoAnterior ?? undefined,
    vendas: l.vendas ?? undefined,
    rating: l.rating ?? undefined,
    categoria: l.categoria ?? undefined,
    imagemId: l.imagemId ?? undefined,
  }))
}

// ─── Decisões (aprovação no painel) ──────────────────────────────

export type EstadoDecisao = 'aprovado' | 'rejeitado' | 'adiado'

export interface Decisao {
  itemId: string
  estado: EstadoDecisao
  adiadoAte?: string
  decididoEm: string
}

export function salvarDecisao(
  db: Database.Database,
  itemId: string,
  estado: EstadoDecisao,
  adiadoAte?: string,
): void {
  db.prepare(
    `INSERT INTO decisoes (item_id, estado, adiado_ate, decidido_em) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       estado = excluded.estado, adiado_ate = excluded.adiado_ate, decidido_em = excluded.decidido_em`,
  ).run(itemId, estado, adiadoAte ?? null, new Date().toISOString())
}

export function decisoes(db: Database.Database): Map<string, Decisao> {
  const linhas = db
    .prepare(
      'SELECT item_id AS itemId, estado, adiado_ate AS adiadoAte, decidido_em AS decididoEm FROM decisoes',
    )
    .all() as Decisao[]
  return new Map(linhas.map((d) => [d.itemId, d]))
}

// ─── Agendamentos ────────────────────────────────────────────────

export interface Agendamento {
  id: number
  itemId: string
  destinoId: string
  quando: string
  estado: 'pendente' | 'publicado' | 'cancelado' | 'falhou'
  erro?: string
  criadoEm: string
  publicadoEm?: string
}

export function agendar(
  db: Database.Database,
  itemId: string,
  destinoId: string,
  quando: string,
): number {
  const r = db
    .prepare(
      'INSERT INTO agendamentos (item_id, destino_id, quando, criado_em) VALUES (?, ?, ?, ?)',
    )
    .run(itemId, destinoId, quando, new Date().toISOString())
  return Number(r.lastInsertRowid)
}

export function agendamentos(db: Database.Database, estado?: string): Agendamento[] {
  const sql = `SELECT id, item_id AS itemId, destino_id AS destinoId, quando, estado, erro,
                      criado_em AS criadoEm, publicado_em AS publicadoEm
               FROM agendamentos ${estado ? 'WHERE estado = ?' : ''} ORDER BY quando`
  return (estado ? db.prepare(sql).all(estado) : db.prepare(sql).all()) as Agendamento[]
}

/** Agendamentos cuja hora já chegou e que ainda não foram publicados. */
export function agendamentosVencidos(db: Database.Database, agora: Date): Agendamento[] {
  return db
    .prepare(
      `SELECT id, item_id AS itemId, destino_id AS destinoId, quando, estado, erro,
              criado_em AS criadoEm, publicado_em AS publicadoEm
       FROM agendamentos WHERE estado = 'pendente' AND quando <= ? ORDER BY quando`,
    )
    .all(agora.toISOString()) as Agendamento[]
}

export function marcarAgendamento(
  db: Database.Database,
  id: number,
  estado: Agendamento['estado'],
  erro?: string,
): void {
  db.prepare('UPDATE agendamentos SET estado = ?, erro = ?, publicado_em = ? WHERE id = ?').run(
    estado,
    erro ?? null,
    estado === 'publicado' ? new Date().toISOString() : null,
    id,
  )
}

// ─── Destinos ────────────────────────────────────────────────────

export interface DestinoLinha {
  id: string
  chatId: string
  nome: string
  janelas: string[]
  limiteDiario: number
  intervaloMinutos: number
  ativo: boolean
}

export function destinos(db: Database.Database): DestinoLinha[] {
  const linhas = db
    .prepare(
      `SELECT id, chat_id AS chatId, nome, janelas, limite_diario AS limiteDiario,
              intervalo_minutos AS intervaloMinutos, ativo FROM destinos ORDER BY nome`,
    )
    .all() as (Omit<DestinoLinha, 'janelas' | 'ativo'> & { janelas: string; ativo: number })[]
  return linhas.map((l) => ({ ...l, janelas: JSON.parse(l.janelas), ativo: Boolean(l.ativo) }))
}

export function salvarDestino(db: Database.Database, d: DestinoLinha): void {
  db.prepare(
    `INSERT INTO destinos (id, chat_id, nome, janelas, limite_diario, intervalo_minutos, ativo)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       chat_id = excluded.chat_id, nome = excluded.nome, janelas = excluded.janelas,
       limite_diario = excluded.limite_diario, intervalo_minutos = excluded.intervalo_minutos,
       ativo = excluded.ativo`,
  ).run(
    d.id,
    d.chatId,
    d.nome,
    JSON.stringify(d.janelas),
    d.limiteDiario,
    d.intervaloMinutos,
    d.ativo ? 1 : 0,
  )
}

export function apagarDestino(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM destinos WHERE id = ?').run(id)
}

// ─── Eventos (diário do motor) ───────────────────────────────────

export interface Evento {
  id: number
  quando: string
  nivel: 'info' | 'erro'
  origem: string
  mensagem: string
  detalhe?: string
}

export function registrarEvento(
  db: Database.Database,
  nivel: 'info' | 'erro',
  origem: string,
  mensagem: string,
  detalhe?: string,
): void {
  db.prepare(
    'INSERT INTO eventos (quando, nivel, origem, mensagem, detalhe) VALUES (?, ?, ?, ?, ?)',
  ).run(new Date().toISOString(), nivel, origem, mensagem, detalhe ?? null)
}

export function eventos(db: Database.Database, limite = 60): Evento[] {
  return db
    .prepare('SELECT id, quando, nivel, origem, mensagem, detalhe FROM eventos ORDER BY id DESC LIMIT ?')
    .all(limite) as Evento[]
}

export function contarErrosRecentes(db: Database.Database, horas = 24): number {
  const corte = new Date(Date.now() - horas * 3_600_000).toISOString()
  const r = db
    .prepare("SELECT COUNT(*) AS c FROM eventos WHERE nivel = 'erro' AND quando >= ?")
    .get(corte) as { c: number }
  return r.c
}

/** Oferta única por id, para telas que só têm o itemId em mãos. */
export function ofertaPorId(db: Database.Database, itemId: string): Oferta | undefined {
  const l = db
    .prepare(
      `SELECT item_id AS itemId, product_id AS productId, titulo, url,
              preco_atual AS precoAtual, preco_anterior AS precoAnterior,
              comissao_pct AS comissaoPct, comissao_extra AS comissaoExtra,
              vendas, rating, categoria, imagem_id AS imagemId, visto_em AS vistoEm
       FROM ofertas WHERE item_id = ?`,
    )
    .get(itemId) as any
  if (!l) return undefined
  return {
    ...l,
    comissaoExtra: Boolean(l.comissaoExtra),
    productId: l.productId ?? undefined,
    precoAnterior: l.precoAnterior ?? undefined,
    vendas: l.vendas ?? undefined,
    rating: l.rating ?? undefined,
    categoria: l.categoria ?? undefined,
    imagemId: l.imagemId ?? undefined,
  }
}

// ─── Automações ──────────────────────────────────────────────────

import type { Automacao } from './motor/automacao.ts'

export function automacoes(db: Database.Database): Automacao[] {
  const linhas = db
    .prepare(
      `SELECT id, nome, descricao, ativa, dias_semana AS diasSemana, janelas,
              intervalo_minutos AS intervaloMinutos, limite_diario AS limiteDiario, filtro
       FROM automacoes ORDER BY nome`,
    )
    .all() as any[]

  const vinculos = db.prepare('SELECT automacao_id AS a, destino_id AS d FROM automacao_destinos').all() as {
    a: string
    d: string
  }[]

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    descricao: l.descricao ?? undefined,
    ativa: Boolean(l.ativa),
    diasSemana: JSON.parse(l.diasSemana),
    janelas: JSON.parse(l.janelas),
    intervaloMinutos: l.intervaloMinutos,
    limiteDiario: l.limiteDiario,
    filtro: JSON.parse(l.filtro),
    destinos: vinculos.filter((v) => v.a === l.id).map((v) => v.d),
  }))
}

export function salvarAutomacao(db: Database.Database, a: Automacao): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO automacoes (id, nome, descricao, ativa, dias_semana, janelas,
                               intervalo_minutos, limite_diario, filtro, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         nome = excluded.nome, descricao = excluded.descricao, ativa = excluded.ativa,
         dias_semana = excluded.dias_semana, janelas = excluded.janelas,
         intervalo_minutos = excluded.intervalo_minutos, limite_diario = excluded.limite_diario,
         filtro = excluded.filtro`,
    ).run(
      a.id,
      a.nome,
      a.descricao ?? null,
      a.ativa ? 1 : 0,
      JSON.stringify(a.diasSemana),
      JSON.stringify(a.janelas),
      a.intervaloMinutos,
      a.limiteDiario,
      JSON.stringify(a.filtro),
      new Date().toISOString(),
    )
    db.prepare('DELETE FROM automacao_destinos WHERE automacao_id = ?').run(a.id)
    const vincular = db.prepare('INSERT INTO automacao_destinos (automacao_id, destino_id) VALUES (?, ?)')
    for (const d of a.destinos) vincular.run(a.id, d)
  })()
}

export function apagarAutomacao(db: Database.Database, id: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM automacao_destinos WHERE automacao_id = ?').run(id)
    db.prepare('DELETE FROM automacoes WHERE id = ?').run(id)
  })()
}

/** Última execução e total de hoje, por automação. Base da agenda. */
export function estatisticaAutomacao(
  db: Database.Database,
  automacaoId: string,
  hojeLocal: string,
): { ultima?: Date; enviadosHoje: number } {
  const u = db
    .prepare('SELECT MAX(publicado_em) AS q FROM publicacoes WHERE automacao_id = ?')
    .get(automacaoId) as { q: string | null }

  const linhas = db
    .prepare('SELECT publicado_em AS q FROM publicacoes WHERE automacao_id = ?')
    .all(automacaoId) as { q: string }[]

  const enviadosHoje = linhas.filter(
    (l) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(l.q)) === hojeLocal,
  ).length

  return { ultima: u.q ? new Date(u.q) : undefined, enviadosHoje }
}
