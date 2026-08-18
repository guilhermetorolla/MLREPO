import { mkdirSync, writeFileSync } from 'node:fs'
import { carregarEnv } from '../config.ts'
import {
  abrir,
  faixasPreco,
  historicos,
  lerConfig,
  linkSalvo,
  ofertasSalvas,
  publicadosRecentemente,
} from '../db.ts'
import { ranquear } from '../score.ts'
import { gerarFeed, gerarHtml, type ItemSite } from '../site/template.ts'

carregarEnv()

const SAIDA = new URL('../../docs/', import.meta.url).pathname
const etiquetaDoEnv = process.env.ETIQUETA_SITE || process.env.ETIQUETA || ''
const quantos = Number(process.env.SITE_ITENS ?? 24)

const db = abrir()
const etiqueta = etiquetaDoEnv || lerConfig(db, 'etiqueta') || ''
const faixas = faixasPreco(db)

// O site publica a mesma curadoria do canal, com a etiqueta do site — é assim
// que a aba "Etiquetas de rastreamento" consegue separar quem converte.
const fila = ranquear(ofertasSalvas(db), {
  historicos: historicos(db),
  publicadosRecentemente: publicadosRecentemente(db, 3),
}).slice(0, quantos)

const itens: ItemSite[] = []
const semLink: string[] = []
for (const item of fila) {
  const link = etiqueta ? linkSalvo(db, item.oferta.itemId, etiqueta) : undefined
  if (!link) {
    semLink.push(item.oferta.itemId)
    continue
  }
  itens.push({ item, link, faixa: faixas.get(item.oferta.itemId) })
}
db.close()

if (itens.length === 0) {
  console.error(
    'Nenhuma oferta com link gerado para a etiqueta do site.\n' +
      `Etiqueta usada: ${etiqueta || '(nenhuma definida)'}\n` +
      'Defina ETIQUETA_SITE no .env e rode `npm run bot` (ou gere os links) antes.',
  )
  process.exit(1)
}

const agora = new Date()
mkdirSync(SAIDA, { recursive: true })
writeFileSync(`${SAIDA}index.html`, gerarHtml(itens, agora))
writeFileSync(`${SAIDA}feed.json`, gerarFeed(itens, agora))

const auditadas = itens.filter((i) => (i.faixa?.amostras ?? 0) >= 2).length
console.log(`docs/index.html e docs/feed.json gerados: ${itens.length} ofertas, ${auditadas} com histórico.`)
if (semLink.length > 0) {
  console.log(`${semLink.length} ficaram de fora por não terem link na etiqueta "${etiqueta}".`)
}
