/** Um grupo ou canal do Telegram onde o motor publica. */
export interface Destino {
  /** Identificador interno, usado no registro de publicações. */
  id: string
  /** chat_id do Telegram (@canal ou -100123456789 para grupo). */
  chatId: string
  nome: string
  /** Faixas em que pode publicar, hora local. Ex.: ["09:00-12:00", "14:00-21:00"] */
  janelas: string[]
  /** Teto de posts por dia neste destino. */
  limiteDiario: number
  /** Espaçamento mínimo entre dois posts no mesmo destino. */
  intervaloMinutos: number
  /** Desligar sem apagar a configuração. */
  ativo?: boolean
}

/** Régua de qualidade: o que merece ir ao ar sozinho. */
export interface RegraDeCorte {
  /** Comissão mínima estimada, em reais. */
  ganhoMinimo: number
  /** Exigir que o desconto tenha sido confirmado pelo nosso histórico. */
  exigirDescontoConfirmado: boolean
  /** Nota mínima do produto (0 a 5). Item sem nota é tratado como reprovado. */
  notaMinima?: number
  /** Vendas mínimas registradas no card. */
  vendasMinimas?: number
  /** Preço máximo — acima disso a conversão despenca em grupo de oferta. */
  precoMaximo?: number
}

export const CORTE_PADRAO: RegraDeCorte = {
  ganhoMinimo: 10,
  exigirDescontoConfirmado: false,
  notaMinima: 4,
  vendasMinimas: 100,
}

/** Registro do que já foi publicado, por destino. */
export interface Publicacao {
  itemId: string
  destinoId: string
  publicadoEm: string
}
