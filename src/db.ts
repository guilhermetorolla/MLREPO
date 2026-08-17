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

    CREATE TABLE IF NOT EXISTS publicacoes (
      item_id       TEXT NOT NULL,
      canal         TEXT NOT NULL,
      publicado_em  TEXT NOT NULL,
      preco_na_hora REAL NOT NULL,
      PRIMARY KEY (item_id, canal, publicado_em)
    );
    CREATE INDEX IF NOT EXISTS idx_pub_item ON publicacoes(item_id);
  `)
}

export function salvarOfertas(db: Database.Database, ofertas: Oferta[]): void {
  const upsert = db.prepare(`
    INSERT INTO ofertas (item_id, product_id, titulo, url, preco_atual, preco_anterior,
                         comissao_pct, comissao_extra, vendas, rating, categoria, visto_em)
    VALUES (@itemId, @productId, @titulo, @url, @precoAtual, @precoAnterior,
            @comissaoPct, @comissaoExtra, @vendas, @rating, @categoria, @vistoEm)
    ON CONFLICT(item_id) DO UPDATE SET
      preco_atual = excluded.preco_atual, preco_anterior = excluded.preco_anterior,
      comissao_pct = excluded.comissao_pct, comissao_extra = excluded.comissao_extra,
      vendas = excluded.vendas, rating = excluded.rating, visto_em = excluded.visto_em
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

/** Itens publicados nos últimos N dias — entram em cooldown. */
export function publicadosRecentemente(db: Database.Database, dias = 14): Set<string> {
  const corte = new Date(Date.now() - dias * 86_400_000).toISOString()
  const linhas = db
    .prepare('SELECT DISTINCT item_id AS itemId FROM publicacoes WHERE publicado_em >= ?')
    .all(corte) as { itemId: string }[]
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
): void {
  db.prepare(
    'INSERT OR REPLACE INTO publicacoes (item_id, canal, publicado_em, preco_na_hora) VALUES (?, ?, ?, ?)',
  ).run(itemId, canal, new Date().toISOString(), precoNaHora)
}

export function ofertasSalvas(db: Database.Database): Oferta[] {
  const linhas = db
    .prepare(
      `SELECT item_id AS itemId, product_id AS productId, titulo, url,
              preco_atual AS precoAtual, preco_anterior AS precoAnterior,
              comissao_pct AS comissaoPct, comissao_extra AS comissaoExtra,
              vendas, rating, categoria, visto_em AS vistoEm
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
  }))
}
