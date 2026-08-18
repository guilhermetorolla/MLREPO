import type { Oferta } from '../tipos.ts'

/**
 * Cupom de desconto com as regras que decidem se ele vale para um produto.
 * Copia o modelo do concorrente, que é bom: valor mínimo, teto de abatimento,
 * onde vale e validade — conferidos produto a produto.
 */
export interface Cupom {
  codigo: string
  /** Desconto percentual (ex.: 20 = 20%). Use um OU valorFixo. */
  percentual?: number
  /** Abatimento fixo em reais. */
  valorFixo?: number
  /** Compra mínima para o cupom valer. */
  compraMinima?: number
  /** Teto do abatimento em reais, mesmo que o percentual dê mais. */
  tetoDesconto?: number
  /** Só vale para itens cujo título contenha uma destas palavras. Vazio = todos. */
  categorias?: string[]
  /** Só vale para estes itens. Vazio = todos. */
  itens?: string[]
  /** ISO. Fora da faixa, o cupom não entra na mensagem. */
  validoDe?: string
  validoAte?: string
  ativo?: boolean
}

export interface Aplicacao {
  aplica: boolean
  /** Preço final com o cupom, quando aplica. */
  precoFinal?: number
  desconto?: number
  /** Por que não aplicou — para o painel explicar em vez de sumir. */
  motivo?: string
}

/**
 * Decide se o cupom entra na oferta e calcula o preço final.
 *
 * Regra dura: na dúvida, NÃO aplica. Mandar código inválido ou preço errado
 * para o grupo custa mais caro que perder um desconto.
 */
export function aplicarCupom(cupom: Cupom, oferta: Oferta, agora = new Date()): Aplicacao {
  if (cupom.ativo === false) return { aplica: false, motivo: 'cupom desativado' }

  if (cupom.validoDe && agora < new Date(cupom.validoDe)) {
    return { aplica: false, motivo: 'cupom ainda não começou' }
  }
  if (cupom.validoAte && agora > new Date(cupom.validoAte)) {
    return { aplica: false, motivo: 'cupom vencido' }
  }

  if (cupom.itens && cupom.itens.length > 0 && !cupom.itens.includes(oferta.itemId)) {
    return { aplica: false, motivo: 'cupom não vale para este item' }
  }

  if (cupom.categorias && cupom.categorias.length > 0) {
    const titulo = oferta.titulo.toLowerCase()
    const bate = cupom.categorias.some((c) => titulo.includes(c.toLowerCase()))
    if (!bate) return { aplica: false, motivo: 'cupom não vale para esta categoria' }
  }

  if (cupom.compraMinima !== undefined && oferta.precoAtual < cupom.compraMinima) {
    return { aplica: false, motivo: `abaixo da compra mínima de R$ ${cupom.compraMinima.toFixed(2)}` }
  }

  let desconto = 0
  if (cupom.percentual !== undefined) desconto = (oferta.precoAtual * cupom.percentual) / 100
  else if (cupom.valorFixo !== undefined) desconto = cupom.valorFixo
  else return { aplica: false, motivo: 'cupom sem percentual nem valor fixo' }

  if (cupom.tetoDesconto !== undefined) desconto = Math.min(desconto, cupom.tetoDesconto)

  // Arredonda para centavo, sempre a favor do anunciado (nunca prometer menos
  // do que o cliente vai pagar).
  desconto = Math.floor(desconto * 100) / 100
  if (desconto <= 0) return { aplica: false, motivo: 'desconto calculado é zero' }

  const precoFinal = Math.max(0, Math.round((oferta.precoAtual - desconto) * 100) / 100)
  return { aplica: true, precoFinal, desconto }
}

/** Melhor cupom para uma oferta: o que deixa o preço final menor. */
export function melhorCupom(cupons: Cupom[], oferta: Oferta, agora = new Date()): (Aplicacao & { cupom: Cupom }) | undefined {
  let melhor: (Aplicacao & { cupom: Cupom }) | undefined
  for (const c of cupons) {
    const r = aplicarCupom(c, oferta, agora)
    if (!r.aplica) continue
    if (!melhor || r.precoFinal! < melhor.precoFinal!) melhor = { ...r, cupom: c }
  }
  return melhor
}
