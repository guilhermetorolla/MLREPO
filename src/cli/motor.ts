import { carregarEnv, exigir } from '../config.ts'
import {
  abrir,
  agendamentosVencidos,
  decisoes,
  destinos as destinosDoBanco,
  historicos,
  linkSalvo,
  marcarAgendamento,
  ofertasSalvas,
  publicacoesRecentes,
  publicadosNoDestino,
  registrarEvento,
  registrarPublicacao,
  salvarLink,
  type DestinoLinha,
} from '../db.ts'
import { LinkbuilderProvider } from '../link/linkbuilder.ts'
import { MontadoProvider } from '../link/montado.ts'
import { motivoParaEsperar } from '../motor/agenda.ts'
import { aprovado, primeiraQuePassa } from '../motor/corte.ts'
import { carregarDestinos } from '../motor/destinos.ts'
import { CORTE_PADRAO, type Destino } from '../motor/tipos.ts'
import { ranquear } from '../score.ts'
import { Telegram } from '../telegram.ts'
import type { LinkProvider, OfertaPontuada } from '../tipos.ts'

carregarEnv()

/**
 * Uma rodada do motor, em duas fases:
 *
 *   1. agendamentos vencidos — você marcou a hora, então ignoram a régua de
 *      corte. Só respeitam o intervalo mínimo do destino, para dois posts não
 *      saírem colados.
 *   2. grade automática — janela + limite + corte, um post por destino livre.
 *
 * Agende com cron a cada 15 min. Quem controla o ritmo é a janela de cada
 * destino, não a frequência da chamada.
 */
const agora = new Date()
const seco = process.argv.includes('--simular')

const db = abrir()

// Sem token do Telegram não dá para publicar. Isso NÃO é erro: é o estado
// normal enquanto o bot não foi criado. Sair em silêncio com código 0 evita
// que o agendamento do sistema encha o log de exceção a cada 15 minutos.
if (!seco && !process.env.TELEGRAM_BOT_TOKEN) {
  console.log('TELEGRAM_BOT_TOKEN ausente — nada a publicar. Configure o .env para ligar o motor.')
  process.exit(0)
}

const tg = seco ? undefined : new Telegram(exigir('TELEGRAM_BOT_TOKEN'))
const etiqueta = exigir('ETIQUETA')

const provider: LinkProvider =
  process.env.LINK_PROVIDER === 'montado'
    ? new MontadoProvider(exigir('MATT_TOOL'))
    : new LinkbuilderProvider({ headless: process.env.HEADLESS === '1' })

const corte = (() => {
  try {
    return carregarDestinos().corte
  } catch {
    return CORTE_PADRAO
  }
})()

const destinos = destinosDoBanco(db).map(paraDestino)
const publicacoes = publicacoesRecentes(db)
const mapaDecisoes = decisoes(db)

// Rejeitados no painel saem da fila; aprovados furam o corte.
const fila = ranquear(ofertasSalvas(db), { historicos: historicos(db), agora }).filter(
  (i) => mapaDecisoes.get(i.oferta.itemId)?.estado !== 'rejeitado',
)
const aprovadosPorVoce = new Set(
  [...mapaDecisoes.values()].filter((d) => d.estado === 'aprovado').map((d) => d.itemId),
)

console.log(
  `${hora(agora)} · ${fila.length} na fila · ${destinos.length} destinos${seco ? ' · SIMULAÇÃO' : ''}`,
)

let publicados = 0
const porItem = new Map(fila.map((i) => [i.oferta.itemId, i]))

/**
 * O que já saiu NESTA rodada, como "destino:item".
 * Sem isso, a fase 2 republicaria o que a fase 1 acabou de publicar: em
 * execução real o banco segura, mas na simulação a rodada mentiria — e
 * simulação que mente não serve para decidir nada.
 */
const feitosNestaRodada = new Set<string>()

// ─── Fase 1: agendamentos vencidos ───────────────────────────────

for (const ag of agendamentosVencidos(db, agora)) {
  const destino = destinos.find((d) => d.id === ag.destinoId)
  const item = porItem.get(ag.itemId)

  if (!destino) {
    if (!seco) marcarAgendamento(db, ag.id, 'falhou', `destino "${ag.destinoId}" não existe mais`)
    console.log(`  [programado] destino "${ag.destinoId}" sumiu — marcado como falhou`)
    continue
  }
  if (!item) {
    if (!seco) marcarAgendamento(db, ag.id, 'falhou', 'oferta saiu da base')
    console.log(`  [programado] ${ag.itemId} saiu da base — marcado como falhou`)
    continue
  }

  // Programado ignora janela e corte, mas não o intervalo: posts colados
  // queimam o grupo.
  const espera = motivoParaEsperar({ ...destino, janelas: ['00:00-23:59'], limiteDiario: 9999 }, publicacoes, agora)
  if (espera) {
    console.log(`  [programado] ${destino.nome}: adiando — ${espera}`)
    continue
  }

  const ok = await publicar(destino, item, '[programado] ')
  // `--simular` é SOMENTE LEITURA. Marcar aqui sem checar o modo fez a
  // simulação dar o agendamento como publicado sem nada ter sido enviado.
  if (!seco) {
    marcarAgendamento(db, ag.id, ok ? 'publicado' : 'falhou', ok ? undefined : 'falha ao publicar')
  }
}

