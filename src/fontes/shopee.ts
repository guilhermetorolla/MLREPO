import { createHash } from 'node:crypto'
import type { FonteDeOfertas, OpcoesBusca, ProvedorDeLink } from './tipos.ts'
import { idCanonico, type Marketplace, type Oferta } from '../tipos.ts'

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql'

/**
 * Assinatura exigida pela Shopee Affiliate Open API.
 *
 * Header: `Authorization: SHA256 Credential=<appId>, Timestamp=<ts>, Signature=<hash>`
 * onde hash = SHA256(appId + timestamp + payload + appSecret), em hexadecimal.
 *
 * Função pura de propósito: dá para testar sem credencial e sem rede, e é o
 * ponto onde um erro silencioso viraria 401 difícil de diagnosticar.
 */
export function assinar(appId: string, appSecret: string, payload: string, timestamp: number): string {
  return createHash('sha256').update(`${appId}${timestamp}${payload}${appSecret}`).digest('hex')
}

export function cabecalhoAutorizacao(
  appId: string,
  appSecret: string,
  payload: string,
  timestamp: number,
): string {
  const assinatura = assinar(appId, appSecret, payload, timestamp)
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${assinatura}`
}

/** Converte o nó de produto da Shopee no nosso formato. */
export function normalizar(no: any, agora: string): Oferta | undefined {
  const idNativo = String(no?.itemId ?? no?.item_id ?? '')
  if (!idNativo) return undefined

  const preco = Number(no?.priceMin ?? no?.price ?? no?.price_min)
  if (!Number.isFinite(preco)) return undefined

  // A Shopee entrega a comissão como fração (0.12 = 12%); nós trabalhamos com
  // percentual em todo o resto do projeto.
  const bruta = Number(no?.commissionRate ?? no?.commission_rate ?? 0)
  const comissaoPct = bruta > 0 && bruta <= 1 ? bruta * 100 : bruta

  const precoAnterior = Number(no?.priceDiscountRate ?? 0) > 0
    ? preco / (1 - Number(no.priceDiscountRate) / 100)
    : undefined

  return {
    itemId: idCanonico('shopee', idNativo),
    marketplace: 'shopee',
    titulo: String(no?.productName ?? no?.name ?? '(sem título)'),
    url: String(no?.productLink ?? no?.offerLink ?? ''),
    precoAtual: preco,
    precoAnterior: precoAnterior && precoAnterior > preco ? arredondar(precoAnterior) : undefined,
    comissaoPct: arredondar(comissaoPct),
    comissaoExtra: Boolean(no?.sellerCommissionRate),
    vendas: numero(no?.sales ?? no?.historicalSold),
    rating: numero(no?.ratingStar),
    imagemId: undefined,
    imagemUrl: no?.imageUrl ? String(no.imageUrl) : undefined,
    vistoEm: agora,
  }
}

const arredondar = (n: number) => Math.round(n * 100) / 100
const numero = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export class FonteShopee implements FonteDeOfertas {
  readonly marketplace: Marketplace = 'shopee'
  readonly nome = 'Shopee (API oficial)'

  readonly #appId: string
  readonly #appSecret: string

  constructor(appId = process.env.SHOPEE_APP_ID ?? '', appSecret = process.env.SHOPEE_APP_SECRET ?? '') {
    this.#appId = appId
    this.#appSecret = appSecret
  }

  async disponivel() {
    if (!this.#appId || !this.#appSecret) {
      return {
        ok: false,
        motivo:
          'faltam SHOPEE_APP_ID e SHOPEE_APP_SECRET no .env — peça acesso em ' +
          'affiliate.shopee.com.br (aba Open API, análise de 5 a 15 dias)',
      }
    }
    return { ok: true }
  }

  async buscar(opcoes: OpcoesBusca = {}): Promise<Oferta[]> {
    const d = await this.disponivel()
    if (!d.ok) throw new Error(d.motivo)

    const porPagina = 50
    const paginas = opcoes.paginas ?? 1
    const agora = new Date().toISOString()
    const ofertas: Oferta[] = []

    for (let pagina = 1; pagina <= paginas; pagina++) {
      const consulta = opcoes.termo
        ? `{productOfferV2(keyword:"${escapar(opcoes.termo)}",limit:${porPagina},page:${pagina}){nodes{itemId productName priceMin priceDiscountRate commissionRate sales ratingStar imageUrl productLink offerLink}}}`
        : `{productOfferV2(limit:${porPagina},page:${pagina}){nodes{itemId productName priceMin priceDiscountRate commissionRate sales ratingStar imageUrl productLink offerLink}}}`

      const payload = JSON.stringify({ query: consulta })
      const ts = Math.floor(Date.now() / 1000)

      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: cabecalhoAutorizacao(this.#appId, this.#appSecret, payload, ts),
        },
        body: payload,
      })

      if (!r.ok) throw new Error(`Shopee respondeu HTTP ${r.status}`)
      const corpo = (await r.json()) as any
      if (corpo?.errors?.length) {
        throw new Error(`Shopee: ${corpo.errors.map((e: any) => e.message).join(' · ')}`)
      }

      const nos = corpo?.data?.productOfferV2?.nodes ?? []
      if (nos.length === 0) break
      for (const no of nos) {
        const o = normalizar(no, agora)
        if (o) ofertas.push(o)
      }

      if (pagina < paginas) await new Promise((s) => setTimeout(s, opcoes.pausaMs ?? 600))
    }

    return ofertas
  }
}

const escapar = (s: string) => s.replace(/["\\]/g, '\\$&')

/**
 * Na Shopee o link de afiliado sai da própria API — sem navegador, sem
 * captcha, sem lote manual. É o contraste direto com o Mercado Livre.
 */
export class LinkShopee implements ProvedorDeLink {
  readonly marketplace: Marketplace = 'shopee'
  readonly nome = 'Shopee (API oficial)'

  readonly #fonte: FonteShopee
  readonly #appId: string
  readonly #appSecret: string

  constructor(appId = process.env.SHOPEE_APP_ID ?? '', appSecret = process.env.SHOPEE_APP_SECRET ?? '') {
    this.#appId = appId
    this.#appSecret = appSecret
    this.#fonte = new FonteShopee(appId, appSecret)
  }

  disponivel() {
    return this.#fonte.disponivel()
  }

  async gerar(ofertas: Oferta[], etiqueta: string): Promise<Map<string, string>> {
    const d = await this.disponivel()
    if (!d.ok) throw new Error(d.motivo)

    const saida = new Map<string, string>()
    for (const o of ofertas) {
      const consulta = `mutation{generateShortLink(input:{originUrl:"${escapar(o.url)}",subIds:["${escapar(etiqueta)}"]}){shortLink}}`
      const payload = JSON.stringify({ query: consulta })
      const ts = Math.floor(Date.now() / 1000)

      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: cabecalhoAutorizacao(this.#appId, this.#appSecret, payload, ts),
        },
        body: payload,
      })
      if (!r.ok) continue
      const corpo = (await r.json()) as any
      const link = corpo?.data?.generateShortLink?.shortLink
      if (link) saida.set(o.itemId, String(link))
    }
    return saida
  }
}
