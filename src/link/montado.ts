import type { LinkProvider, Oferta } from '../tipos.ts'

/**
 * CAMINHO A — monta o link direto do produto com os parâmetros de rastreio.
 *
 *   https://www.mercadolivre.com.br/<produto>/p/MLB123?matt_word=<etiqueta>&matt_tool=<id>
 *
 * Vantagem: 100% automático, sem passo manual, e leva direto à página do
 * produto (o gerador oficial leva ao Perfil Social, que é outra coisa).
 *
 * ⚠️ ATRIBUIÇÃO AINDA NÃO COMPROVADA. Em 17/08/2026 o link montado assim
 * carregou com os parâmetros preservados, mas o painel de Métricas estava com
 * incidente declarado nos dias 16 e 17/08 e não deu para confirmar se o clique
 * é creditado. Enquanto a Fase 0 do PLANO.md não fechar, o padrão é o
 * LinkbuilderProvider.
 *
 * Se a Fase 0 der negativo, este arquivo é deletado — nada mais muda.
 */
export class MontadoProvider implements LinkProvider {
  readonly nome = 'montado'

  // Sem parameter property: o Node em strip-only mode não suporta.
  readonly #mattTool: string

  constructor(mattTool: string) {
    if (!mattTool) throw new Error('matt_tool é obrigatório — pegue de um link gerado no painel')
    this.#mattTool = mattTool
  }

  async gerar(ofertas: Oferta[], etiqueta: string): Promise<Map<string, string>> {
    const saida = new Map<string, string>()
    for (const o of ofertas) {
      if (!o.url) continue
      const u = new URL(o.url)
      u.searchParams.set('matt_word', etiqueta)
      u.searchParams.set('matt_tool', this.#mattTool)
      saida.set(o.itemId, u.toString())
    }
    return saida
  }
}
