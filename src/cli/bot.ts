import { carregarEnv, exigir } from '../config.ts'
import {
  abrir,
  historicos,
  linkSalvo,
  ofertasSalvas,
  publicadosRecentemente,
  registrarPublicacao,
  salvarLink,
} from '../db.ts'
import { LinkbuilderProvider } from '../link/linkbuilder.ts'
import { MontadoProvider } from '../link/montado.ts'
import { ranquear } from '../score.ts'
import { Telegram } from '../telegram.ts'
import type { LinkProvider, OfertaPontuada } from '../tipos.ts'

carregarEnv()

const tg = new Telegram(exigir('TELEGRAM_BOT_TOKEN'))
const chatAprovacao = exigir('TELEGRAM_CHAT_APROVACAO')
const canal = exigir('TELEGRAM_CANAL')
const etiqueta = exigir('ETIQUETA')
const quantos = Number(process.env.LOTE ?? 10)

// Enquanto a Fase 0 do PLANO.md não confirmar a atribuição do link montado,
// o padrão é o gerador oficial.
const provider: LinkProvider =
  process.env.LINK_PROVIDER === 'montado'
    ? new MontadoProvider(exigir('MATT_TOOL'))
    : new LinkbuilderProvider({ headless: process.env.HEADLESS === '1' })

const db = abrir()
const fila = ranquear(ofertasSalvas(db), {
  historicos: historicos(db),
  publicadosRecentemente: publicadosRecentemente(db),
}).slice(0, quantos)

if (fila.length === 0) {
  console.log('Fila vazia. Rode `npm run coletar` antes.')
  process.exit(0)
}

// Reaproveita link já gerado — é determinístico por (item, etiqueta).
const pendentes = fila.filter((i) => !linkSalvo(db, i.oferta.itemId, etiqueta))
if (pendentes.length > 0) {
  console.log(`Gerando ${pendentes.length} links via ${provider.nome}...`)
  const novos = await provider.gerar(
    pendentes.map((p) => p.oferta),
    etiqueta,
  )
  for (const [itemId, url] of novos) salvarLink(db, itemId, etiqueta, url)
  console.log(`${novos.size} links gerados e salvos em cache.`)
}

const emAnalise = new Map<string, OfertaPontuada>()
for (const item of fila) {
  const link = linkSalvo(db, item.oferta.itemId, etiqueta)
  if (!link) {
    console.warn(`sem link para ${item.oferta.itemId} — pulando`)
    continue
  }
  await tg.pedirAprovacao(chatAprovacao, item, link)
  emAnalise.set(item.oferta.itemId, item)
}

console.log(`${emAnalise.size} ofertas enviadas para aprovação. Aguardando decisão...`)
console.log('Ctrl+C para sair. Nada é publicado sem você tocar em Publicar.')

let offset = 0
while (emAnalise.size > 0) {
  const updates = await tg.receber(offset)
  for (const u of updates) {
    offset = u.update_id + 1
    const cb = u.callback_query
    if (!cb) continue

    const [acao, itemId] = String(cb.data ?? '').split(':')
    const item = itemId ? emAnalise.get(itemId) : undefined
    if (!item || !itemId) continue

    if (acao === 'ok') {
      const link = linkSalvo(db, itemId, etiqueta)!
      await tg.publicar(canal, item, link)
      registrarPublicacao(db, itemId, 'telegram', item.oferta.precoAtual)
      await tg.responderCallback(cb.id, 'Publicado no canal')
      console.log(`publicado: ${item.oferta.titulo.slice(0, 50)}`)
    } else {
      await tg.responderCallback(cb.id, 'Descartado')
      console.log(`descartado: ${item.oferta.titulo.slice(0, 50)}`)
    }
    emAnalise.delete(itemId)
  }
}

db.close()
console.log('Fila concluída.')
