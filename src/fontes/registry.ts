import { abrir, lerConfig } from '../db.ts'
import { FonteMercadoLivre, LinkMercadoLivre } from './mercadolivre.ts'
import { FonteShopee, LinkShopee } from './shopee.ts'

/**
 * Credencial salva pela tela vence a do .env: quem configurou no painel espera
 * que o motor use aquilo, e o motor roda em outro processo.
 */
function credenciaisShopee(): [string, string] {
  const db = abrir()
  try {
    return [
      lerConfig(db, 'shopee_app_id') ?? process.env.SHOPEE_APP_ID ?? '',
      lerConfig(db, 'shopee_app_secret') ?? process.env.SHOPEE_APP_SECRET ?? '',
    ]
  } finally {
    db.close()
  }
}
import type { FonteDeOfertas, ProvedorDeLink } from './tipos.ts'
import { partesDoId, type Marketplace } from '../tipos.ts'

/**
 * Ponto único que resolve marketplace → fonte/provedor.
 * Acrescentar a Amazon é adicionar duas linhas aqui e um arquivo em fontes/.
 */
export function fontes(): FonteDeOfertas[] {
  return [new FonteMercadoLivre(), new FonteShopee(...credenciaisShopee())]
}

export function provedoresDeLink(): ProvedorDeLink[] {
  return [new LinkMercadoLivre(), new LinkShopee(...credenciaisShopee())]
}

export function fontePara(marketplace: Marketplace): FonteDeOfertas | undefined {
  return fontes().find((f) => f.marketplace === marketplace)
}

export function linkPara(marketplace: Marketplace): ProvedorDeLink | undefined {
  return provedoresDeLink().find((p) => p.marketplace === marketplace)
}

/** Agrupa ofertas por marketplace, para gerar link com o provedor certo. */
export function agruparPorMarketplace<T extends { itemId: string }>(itens: T[]): Map<Marketplace, T[]> {
  const mapa = new Map<Marketplace, T[]>()
  for (const i of itens) {
    const { marketplace } = partesDoId(i.itemId)
    const lista = mapa.get(marketplace) ?? []
    lista.push(i)
    mapa.set(marketplace, lista)
  }
  return mapa
}
