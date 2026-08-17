import type { HistoricoPreco, Oferta, OfertaPontuada } from './tipos.ts'

/**
 * Depois disso, a leitura do card é velha demais para confiar no "GANHOS EXTRAS":
 * campanha de comissão extra é temporária e cai sem aviso.
 */
const JANELA_LEITURA_HORAS = 48

const FATOR = {
  descontoConfirmado: 1.15,
  descontoDuvidoso: 0.8,
  comissaoExtra: 1.1,
  popular: 1.08,
  bemAvaliado: 1.05,
} as const

export interface OpcoesPontuacao {
  historico?: HistoricoPreco
  agora?: Date
}

/**
 * Pontua uma oferta. A base é a comissão EM REAIS, não o percentual —
 * um item de R$ 66 a 62% rende menos que um de R$ 466 a 16%.
 * Os demais sinais são multiplicadores sobre essa base.
 */
export function pontuar(oferta: Oferta, opcoes: OpcoesPontuacao = {}): OfertaPontuada {
  const agora = opcoes.agora ?? new Date()
  const motivos: string[] = []

  const ganhoReais = (oferta.precoAtual * oferta.comissaoPct) / 100
  let score = ganhoReais
  motivos.push(`ganho estimado R$ ${ganhoReais.toFixed(2)} (${oferta.comissaoPct}% de R$ ${oferta.precoAtual.toFixed(2)})`)

  // Desconto: o "de" riscado do card não vale nada sozinho. Só confirmamos
  // com histórico próprio — senão é preço inflado antes da promoção.
  if (oferta.precoAnterior && oferta.precoAnterior > oferta.precoAtual) {
    const pct = Math.round((1 - oferta.precoAtual / oferta.precoAnterior) * 100)
    const h = opcoes.historico
    if (!h || h.amostras < 2) {
      motivos.push(`desconto de ${pct}% não confirmado (sem histórico próprio)`)
    } else if (oferta.precoAtual < h.menorPreco) {
      score *= FATOR.descontoConfirmado
      motivos.push(`menor preço que já vimos (antes R$ ${h.menorPreco.toFixed(2)})`)
    } else {
      score *= FATOR.descontoDuvidoso
      motivos.push(`desconto duvidoso: já vimos por R$ ${h.menorPreco.toFixed(2)}`)
    }
  }

  // Comissão extra é campanha temporária — só conta se a leitura for recente.
  if (oferta.comissaoExtra) {
    const horas = (agora.getTime() - new Date(oferta.vistoEm).getTime()) / 3_600_000
    if (horas <= JANELA_LEITURA_HORAS) {
      score *= FATOR.comissaoExtra
      motivos.push('comissão extra vigente na última leitura')
    } else {
      motivos.push(`leitura vencida (${Math.round(horas)}h) — comissão extra pode ter caído`)
    }
  }

  if ((oferta.vendas ?? 0) >= 1000) {
    score *= FATOR.popular
    motivos.push(`${oferta.vendas} vendidos`)
  }
  if ((oferta.rating ?? 0) >= 4.5) {
    score *= FATOR.bemAvaliado
    motivos.push(`nota ${oferta.rating}`)
  }

  return { oferta, score, ganhoReais, motivos }
}

export interface OpcoesRanking extends OpcoesPontuacao {
  /** Itens já publicados na janela de cooldown — não repetir. */
  publicadosRecentemente?: Set<string>
  historicos?: Map<string, HistoricoPreco>
}

/**
 * Ordena as ofertas e devolve a fila de publicação.
 *
 * Além do score, evita duas ofertas da mesma categoria em sequência: um canal
 * que manda cinco perfumes seguidos perde audiência mesmo com score alto.
 */
export function ranquear(ofertas: Oferta[], opcoes: OpcoesRanking = {}): OfertaPontuada[] {
  const bloqueados = opcoes.publicadosRecentemente ?? new Set<string>()

  const pontuadas = ofertas
    .filter((o) => o.comissaoPct > 0 && o.precoAtual > 0)
    .filter((o) => !bloqueados.has(o.itemId))
    .map((o) =>
      pontuar(o, {
        agora: opcoes.agora,
        historico: opcoes.historicos?.get(o.itemId) ?? opcoes.historico,
      }),
    )
    .sort((a, b) => b.score - a.score)

  return intercalarCategorias(pontuadas)
}

/** Greedy: a cada passo pega o melhor cuja categoria difere da anterior. */
function intercalarCategorias(lista: OfertaPontuada[]): OfertaPontuada[] {
  const restantes = [...lista]
  const saida: OfertaPontuada[] = []
  let categoriaAnterior: string | undefined

  while (restantes.length > 0) {
    let i = restantes.findIndex(
      (o) => o.oferta.categoria === undefined || o.oferta.categoria !== categoriaAnterior,
    )
    if (i === -1) i = 0 // só sobrou a mesma categoria: segue o score
    const [escolhida] = restantes.splice(i, 1)
    saida.push(escolhida!)
    categoriaAnterior = escolhida!.oferta.categoria
  }

  return saida
}
