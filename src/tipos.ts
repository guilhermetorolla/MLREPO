/** Uma oferta como sai do feed do hub de afiliados, já normalizada. */
export interface Oferta {
  /** ID do anúncio (MLB...). Chave natural. */
  itemId: string
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
  /** Quando esta leitura foi feita (ISO). Comissão extra expira. */
  vistoEm: string
}

/** Monta a URL da foto no CDN. 2X porque a grade é vista em tela retina. */
export function urlImagem(imagemId: string | undefined): string | undefined {
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
