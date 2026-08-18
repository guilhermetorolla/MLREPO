import { carregarEnv, exigir } from '../config.ts'
import { abrir, historicos, linkSalvo, ofertasSalvas, salvarLink } from '../db.ts'
import { agruparPorMarketplace, linkPara } from '../fontes/registry.ts'
import { ranquear } from '../score.ts'
import { MARKETPLACES } from '../tipos.ts'

carregarEnv()

/**
 * Garante link de afiliado para as melhores ofertas da fila, usando o provedor
 * de cada marketplace — o do ML passa por navegador, o da Shopee é API.
 */
const quantos = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? process.env.SITE_ITENS ?? 24)
const etiqueta = exigir('ETIQUETA')

const db = abrir()
const fila = ranquear(ofertasSalvas(db), { historicos: historicos(db) }).slice(0, quantos)
const faltando = fila.filter((i) => !linkSalvo(db, i.oferta.itemId, etiqueta)).map((i) => i.oferta)

console.log(`${fila.length} na fila · ${faltando.length} sem link`)

for (const [marketplace, ofertas] of agruparPorMarketplace(faltando)) {
  const provedor = linkPara(marketplace)
  if (!provedor) {
    console.log(`${MARKETPLACES[marketplace] ?? marketplace}: sem provedor de link — ${ofertas.length} puladas`)
    continue
  }

  const d = await provedor.disponivel()
  if (!d.ok) {
    console.log(`${provedor.nome}: indisponível — ${d.motivo}`)
    continue
  }

  try {
    const novos = await provedor.gerar(ofertas, etiqueta)
    for (const [itemId, url] of novos) salvarLink(db, itemId, etiqueta, url)
    console.log(`${provedor.nome}: ${novos.size} de ${ofertas.length} links gerados`)
  } catch (e) {
    console.error(`${provedor.nome}: falhou — ${(e as Error).message}`)
  }
}

db.close()
