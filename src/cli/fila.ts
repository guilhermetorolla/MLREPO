import { carregarEnv } from '../config.ts'
import { abrir, historicos, ofertasSalvas, publicadosRecentemente } from '../db.ts'
import { ranquear } from '../score.ts'

carregarEnv()

const quantos = Number(process.argv[2] ?? 15)
const db = abrir()

const fila = ranquear(ofertasSalvas(db), {
  historicos: historicos(db),
  publicadosRecentemente: publicadosRecentemente(db),
}).slice(0, quantos)

db.close()

if (fila.length === 0) {
  console.log('Fila vazia. Rode `npm run coletar` primeiro.')
  process.exit(0)
}

console.log(`\nTop ${fila.length} — ordenado por ganho estimado em REAIS, não por percentual\n`)
for (const [i, item] of fila.entries()) {
  const o = item.oferta
  console.log(
    `${String(i + 1).padStart(2)}. R$ ${item.ganhoReais.toFixed(2).padStart(8)} | ` +
      `${String(o.comissaoPct).padStart(3)}%${o.comissaoExtra ? '*' : ' '} | ` +
      `R$ ${o.precoAtual.toFixed(2).padStart(9)} | ${o.titulo.slice(0, 58)}`,
  )
}
console.log('\n* = comissão extra (campanha temporária, pode cair sem aviso)')