// ─── Fase 2: grade automática ────────────────────────────────────

for (const destino of destinos) {
  const espera = motivoParaEsperar(destino, publicacoes, agora)
  if (espera) {
    console.log(`  ${destino.nome}: ${espera}`)
    continue
  }

  const jaFoi = publicadosNoDestino(db, destino.id)
  for (const chave of feitosNestaRodada) {
    const [destinoId, itemId] = chave.split(':')
    if (destinoId === destino.id && itemId) jaFoi.add(itemId)
  }

  // Aprovado por você tem preferência sobre o que só passou no corte.
  const escolhida =
    fila.find((i) => aprovadosPorVoce.has(i.oferta.itemId) && !jaFoi.has(i.oferta.itemId)) ??
    primeiraQuePassa(fila, corte, jaFoi)

  if (!escolhida) {
    const topo = fila.find((i) => !jaFoi.has(i.oferta.itemId))
    const porque = topo ? aprovado(topo, corte).motivo : 'todas já publicadas aqui'
    console.log(`  ${destino.nome}: nenhuma passou no corte (${porque})`)
    continue
  }

  await publicar(destino, escolhida, '')
}

db.close()
console.log(seco ? 'Simulação encerrada — nada enviado.' : `Rodada encerrada: ${publicados} publicações.`)

// ─── Auxiliares ──────────────────────────────────────────────────

async function publicar(destino: Destino, item: OfertaPontuada, prefixo: string): Promise<boolean> {
  const rotulo = `${item.oferta.titulo.slice(0, 44)} · R$ ${item.ganhoReais.toFixed(2)}`

  let link = linkSalvo(db, item.oferta.itemId, etiqueta)
  if (!link) {
    if (seco) {
      console.log(`  ${prefixo}${destino.nome}: [simulação] geraria link de ${item.oferta.itemId}`)
    } else {
      try {
        const novos = await provider.gerar([item.oferta], etiqueta)
        link = novos.get(item.oferta.itemId)
      } catch (e) {
        registrarEvento(db, 'erro', 'motor', 'falha ao gerar link', `${item.oferta.itemId}: ${(e as Error).message}`)
        console.error(`  ${prefixo}${destino.nome}: ERRO ao gerar link — ${(e as Error).message}`)
        return false
      }
      if (!link) {
        registrarEvento(db, 'erro', 'motor', 'link não gerado', item.oferta.itemId)
        console.log(`  ${prefixo}${destino.nome}: sem link para ${item.oferta.itemId} — pulando`)
        return false
      }
      salvarLink(db, item.oferta.itemId, etiqueta, link)
    }
  }

  // Vale para os dois modos: a rodada precisa enxergar o que ela mesma fez,
  // para o intervalo mínimo e o anti-repetição valerem já na simulação.
  feitosNestaRodada.add(`${destino.id}:${item.oferta.itemId}`)
  publicacoes.push({
    itemId: item.oferta.itemId,
    destinoId: destino.id,
    publicadoEm: new Date().toISOString(),
  })

  if (seco) {
    console.log(`  ${prefixo}${destino.nome}: [simulação] publicaria → ${rotulo}`)
    return true
  }

  try {
    await tg!.publicar(destino.chatId, item, link!)
  } catch (e) {
    // Falha de publicação PRECISA sobreviver ao fim do processo: sem registro,
    // o motor automático pode passar dias quebrado sem ninguém perceber.
    const msg = (e as Error).message
    registrarEvento(db, 'erro', 'motor', `falha ao publicar em ${destino.nome}`, `${item.oferta.itemId}: ${msg}`)
    console.error(`  ${prefixo}${destino.nome}: ERRO ao publicar — ${msg}`)
    return false
  }

  registrarPublicacao(db, item.oferta.itemId, destino.id, item.oferta.precoAtual)
  registrarEvento(db, 'info', 'motor', `publicado em ${destino.nome}`, rotulo)
  publicados++
  console.log(`  ${prefixo}${destino.nome}: publicado → ${rotulo}`)
  return true
}

function paraDestino(d: DestinoLinha): Destino {
  return {
    id: d.id,
    chatId: d.chatId,
    nome: d.nome,
    janelas: d.janelas,
    limiteDiario: d.limiteDiario,
    intervaloMinutos: d.intervaloMinutos,
    ativo: d.ativo,
  }
}

function hora(d: Date): string {
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}
