import type { Destino, Publicacao } from './tipos.ts'

/**
 * Fuso fixo de Brasília. Deixar isso implícito é o erro clássico: em servidor
 * ou container o relógio é UTC, e "hoje" vira o dia errado por 3 horas — o
 * limite diário zera na hora errada e a janela da noite escapa.
 */
const FUSO = 'America/Sao_Paulo'

const FMT_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const FMT_DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Minutos desde a meia-noite, no horário de Brasília. */
export function minutosLocais(quando: Date): number {
  const [h, m] = FMT_HORA.format(quando).split(':')
  return Number(h) * 60 + Number(m)
}

/** Dia local no formato AAAA-MM-DD, para contar o limite diário. */
export function diaLocal(quando: Date): string {
  return FMT_DIA.format(quando)
}

function faixa(texto: string): [number, number] | undefined {
  const m = texto.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return undefined
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]
}

export function dentroDaJanela(destino: Destino, agora: Date): boolean {
  const minutos = minutosLocais(agora)
  return destino.janelas.some((j) => {
    const f = faixa(j)
    return f !== undefined && minutos >= f[0] && minutos < f[1]
  })
}

/** Início da próxima janela, como "09:00". Útil para explicar a espera. */
export function proximoHorario(destino: Destino, agora: Date): string | undefined {
  const minutos = minutosLocais(agora)
  const inicios = destino.janelas
    .map(faixa)
    .filter((f): f is [number, number] => f !== undefined)
    .map((f) => f[0])
    .sort((a, b) => a - b)
  if (inicios.length === 0) return undefined
  const proximo = inicios.find((i) => i > minutos) ?? inicios[0]! // senão, amanhã
  return `${String(Math.floor(proximo / 60)).padStart(2, '0')}:${String(proximo % 60).padStart(2, '0')}`
}

/**
 * Devolve o motivo pelo qual NÃO se deve publicar agora, ou undefined se pode.
 * Retornar o motivo (em vez de um booleano) é o que deixa o log do motor legível
 * quando ele passa a rodada inteira sem publicar nada.
 */
export function motivoParaEsperar(
  destino: Destino,
  publicacoes: Publicacao[],
  agora: Date,
): string | undefined {
  if (destino.ativo === false) return 'destino desligado'

  if (!dentroDaJanela(destino, agora)) {
    const prox = proximoHorario(destino, agora)
    return `fora da janela (abre ${prox ?? 'sem horário configurado'})`
  }

  const daqui = publicacoes.filter((p) => p.destinoId === destino.id)

  const hoje = diaLocal(agora)
  const publicadasHoje = daqui.filter((p) => diaLocal(new Date(p.publicadoEm)) === hoje).length
  if (publicadasHoje >= destino.limiteDiario) {
    return `limite diário atingido (${publicadasHoje}/${destino.limiteDiario})`
  }

  const ultima = daqui
    .map((p) => new Date(p.publicadoEm).getTime())
    .sort((a, b) => b - a)[0]
  if (ultima !== undefined) {
    const minutosDesde = (agora.getTime() - ultima) / 60_000
    if (minutosDesde < destino.intervaloMinutos) {
      const falta = Math.ceil(destino.intervaloMinutos - minutosDesde)
      return `intervalo mínimo: faltam ${falta} min`
    }
  }

  return undefined
}
