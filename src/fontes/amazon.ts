import { createHash, createHmac } from 'node:crypto'
import type { FonteDeOfertas, OpcoesBusca, ProvedorDeLink } from './tipos.ts'
import { idCanonico, type Marketplace, type Oferta } from '../tipos.ts'

const HOST = 'webservices.amazon.com.br'
const REGIAO = 'us-east-1'
const SERVICO = 'ProductAdvertisingAPI'

/**
 * Amazon PA-API v5, assinada com AWS Signature V4.
 *
 * Diferente da Shopee (um SHA256 simples) e do Mercado Livre (sem API alguma),
 * a Amazon exige a cadeia completa da AWS: canonical request → string to sign
 * → chave derivada por data/região/serviço. Errar qualquer etapa devolve um
 * 403 genérico, então cada passo está isolado e testado.
 */
export function assinaturaV4(
  secret: string,
  data: string,
  regiao: string,
  servico: string,
  stringParaAssinar: string,
): string {
  const kData = createHmac('sha256', `AWS4${secret}`).update(data).digest()
  const kRegiao = createHmac('sha256', kData).update(regiao).digest()
  const kServico = createHmac('sha256', kRegiao).update(servico).digest()
  const kAssinatura = createHmac('sha256', kServico).update('aws4_request').digest()
  return createHmac('sha256', kAssinatura).update(stringParaAssinar).digest('hex')
}

export function canonicalRequest(
  metodo: string,
  caminho: string,
  cabecalhos: Record<string, string>,
  payload: string,
): { texto: string; assinados: string } {
  const chaves = Object.keys(cabecalhos)
    .map((k) => k.toLowerCase())
    .sort()
  const canonicos = chaves.map((k) => `${k}:${cabecalhos[Object.keys(cabecalhos).find((o) => o.toLowerCase() === k)!]}\n`).join('')
  const assinados = chaves.join(';')
  const hash = createHash('sha256').update(payload).digest('hex')
  return { texto: [metodo, caminho, '', canonicos, assinados, hash].join('\n'), assinados }
}

/** "2026-08-18T12:34:56Z" → { data: "20260818", carimbo: "20260818T123456Z" } */
export function carimbos(agora: Date): { data: string; carimbo: string } {
  const carimbo = agora.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { data: carimbo.slice(0, 8), carimbo }
}

export function normalizar(item: any, agora: string): Oferta | undefined {
  const asin = String(item?.ASIN ?? '')
  if (!asin) return undefined

  const oferta = item?.Offers?.Listings?.[0]
  const preco = Number(oferta?.Price?.Amount)
  if (!Number.isFinite(preco)) return undefined

  const de = Number(oferta?.Price?.Savings?.Amount)
  return {
    itemId: idCanonico('amazon', asin),
    marketplace: 'amazon',
    titulo: String(item?.ItemInfo?.Title?.DisplayValue ?? '(sem título)'),
    url: String(item?.DetailPageURL ?? ''),
    precoAtual: preco,
    precoAnterior: Number.isFinite(de) && de > 0 ? Math.round((preco + de) * 100) / 100 : undefined,
    // A PA-API não devolve a comissão: ela varia por categoria e vem da tabela
    // do programa. Fica 0 até termos a tabela — melhor do que inventar.
    comissaoPct: 0,
    comissaoExtra: false,
    rating: Number(item?.CustomerReviews?.StarRating?.Value) || undefined,
    imagemUrl: item?.Images?.Primary?.Large?.URL ? String(item.Images.Primary.Large.URL) : undefined,
    vistoEm: agora,
  }
}

export class FonteAmazon implements FonteDeOfertas {
  readonly marketplace: Marketplace = 'amazon'
  readonly nome = 'Amazon Brasil (PA-API)'

  readonly #chave: string
  readonly #secret: string
  readonly #parceiro: string

  constructor(
    chave = process.env.AMAZON_ACCESS_KEY ?? '',
    secret = process.env.AMAZON_SECRET_KEY ?? '',
    parceiro = process.env.AMAZON_PARTNER_TAG ?? '',
  ) {
    this.#chave = chave
    this.#secret = secret
    this.#parceiro = parceiro
  }

  async disponivel() {
    if (!this.#chave || !this.#secret || !this.#parceiro) {
      return {
        ok: false,
        motivo:
          'faltam AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY e AMAZON_PARTNER_TAG — a PA-API só é ' +
          'liberada após 3 vendas qualificadas em 180 dias como Associado Amazon',
      }
    }
    return { ok: true }
  }

  async buscar(opcoes: OpcoesBusca = {}): Promise<Oferta[]> {
    const d = await this.disponivel()
    if (!d.ok) throw new Error(d.motivo)

    const caminho = '/paapi5/searchitems'
    const payload = JSON.stringify({
      Keywords: opcoes.termo ?? 'ofertas',
      SearchIndex: 'All',
      ItemCount: 10,
      PartnerTag: this.#parceiro,
      PartnerType: 'Associates',
      Marketplace: 'www.amazon.com.br',
      Resources: [
        'ItemInfo.Title',
        'Offers.Listings.Price',
        'Offers.Listings.SavingBasis',
        'Images.Primary.Large',
        'CustomerReviews.StarRating',
      ],
    })

    const { data, carimbo } = carimbos(new Date())
    const cabecalhos: Record<string, string> = {
      'content-encoding': 'amz-1.0',
      'content-type': 'application/json; charset=utf-8',
      host: HOST,
      'x-amz-date': carimbo,
      'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems',
    }

    const { texto, assinados } = canonicalRequest('POST', caminho, cabecalhos, payload)
    const escopo = `${data}/${REGIAO}/${SERVICO}/aws4_request`
    const paraAssinar = [
      'AWS4-HMAC-SHA256',
      carimbo,
      escopo,
      createHash('sha256').update(texto).digest('hex'),
    ].join('\n')
    const assinatura = assinaturaV4(this.#secret, data, REGIAO, SERVICO, paraAssinar)

    const r = await fetch(`https://${HOST}${caminho}`, {
      method: 'POST',
      headers: {
        ...cabecalhos,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.#chave}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`,
      },
      body: payload,
    })

    if (!r.ok) throw new Error(`Amazon respondeu HTTP ${r.status}`)
    const corpo = (await r.json()) as any
    const agora = new Date().toISOString()
    return (corpo?.SearchResult?.Items ?? [])
      .map((i: any) => normalizar(i, agora))
      .filter((o: Oferta | undefined): o is Oferta => Boolean(o))
  }
}

/**
 * Na Amazon o link de afiliado é a URL do produto com a sua tag — sem API,
 * sem navegador. É o caso mais simples dos três.
 */
export class LinkAmazon implements ProvedorDeLink {
  readonly marketplace: Marketplace = 'amazon'
  readonly nome = 'Amazon (tag na URL)'

  readonly #parceiro: string

  constructor(parceiro = process.env.AMAZON_PARTNER_TAG ?? '') {
    this.#parceiro = parceiro
  }

  async disponivel() {
    return this.#parceiro
      ? { ok: true }
      : { ok: false, motivo: 'falta AMAZON_PARTNER_TAG (sua tag de Associado)' }
  }

  async gerar(ofertas: Oferta[]): Promise<Map<string, string>> {
    const d = await this.disponivel()
    if (!d.ok) throw new Error(d.motivo)

    const saida = new Map<string, string>()
    for (const o of ofertas) {
      if (!o.url) continue
      const u = new URL(o.url)
      u.searchParams.set('tag', this.#parceiro)
      saida.set(o.itemId, u.toString())
    }
    return saida
  }
}
