import type { OfertaPontuada } from '../tipos.ts'
import type { RegraDeCorte } from './tipos.ts'

export interface Veredito {
  ok: boolean
  motivo?: string
}

const reais = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`

/**
 * Decide se uma oferta pode ir ao ar sem ninguém olhar.
 *
 * Sempre devolve o motivo da reprova. Num motor automático, "não publicou nada
 * hoje" precisa ser uma frase legível no log, não um silêncio.
 */
export function aprovado(item: OfertaPontuada, regra: RegraDeCorte): Veredito {
  const o = item.oferta

  if (item.ganhoReais < regra.ganhoMinimo) {
    return { ok: false, motivo: `ganho ${reais(item.ganhoReais)} < ${reais(regra.ganhoMinimo)}` }
  }

  if (regra.notaMinima !== undefined) {
    if (o.rating === undefined) {
      return { ok: false, motivo: 'sem nota registrada' }
    }
    if (o.rating < regra.notaMinima) {
      return { ok: false, motivo: `nota ${o.rating} < ${regra.notaMinima}` }
    }
  }

  if (regra.vendasMinimas !== undefined && (o.vendas ?? 0) < regra.vendasMinimas) {
    return { ok: false, motivo: `vendas ${o.vendas ?? 0} < ${regra.vendasMinimas}` }
  }

  if (regra.precoMaximo !== undefined && o.precoAtual > regra.precoMaximo) {
    return { ok: false, motivo: `preço ${reais(o.precoAtual)} acima do teto ${reais(regra.precoMaximo)}` }
  }

  if (regra.exigirDescontoConfirmado) {
    // pontuar() registra em motivos como o desconto foi avaliado contra o histórico.
    const confirmado = item.motivos.some((m) => m.includes('menor preço que já vimos'))
    if (!confirmado) {
      return { ok: false, motivo: 'desconto não confirmado pelo histórico' }
    }
  }

  return { ok: true }
}

/**
 * Melhor oferta da fila que passa no corte e ainda não foi usada.
 * A fila já vem ordenada por score, então a primeira aprovada é a melhor.
 */
export function primeiraQuePassa(
  fila: OfertaPontuada[],
  regra: RegraDeCorte,
  bloqueados: Set<string>,
): OfertaPontuada | undefined {
  return fila.find((i) => !bloqueados.has(i.oferta.itemId) && aprovado(i, regra).ok)
}
