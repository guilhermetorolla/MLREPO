import { coletar } from '../coletor.ts'
import { LinkbuilderProvider } from '../link/linkbuilder.ts'
import { MontadoProvider } from '../link/montado.ts'
import type { FonteDeOfertas, OpcoesBusca, ProvedorDeLink } from './tipos.ts'
import type { Marketplace, Oferta } from '../tipos.ts'

/**
 * Mercado Livre: sem API pública de afiliado. O feed vem de um endpoint
 * interno do hub, que exige a sessão do navegador — daí depender do Playwright.
 * Ver PLANO.md, seção 1.
 */
export class FonteMercadoLivre implements FonteDeOfertas {
  readonly marketplace: Marketplace = 'ml'
  readonly nome = 'Mercado Livre (hub de afiliados)'

  async disponivel() {
    // A sessão só é verificável tentando; o coletor devolve mensagem acionável.
    return { ok: true }
  }

  async buscar(opcoes: OpcoesBusca = {}): Promise<Oferta[]> {
    return coletar({
      paginas: opcoes.paginas ?? 5,
      pausaMs: opcoes.pausaMs,
      headless: process.env.HEADLESS === '1',
    })
  }
}

export class LinkMercadoLivre implements ProvedorDeLink {
  readonly marketplace: Marketplace = 'ml'
  readonly nome: string

  readonly #interno: LinkbuilderProvider | MontadoProvider

  constructor() {
    if (process.env.LINK_PROVIDER === 'montado') {
      this.#interno = new MontadoProvider(process.env.MATT_TOOL ?? '')
      this.nome = 'Mercado Livre (link montado)'
    } else {
      this.#interno = new LinkbuilderProvider({ headless: process.env.HEADLESS === '1' })
      this.nome = 'Mercado Livre (gerador do painel)'
    }
  }

  async disponivel() {
    if (process.env.LINK_PROVIDER === 'montado' && !process.env.MATT_TOOL) {
      return { ok: false, motivo: 'falta MATT_TOOL no .env para o modo montado' }
    }
    return { ok: true }
  }

  gerar(ofertas: Oferta[], etiqueta: string): Promise<Map<string, string>> {
    return this.#interno.gerar(ofertas, etiqueta)
  }
}
