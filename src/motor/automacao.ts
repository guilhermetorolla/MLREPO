import type { OfertaPontuada } from '../tipos.ts'
import type { RegraDeCorte } from './tipos.ts'

/**
 * Uma automação responde "quando enviar" e "o que enviar".
 * O destino responde "para onde" e guarda o teto de proteção do grupo.
 *
 * Separar os dois permite ter "Eletrônicos de manhã" e "Moda à noite"
 * apontando para os mesmos grupos, com regras diferentes — e o grupo continua
 * protegido por limite próprio, não importa quantas automações mirem nele.
 */
export interface Automacao {
  id: string
  nome: string
  descricao?: string
  ativa: boolean
  /** 0=domingo … 6=sábado. Vazio significa todos os dias. */
  diasSemana: number[]
  /** Faixas de horário local, ex.: ["09:00-12:00"]. */
  janelas: string[]
  /** Espaçamento mínimo entre duas execuções DESTA automação. */
  intervaloMinutos: number
  /** Teto de envios por dia desta automação (somando todos os destinos). */
  limiteDiario: number
  filtro: FiltroConteudo
  destinos: string[]
}

export interface FiltroConteudo extends RegraDeCorte {
  /** Só entra se o título contiver ao menos uma destas. Vazio = qualquer. */
  palavrasIncluir?: string[]
  /** Sai se o título contiver qualquer uma destas. */
  palavrasExcluir?: string[]
  precoMinimo?: number
  /** Só ofertas com comissão extra vigente. */
  somenteComissaoExtra?: boolean
}

const FUSO = 'America/Sao_Paulo'
const FMT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hour12: false,
})

/** Dia da semana local: 0=domingo … 6=sábado. */
export function diaSemanaLocal(quando: Date): number {
  const partes = FMT.formatToParts(quando)
  const dia = partes.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? ''
  const mapa: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sáb: 6, sab: 6 }
  return mapa[dia.slice(0, 3)] ?? new Date(quando).getDay()
}

function minutosLocais(quando: Date): number {
  const partes = FMT.formatToParts(quando)
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

function faixa(texto: string): [number, number] | undefined {
  const m = texto.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return undefined
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]
}

/**
 * Motivo pelo qual a automação NÃO deve rodar agora, ou undefined se pode.
 * Devolver o motivo (em vez de um booleano) é o que deixa a tela e o log
 * explicarem uma rodada sem publicações.
 */
export function motivoAutomacaoEsperar(
  a: Automacao,
  agora: Date,
  ultimaExecucao: Date | undefined,
  enviadosHoje: number,
): string | undefined {
  if (!a.ativa) return 'automação pausada'
  if (a.destinos.length === 0) return 'nenhum destino ligado a esta automação'

  if (a.diasSemana.length > 0 && !a.diasSemana.includes(diaSemanaLocal(agora))) {
    return 'hoje não é dia desta automação'
  }

  if (a.janelas.length > 0) {
    const minutos = minutosLocais(agora)
    const dentro = a.janelas.some((j) => {
      const f = faixa(j)
      return f !== undefined && minutos >= f[0] && minutos < f[1]
    })
    if (!dentro) return 'fora da janela desta automação'
  }

  if (enviadosHoje >= a.limiteDiario) {
    return `limite diário da automação atingido (${enviadosHoje}/${a.limiteDiario})`
  }

  if (ultimaExecucao) {
    const min = (agora.getTime() - ultimaExecucao.getTime()) / 60_000
    if (min < a.intervaloMinutos) {
      return `intervalo da automação: faltam ${Math.ceil(a.intervaloMinutos - min)} min`
    }
  }

  return undefined
}

/** Aplica o filtro de conteúdo, devolvendo o que serve para esta automação. */
export function filtrarConteudo(ofertas: OfertaPontuada[], f: FiltroConteudo): OfertaPontuada[] {
  const incluir = (f.palavrasIncluir ?? []).map((p) => p.toLowerCase()).filter(Boolean)
  const excluir = (f.palavrasExcluir ?? []).map((p) => p.toLowerCase()).filter(Boolean)

  return ofertas.filter((i) => {
    const o = i.oferta
    const titulo = o.titulo.toLowerCase()

    if (incluir.length > 0 && !incluir.some((p) => titulo.includes(p))) return false
    if (excluir.some((p) => titulo.includes(p))) return false
    if (f.somenteComissaoExtra && !o.comissaoExtra) return false
    if (f.precoMinimo !== undefined && o.precoAtual < f.precoMinimo) return false
    if (f.precoMaximo !== undefined && o.precoAtual > f.precoMaximo) return false
    if (i.ganhoReais < f.ganhoMinimo) return false
    if (f.notaMinima !== undefined && (o.rating ?? -1) < f.notaMinima) return false
    if (f.vendasMinimas !== undefined && (o.vendas ?? 0) < f.vendasMinimas) return false
    if (f.exigirDescontoConfirmado && !i.motivos.some((m) => m.includes('menor preço que já vimos'))) {
      return false
    }
    return true
  })
}
