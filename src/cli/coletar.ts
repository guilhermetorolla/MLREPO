import { carregarEnv } from '../config.ts'
import { abrir, registrarEvento, salvarOfertas } from '../db.ts'
import { fontes } from '../fontes/registry.ts'
import { MARKETPLACES, type Marketplace } from '../tipos.ts'

carregarEnv()

/**
 * Coleta de todos os marketplaces disponíveis.
 * Fonte sem credencial é PULADA com aviso, não derruba a coleta inteira.
 */
const paginas = Number(process.env.PAGINAS ?? process.argv[2] ?? 5)
const filtro = process.argv.find((a) => a.startsWith('--fonte='))?.split('=')[1] as Marketplace | undefined

const db = abrir()
let total = 0

for (const fonte of fontes()) {
  if (filtro && fonte.marketplace !== filtro) continue

  const d = await fonte.disponivel()
  if (!d.ok) {
    console.log(`${fonte.nome}: indisponível — ${d.motivo}`)
    continue
  }

  console.log(`${fonte.nome}: coletando ${paginas} páginas...`)
  try {
    const ofertas = await fonte.buscar({ paginas })
    salvarOfertas(db, ofertas)
    total += ofertas.length
    console.log(`${fonte.nome}: ${ofertas.length} ofertas`)
    registrarEvento(db, 'info', 'coleta', `${ofertas.length} de ${MARKETPLACES[fonte.marketplace]}`)
  } catch (e) {
    const msg = (e as Error).message
    console.error(`${fonte.nome}: falhou — ${msg}`)
    registrarEvento(db, 'erro', 'coleta', `falha em ${MARKETPLACES[fonte.marketplace]}`, msg)
  }
}

db.close()
console.log(`\n${total} ofertas coletadas no total.`)
if (total === 0) process.exit(1)
