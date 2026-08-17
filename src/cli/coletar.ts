import { carregarEnv } from '../config.ts'
import { coletar } from '../coletor.ts'
import { abrir, salvarOfertas } from '../db.ts'

carregarEnv()

const paginas = Number(process.env.PAGINAS ?? process.argv[2] ?? 5)
const headless = process.env.HEADLESS === '1'

console.log(`Coletando ${paginas} páginas do hub (~${paginas * 18} itens)...`)

let ofertas
try {
  ofertas = await coletar({ paginas, headless })
} catch (erro) {
  console.error(`\n${(erro as Error).message}\n`)
  process.exit(1)
}
console.log(`${ofertas.length} ofertas lidas.`)

const db = abrir()
salvarOfertas(db, ofertas)
db.close()

console.log('Salvas em data/ofertas.db. Rode `npm run fila` para ver o ranking.')
