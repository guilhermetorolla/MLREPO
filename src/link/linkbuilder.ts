import { chromium } from 'playwright'
import { PERFIL } from '../coletor.ts'
import type { LinkProvider, Oferta } from '../tipos.ts'

const LINKBUILDER = 'https://www.mercadolivre.com.br/afiliados/linkbuilder'

/**
 * CAMINHO B — usa o "Gerador de produtos recomendados" oficial, em lote.
 *
 * O painel aceita várias URLs (uma por linha) e devolve todas de uma vez.
 * Como o link é determinístico por (produto, etiqueta) — gerei o mesmo item
 * duas vezes e voltou o mesmo `meli.la/...` — vale a pena cachear em disco:
 * o custo marginal cai a zero com o tempo.
 *
 * Este caminho NÃO chama o endpoint interno createLink por HTTP: ele dispara
 * browser-assessment + reCAPTCHA Enterprise, e contornar antibot está fora de
 * escopo. Aqui a página é operada como uma pessoa operaria — em lote.
 */
export class LinkbuilderProvider implements LinkProvider {
  readonly nome = 'linkbuilder'

  // Sem parameter property: o Node em strip-only mode não suporta.
  readonly #opcoes: { headless?: boolean; loteMax?: number }

  constructor(opcoes: { headless?: boolean; loteMax?: number } = {}) {
    this.#opcoes = opcoes
  }

  async gerar(ofertas: Oferta[], etiqueta: string): Promise<Map<string, string>> {
    const loteMax = this.#opcoes.loteMax ?? 20
    const saida = new Map<string, string>()
    if (ofertas.length === 0) return saida

    const ctx = await chromium.launchPersistentContext(PERFIL, {
      headless: this.#opcoes.headless ?? false,
      viewport: { width: 1280, height: 900 },
      locale: 'pt-BR',
    })

    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage())

      for (let i = 0; i < ofertas.length; i += loteMax) {
        const lote = ofertas.slice(i, i + loteMax)
        await page.goto(LINKBUILDER, { waitUntil: 'domcontentloaded' })

        if (/\/login|\/jms\/mlb\/lgz/.test(page.url())) {
          throw new Error('Sessão do Mercado Livre expirou — refaça o login no perfil do navegador.')
        }

        await this.conferirEtiqueta(page, etiqueta)

        const campo = page.locator('textarea').first()
        await campo.fill(lote.map((o) => o.url).join('\n'))
        await page.getByRole('button', { name: 'Gerar' }).click()

        // O painel avisa "N de M links foram gerados corretamente".
        await page.waitForTimeout(2500)

        const gerados = await this.lerLinks(page)
        // O painel devolve na mesma ordem das URLs de entrada, pulando as recusadas.
        // Só casamos quando a contagem bate; senão preferimos não adivinhar.
        if (gerados.length === lote.length) {
          lote.forEach((o, idx) => saida.set(o.itemId, gerados[idx]!))
        } else {
          console.warn(
            `[linkbuilder] lote com ${lote.length} URLs devolveu ${gerados.length} links — ` +
              'pulando o lote para não associar link ao produto errado.',
          )
        }
      }
      return saida
    } finally {
      await ctx.close()
    }
  }

  /** A etiqueta define a atribuição por canal. Errar aqui suja a métrica. */
  private async conferirEtiqueta(page: any, etiqueta: string): Promise<void> {
    const select = page.locator('select, [role="combobox"]').first()
    if ((await select.count()) === 0) return
    const atual = (await select.inputValue().catch(() => '')) || ''
    if (atual && atual !== etiqueta) {
      await select.selectOption({ label: etiqueta }).catch(() => {
        throw new Error(
          `Etiqueta "${etiqueta}" não encontrada no painel. Crie-a em Ferramentas → Administrar etiquetas.`,
        )
      })
    }
  }

  private async lerLinks(page: any): Promise<string[]> {
    // Roda no contexto da página (tem DOM); daqui é só string.
    const script = `
      (() => {
        const t = [...document.querySelectorAll('textarea,input,div,span,p')]
          .map(e => (e.value || e.textContent || '').trim())
          .filter(s => s.startsWith('https://meli.la/'));
        return [...new Set(t)];
      })()
    `
    return page.evaluate(script)
  }
}
