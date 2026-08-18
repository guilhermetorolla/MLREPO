import { carregarEnv, exigir } from '../config.ts'
import {
  abrir,
  agendamentosVencidos,
  automacoes as automacoesDoBanco,
  decisoes,
  destinos as destinosDoBanco,
  estatisticaAutomacao,
  historicos,
  linkSalvo,
  marcarAgendamento,
  ofertasSalvas,
  publicacoesRecentes,
  config,
  publicadosNoDestino,
  registrarEvento,
  registrarPublicacao,
  salvarLink,
  type DestinoLinha,
} from '../db.ts'
import { LinkbuilderProvider } from '../link/linkbuilder.ts'
import { MontadoProvider } from '../link/montado.ts'
import { diaLocal, motivoParaEsperar } from '../motor/agenda.ts'
import { avisarSessaoCaida, ehSessaoExpirada, marcarSessaoOk } from '../motor/aviso.ts'
import { filtrarConteudo, motivoAutomacaoEsperar } from '../motor/automacao.ts'
import type { Destino } from '../motor/tipos.ts'
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

const tokenTelegram = config(db, 'telegram_token', 'TELEGRAM_BOT_TOKEN')

// Sem token do Telegram não dá para publicar. Isso NÃO é erro: é o estado
// normal enquanto o bot não foi criado. Sair em silêncio com código 0 evita
// que o agendamento do sistema encha o log de exceção a cada 15 minutos.
if (!seco && !tokenTelegram) {
  console.log('Telegram não conectado — nada a publicar. Conecte pelo painel, em Configurações.')
  process.exit(0)
}

const tg = seco ? undefined : new Telegram(tokenTelegram!)
const etiqueta = config(db, 'etiqueta', 'ETIQUETA') ?? exigir('ETIQUETA')

/** Para onde vai recado de operação (sessão caída), não oferta. */
const chatOperador = config(db, 'telegram_chat_aprovacao', 'TELEGRAM_CHAT_APROVACAO')

/**
 * Sessão do ML caída derruba a rodada inteira, não só um item: todo link nasce
 * do mesmo perfil de navegador. Sem essa trava o motor abriria o Chromium uma
 * vez por destino para colher sempre o mesmo erro.
 */
let sessaoCaiu = false

const provider: LinkProvider =
  process.env.LINK_PROVIDER === 'montado'
    ? new MontadoProvider(exigir('MATT_TOOL'))
    : new LinkbuilderProvider({ headless: process.env.HEADLESS === '1' })

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
  if (sessaoCaiu) break

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

// ─── Fase 2: automações ──────────────────────────────────────────

const automacoes = automacoesDoBanco(db)
const hoje = diaLocal(agora)

if (automacoes.length === 0) {
  console.log('  nenhuma automação cadastrada — só os agendamentos manuais rodam')
}

for (const automacao of automacoes) {
  if (sessaoCaiu) break

  const stat = estatisticaAutomacao(db, automacao.id, hoje)
  const espera = motivoAutomacaoEsperar(automacao, agora, stat.ultima, stat.enviadosHoje)
  if (espera) {
    console.log(`  ${automacao.nome}: ${espera}`)
    continue
  }

  // O filtro da automação decide O QUE serve; o corte global fica de fora,
  // porque cada automação carrega o seu.
  const candidatas = filtrarConteudo(fila, automacao.filtro)
  if (candidatas.length === 0) {
    console.log(`  ${automacao.nome}: nenhuma oferta passou no filtro desta automação`)
    continue
  }

  let enviouAlgo = false

  for (const destinoId of automacao.destinos) {
    if (sessaoCaiu) break

    const destino = destinos.find((d) => d.id === destinoId)
    if (!destino) {
      console.log(`  ${automacao.nome}: destino "${destinoId}" não existe mais`)
      continue
    }

    // O destino tem teto próprio: protege o grupo mesmo que várias
    // automações mirem nele ao mesmo tempo.
    const bloqueio = motivoParaEsperar(destino, publicacoes, agora)
    if (bloqueio) {
      console.log(`  ${automacao.nome} → ${destino.nome}: ${bloqueio}`)
      continue
    }

    const jaFoi = publicadosNoDestino(db, destino.id)
    for (const chave of feitosNestaRodada) {
      const [dId, itemId] = chave.split(':')
      if (dId === destino.id && itemId) jaFoi.add(itemId)
    }

    const escolhida =
      candidatas.find((i) => aprovadosPorVoce.has(i.oferta.itemId) && !jaFoi.has(i.oferta.itemId)) ??
      candidatas.find((i) => !jaFoi.has(i.oferta.itemId))

    if (!escolhida) {
      console.log(`  ${automacao.nome} → ${destino.nome}: tudo que serve já foi publicado aqui`)
      continue
    }

    const ok = await publicar(destino, escolhida, `${automacao.nome} → `, automacao.id)
    if (ok) enviouAlgo = true
  }

  if (!enviouAlgo) continue
}

db.close()
console.log(seco ? 'Simulação encerrada — nada enviado.' : `Rodada encerrada: ${publicados} publicações.`)

// ─── Auxiliares ──────────────────────────────────────────────────

async function publicar(
  destino: Destino,
  item: OfertaPontuada,
  prefixo: string,
  automacaoId?: string,
): Promise<boolean> {
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
        if (ehSessaoExpirada(e)) {
          sessaoCaiu = true
          const avisado = await avisarSessaoCaida({
            db,
            agora: new Date(),
            enviar: (texto) =>
              chatOperador
                ? tg!.avisar(chatOperador, texto)
                : Promise.reject(new Error('TELEGRAM_CHAT_APROVACAO não configurado')),
          })
          console.error(
            `  ${prefixo}${destino.nome}: sessão do Mercado Livre expirou — rode \`npm run entrar\`` +
              (avisado ? ' (avisei no Telegram)' : ''),
          )
          return false
        }
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
      // Gerou link: a sessão está viva de novo, então a próxima queda
      // é incidente novo e avisa na hora.
      marcarSessaoOk(db)
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

  registrarPublicacao(db, item.oferta.itemId, destino.id, item.oferta.precoAtual, automacaoId)
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
