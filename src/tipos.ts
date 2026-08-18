export type Marketplace = 'ml' | 'shopee' | 'amazon' | 'lista'

export const MARKETPLACES: Record<Marketplace, string> = {
  ml: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
  lista: 'Lista própria',
}

/**
 * Identidade global da oferta: `<marketplace>:<id nativo>`.
 *
 * Com mais de um marketplace, o id nativo deixa de ser único — nada impede a
 * Shopee de usar um número que também exista em outro lugar. Prefixar resolve
 * sem precisar de chave composta em cinco tabelas.
 */
export function idCanonico(marketplace: Marketplace, idNativo: string): string {
  return `${marketplace}:${idNativo}`
}

export function partesDoId(itemId: string): { marketplace: Marketplace; idNativo: string } {
  const i = itemId.indexOf(':')
  if (i === -1) return { marketplace: 'ml', idNativo: itemId } // legado, antes do prefixo
  return { marketplace: itemId.slice(0, i) as Marketplace, idNativo: itemId.slice(i + 1) }
}

/** Uma oferta como sai de um marketplace, já normalizada. */
export interface Oferta {
  /** Identidade global: `<marketplace>:<id nativo>`. Ver idCanonico(). */
  itemId: string
  /** De onde veio. Redundante com o prefixo do itemId, mas facilita consulta. */
  marketplace?: Marketplace
  /** ID do produto no catálogo, quando existe. */
  productId?: string
  titulo: string
  /** URL canônica do produto, SEM parâmetros de afiliado. */
  url: string
  /** Preço que o comprador paga hoje. Base da comissão. */
  precoAtual: number
  /** Preço "de" riscado no card. NÃO é confiável — ver historico-preco. */
  precoAnterior?: number
  /** Percentual de comissão exibido no chip "GANHOS". */
  comissaoPct: number
  /** true quando o chip é "GANHOS EXTRAS" (campanha temporária). */
  comissaoExtra: boolean
  /** Unidades vendidas conforme o card ("+750mil vendidos" → 750000). */
  vendas?: number
  /** Nota de 0 a 5. */
  rating?: number
  categoria?: string
  /**
   * ID da foto no CDN do ML (ex.: "894230-MLA111390627295_052026").
   * Guardamos o id, não a URL: o padrão de URL muda com o tamanho pedido.
   */
  imagemId?: string
  /** URL de imagem já pronta. A Shopee entrega assim; o ML entrega só o id. */
  imagemUrl?: string
  /** Quando esta leitura foi feita (ISO). Comissão extra expira. */
  vistoEm: string
}

/**
 * URL da foto. Cada marketplace entrega de um jeito: o ML dá um id que vira
 * URL no CDN dele; a Shopee já devolve a URL pronta.
 */
export function urlImagem(imagemId: string | undefined, imagemUrl?: string): string | undefined {
  if (imagemUrl) return imagemUrl
  return imagemId ? `https://http2.mlstatic.com/D_NQ_NP_2X_${imagemId}-F.webp` : undefined
}

/** Menor preço já observado por nós para um item, com quando foi. */
export interface HistoricoPreco {
  itemId: string
  menorPreco: number
  menorPrecoEm: string
  amostras: number
}

/** Resultado do ranking, com o porquê explícito. */
export interface OfertaPontuada {
  oferta: Oferta
  score: number
  /** Comissão estimada em reais — o número que realmente importa. */
  ganhoReais: number
  /** Trilha de auditoria: por que pontuou o que pontuou. */
  motivos: string[]
}

/** Gera o link de afiliado. Duas implementações — ver plano, seção 2. */
export interface LinkProvider {
  readonly nome: string
  gerar(ofertas: Oferta[], etiqueta: string): Promise<Map<string, string>>
}
