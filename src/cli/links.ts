import { carregarEnv, exigir } from '../config.ts'
import { abrir, historicos, linkSalvo, ofertasSalvas, salvarLink } from '../db.ts'
import { LinkbuilderProvider } from '../link/linkbuilder.ts'
import { MontadoProvider } from '../link/montado.ts'
import { ranquear } from '../score.ts'
import type { LinkProvider } from '../tipos.ts'

carregarEnv()

/**
 * Garante link de afiliado para as N melhores ofertas da fila.
 * Roda antes de `npm run site` — a página só mostra oferta que já tem link.
 */
const quantos = Number(process.argv[2] ?? process.env.SITE_ITENS ?? 24)
const etiqueta = exigir('ETIQUETA')

const provider: LinkProvider =
  process.env.LINK_PROVIDER === 'montado'
    ? new MontadoProvider(exigir('MATT_TOOL'))
    : new LinkbuilderProvider({ headless: process.env.HEADLESS === '1' })

const db = abrir()
const fila = ranquear(ofertasSalvas(db), { historicos: historicos(db) }).slice(0, quantos)
const faltando = fila.filter((i) => !linkSalvo(db, i.oferta.itemId, etiqueta))

console.log(`${fila.length} na fila · ${faltando.length} sem link · provider: ${provider.nome}`)

if (faltando.length > 0) {
  const novos = await provider.gerar(faltando.map((f) => f.oferta), etiqueta)
  for (const [itemId, url] of novos) salvarLink(db, itemId, etiqueta, url)
  console.log(`${novos.size} links gerados e salvos.`)
  if (novos.size < faltando.length) {
    console.log(`${faltando.length - novos.size} não puderam ser gerados.`)
  }
}
db.close()
