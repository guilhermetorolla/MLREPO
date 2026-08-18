import type { Marketplace, Oferta } from '../tipos.ts'

export interface OpcoesBusca {
  /** Quantas páginas varrer. Cada fonte define o tamanho da página. */
  paginas?: number
  /** Termo de busca, quando a fonte suportar. */
  termo?: string
  /** Pausa entre requisições, em ms. */
  pausaMs?: number
}

/**
 * De onde as ofertas vêm. Cada marketplace implementa esta interface e o
 * motor não precisa saber a diferença.
 *
 * As fontes são MUITO diferentes por baixo:
 *   - Mercado Livre: endpoint interno do hub, exige sessão de navegador
 *   - Shopee: API oficial GraphQL com HMAC-SHA256
 *   - Amazon: PA-API oficial, com requisito de vendas para liberar
 *   - Lista: importação manual, sem busca
 *
 * Manter tudo atrás desta interface é o que evita espalhar `if (marketplace)`
 * pelo motor, pelo painel e pelo site.
 */
export interface FonteDeOfertas {
  readonly marketplace: Marketplace
  readonly nome: string
  /** false quando falta credencial/sessão — o painel usa isso para explicar. */
  disponivel(): Promise<{ ok: boolean; motivo?: string }>
  buscar(opcoes?: OpcoesBusca): Promise<Oferta[]>
}

/** Gera o link de afiliado. Também varia por marketplace. */
export interface ProvedorDeLink {
  readonly marketplace: Marketplace
  readonly nome: string
  disponivel(): Promise<{ ok: boolean; motivo?: string }>
  gerar(ofertas: Oferta[], etiqueta: string): Promise<Map<string, string>>
}
