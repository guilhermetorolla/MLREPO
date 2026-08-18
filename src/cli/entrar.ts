import { chromium } from 'playwright'
import { PERFIL } from '../coletor.ts'

/**
 * Abre o navegador do projeto para você fazer login no Mercado Livre UMA VEZ.
 * A sessão fica salva no perfil e o coletor passa a rodar sozinho depois.
 *
 * Não automatizo o login: senha é sua, e eu não digito credencial em lugar
 * nenhum. Aqui só abro a janela e fico conferindo quando a sessão valer.
 */
const HUB = 'https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true'
const ENDPOINT = '/affiliate-program/api/hub/search?is_affiliate=true&device=desktop'
const LIMITE_MIN = 10

const ctx = await chromium.launchPersistentContext(PERFIL, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  locale: 'pt-BR',
})

const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(HUB, { waitUntil: 'domcontentloaded' })

console.log('Uma janela do navegador abriu.')
console.log('Faça login no Mercado Livre nela. Eu aviso aqui quando a sessão valer.')
console.log('')
console.log('Entre com e-mail/CPF e senha DO MERCADO LIVRE, não pelo botão do Google:')
console.log('o Google recusa login em navegador controlado por automação e responde')
console.log('"Esse navegador ou app pode não ser seguro".')
console.log(`\n(desisto em ${LIMITE_MIN} min se nada acontecer)\n`)

const limite = Date.now() + LIMITE_MIN * 60_000
let ok = false
// Fechar a janela é uma forma legítima de desistir. Sem isso, o processo
// morria com stack trace de "Target page has been closed" — que parece bug
// do projeto e esconde o que de fato aconteceu.
let janelaFechada = false
ctx.on('close', () => {
  janelaFechada = true
})

while (Date.now() < limite && !janelaFechada) {
  try {
    await page.waitForTimeout(3000)
  } catch {
    janelaFechada = true
    break
  }
  try {
    const status = await page.evaluate(async (endpoint) => {
      const r = await fetch(endpoint as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include',
      })
      return r.status
    }, ENDPOINT)

    if (status === 200) {
      ok = true
      break
    }
    process.stdout.write('.')
  } catch {
    process.stdout.write('.')
  }
}

console.log('')
if (!ok && janelaFechada) {
  console.log('Você fechou a janela antes de a sessão valer. Rode `npm run entrar` de novo quando puder.')
  process.exit(1)
}
if (ok) {
  console.log('Sessão ativa e salva no perfil.')
  console.log('Pode fechar a janela. Agora `npm run coletar` funciona sozinho.')
} else {
  console.log('Tempo esgotado sem sessão válida. Rode de novo quando puder logar.')
}

await ctx.close().catch(() => {})
process.exit(ok ? 0 : 1)
