import { chromium, type BrowserContext } from 'playwright'
import { parsearFeed } from './parser.ts'
import type { Oferta } from './tipos.ts'

const HUB = 'https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true'
const ENDPOINT = '/affiliate-program/api/hub/search?is_affiliate=true&device=desktop'

/** Perfil persistente: a sessão logada vive aqui. Está no .gitignore. */
export const PERFIL = new URL('../.browser-profile', import.meta.url).pathname

export interface OpcoesColeta {
  /** Quantas páginas varrer. Cada página traz ~18 itens. */
  paginas?: number
  /** Pausa entre requisições, em ms. Ritmo humano, sem paralelismo. */
  pausaMs?: number
  headless?: boolean
}

/**
 * Lê o feed do hub de afiliados usando a SUA sessão, dentro de um navegador real.
 *
 * Por que dentro do browser e não com fetch + cookie: o domínio é protegido por
 * fingerprint de navegador (browser-assessment). Rodar aqui dentro é o caminho
 * honesto — é a sua conta lendo a sua própria vitrine, no ritmo de uma pessoa.
 *
 * Nada de paralelismo, nada de burlar captcha. Se algum dia o ML publicar uma
 * API oficial de afiliados, este arquivo é o único que muda.
 */
export async function coletar(opcoes: OpcoesColeta = {}): Promise<Oferta[]> {
  const { paginas = 5, pausaMs = 1500, headless = false } = opcoes

  const ctx = await chromium.launchPersistentContext(PERFIL, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
  })

  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(HUB, { waitUntil: 'domcontentloaded' })

    const todas: Oferta[] = []
    const vistos = new Set<string>()

    for (let i = 0; i < paginas; i++) {
      const offset = i * 18
      const resposta = await page.evaluate(
        async ([endpoint, off]) => {
          const r = await fetch(endpoint as string, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offset: off }),
            credentials: 'include',
          })
          return { status: r.status, corpo: r.ok ? await r.json() : null }
        },
        [ENDPOINT, offset] as const,
      )

      // O ML não redireciona para a tela de login: ele serve o hub normalmente
      // e nega o endpoint. Sem sessão, a falha chega como 401/403 aqui.
      if (resposta.status === 401 || resposta.status === 403) {
        throw new Error(mensagemSemSessao(resposta.status))
      }
      if (resposta.corpo === null) {
        throw new Error(`hub/search devolveu HTTP ${resposta.status} — feed indisponível agora.`)
      }

      const lote = parsearFeed(resposta.corpo)
      const novos = lote.filter((o) => !vistos.has(o.itemId))
      novos.forEach((o) => vistos.add(o.itemId))
      todas.push(...novos)

      if (lote.length === 0) break
      if (i < paginas - 1) await page.waitForTimeout(pausaMs)
    }

    return todas
  } finally {
    await ctx.close()
  }
}

/** Mensagem acionável em vez de stack trace — o caso mais comum de falha. */
export function mensagemSemSessao(status: number): string {
  return [
    `O feed do hub respondeu HTTP ${status}: a sessão do Mercado Livre não está ativa neste perfil.`,
    '',
    'Como resolver (uma vez só):',
    '  1. Rode com HEADLESS vazio (padrão) — o navegador abre visível',
    '  2. Faça login no Mercado Livre na janela que abrir',
    '  3. Rode de novo; a sessão fica salva no perfil',
    '',
    `Perfil: ${PERFIL}`,
  ].join('\n')
}

export type { BrowserContext }
