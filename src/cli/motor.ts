import { carregarEnv, exigir } from '../config.ts'
import {
  abrir,
  historicos,
  linkSalvo,
  ofertasSalvas,
  publicacoesRecentes,
  publicadosNoDestino,
  registrarPublicacao,
  salvarLink,
} from '../db.ts'
import { LinkbuilderProvider } from '../link/linkbuilder.ts'
import { MontadoProvider } from '../link/montado.ts'
import { aprovado, primeiraQuePassa } from '../motor/corte.ts'
import { carregarDestinos } from '../motor/destinos.ts'
import { motivoParaEsperar } from '../motor/agenda.ts'
import { ranquear } from '../score.ts'
import { Telegram } from '../telegram.ts'
import type { LinkProvider } from '../tipos.ts'

carregarEnv()

/**
 * Uma rodada do motor: olha cada destino, e publica no máximo uma oferta em
 * cada um que estiver liberado pela agenda.
 *
 * Agende com launchd/cron a cada 15 minutos. Quem controla o ritmo é a janela
 * de cada destino, não a frequência da chamada — rodar de mais não publica de
 * mais.
 */
const agora = new Date()
const seco = process.argv.includes('--simular')

const { destinos, corte } = carregarDestinos()
const tg = seco ? undefined : new Telegram(exigir('TELEGRAM_BOT_TOKEN'))
const etiqueta = exigir('ETIQUETA')

const provider: LinkProvider =
  process.env.LINK_PROVIDER === 'montado'
    ? new MontadoProvider(exigir('MATT_TOOL'))
    : new LinkbuilderProvider({ headless: process.env.HEADLESS === '1' })

const db = abrir()
const publicacoes = publicacoesRecentes(db)
const fila = ranquear(ofertasSalvas(db), { historicos: historicos(db), agora })

if (fila.length === 0) {
  console.log('Fila vazia — rode `npm run coletar` antes.')
  process.exit(0)
}

console.log(`${fmtHora(agora)} · ${fila.length} ofertas na fila · ${destinos.length} destinos${seco ? ' · SIMULAÇÃO' : ''}`)

let publicados = 0

for (const destino of destinos) {
  const espera = motivoParaEsperar(destino, publicacoes, agora)
  if (espera) {
    console.log(`  ${destino.nome}: ${espera}`)
    continue
  }

  const jaFoi = publicadosNoDestino(db, destino.id)
  const escolhida = primeiraQuePassa(fila, corte, jaFoi)

  if (!escolhida) {
    // Explica com o topo da fila por que ninguém passou — sem isso, "não
    // publicou nada" vira um mistério.
    const topo = fila.find((i) => !jaFoi.has(i.oferta.itemId))
    const porque = topo ? aprovado(topo, corte).motivo : 'todas já publicadas aqui'
    console.log(`  ${destino.nome}: nenhuma oferta passou no corte (${porque})`)
    continue
  }

  let link = linkSalvo(db, escolhida.oferta.itemId, etiqueta)
  if (!link) {
    if (seco) {
      console.log(`  ${destino.nome}: [simulação] geraria link para ${escolhida.oferta.itemId}`)
    } else {
      const novos = await provider.gerar([escolhida.oferta], etiqueta)
      link = novos.get(escolhida.oferta.itemId)
      if (!link) {
        console.log(`  ${destino.nome}: falhou ao gerar link de ${escolhida.oferta.itemId} — pulando`)
        continue
      }
      salvarLink(db, escolhida.oferta.itemId, etiqueta, link)
    }
  }

  const rotulo = `${escolhida.oferta.titulo.slice(0, 46)} · R$ ${escolhida.ganhoReais.toFixed(2)}`

  if (seco) {
    console.log(`  ${destino.nome}: [simulação] publicaria → ${rotulo}`)
    continue
  }

  await tg!.publicar(destino.chatId, escolhida, link!)
  registrarPublicacao(db, escolhida.oferta.itemId, destino.id, escolhida.oferta.precoAtual)
  publicacoes.push({
    itemId: escolhida.oferta.itemId,
    destinoId: destino.id,
    publicadoEm: agora.toISOString(),
  })
  publicados++
  console.log(`  ${destino.nome}: publicado → ${rotulo}`)
}

db.close()
console.log(seco ? 'Simulação encerrada — nada foi enviado.' : `Rodada encerrada: ${publicados} publicações.`)

function fmtHora(d: Date): string {
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}
