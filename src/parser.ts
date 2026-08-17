import type { Oferta } from './tipos.ts'

/**
 * Traduz a resposta de POST /affiliate-program/api/hub/search em Ofertas.
 *
 * ATENÇÃO: essa é uma API interna, não documentada e sem contrato público.
 * Todo conhecimento sobre o formato mora AQUI e em nenhum outro lugar do
 * projeto. Se o ML mudar o formato, o teste de contrato quebra alto e só
 * este arquivo precisa mudar.
 *
 * Mapa confirmado em 17/08/2026:
 *   metadata.id                          → itemId
 *   metadata.url                         → url (sem query)
 *   components[].type === 'title'        → título
 *   components[].type === 'price'        → current_price / previous_price
 *   components[].id === 'affiliates_commission_chip'
 *        .chip.label.text                → "22%"  (o percentual)
 *        .chip.pill.values[key=extra]    → presença = comissão EXTRA
 *   components[].type === 'review_compacted'
 *        values[key=label].label.text    → nota
 *        values[key=label2].label.text   → "| +750mil vendidos"
 */
export function parsearFeed(bruto: unknown, opcoes: { agora?: Date } = {}): Oferta[] {
  const cards = (bruto as any)?.polycard_client_model?.polycards
  if (!Array.isArray(cards)) {
    throw new Error(
      'Feed do hub com estrutura inesperada: polycard_client_model.polycards não é lista. ' +
        'A API interna provavelmente mudou — revisar src/parser.ts.',
    )
  }

  const vistoEm = (opcoes.agora ?? new Date()).toISOString()
  const ofertas: Oferta[] = []

  for (const card of cards) {
    const oferta = parsearCard(card, vistoEm)
    if (oferta) ofertas.push(oferta)
  }
  return ofertas
}

function parsearCard(card: any, vistoEm: string): Oferta | null {
  const meta = card?.metadata
  const itemId = meta?.id
  if (!itemId) return null

  const comps: any[] = Object.values(card?.components ?? {})
  const acharPorTipo = (t: string) => comps.find((c) => c?.type === t)
  const acharPorId = (id: string) => comps.find((c) => c?.id === id)

  // Sem comissão conhecida a oferta não serve para nada aqui.
  const chip = acharPorId('affiliates_commission_chip')?.chip
  const comissaoPct = parsearComissao(chip)
  if (comissaoPct === undefined) return null

  const preco = acharPorTipo('price')?.price
  const precoAtual = numero(preco?.current_price?.value)
  if (precoAtual === undefined) return null

  const review = acharPorTipo('review_compacted')?.review_compacted
  const valoresReview: any[] = review?.values ?? []
  const textoDe = (key: string) =>
    valoresReview.find((v) => v?.key === key)?.label?.text as string | undefined

  const pillValues: any[] = chip?.pill?.values ?? []
  const temExtraNoPill =
    pillValues.some((v) => v?.key === 'extra') || /EXTRAS/i.test(String(chip?.pill?.text ?? ''))
  // metadata.extra_commission chega como STRING "true"/"false".
  const extraNoMetadata = String(meta?.extra_commission ?? '').toLowerCase() === 'true'

  return {
    itemId,
    productId: meta?.product_id || undefined,
    titulo: acharPorTipo('title')?.title?.text ?? '(sem título)',
    url: normalizarUrl(meta?.url),
    precoAtual,
    precoAnterior: numero(preco?.previous_price?.value),
    comissaoPct,
    comissaoExtra: temExtraNoPill || extraNoMetadata,
    vendas: parsearVendas(textoDe('label2')),
    rating: numero(textoDe('label')),
    imagemId: card?.pictures?.pictures?.[0]?.id || undefined,
    vistoEm,
  }
}

/**
 * O chip de comissão vem em DOIS formatos — conferido contra os 18 cards do feed:
 *
 *   com "GANHOS EXTRAS":  chip.pill.text = "{ganancia} {extra}" (+ values[])
 *                         chip.label.text = "22%"     ← percentual aqui
 *   sem extra:            chip.pill.text = "GANHOS 12%"  ← percentual embutido,
 *                         e chip.label NÃO existe
 *
 * A primeira versão só lia chip.label e descartava calada metade do feed.
 */
function parsearComissao(chip: any): number | undefined {
  return parsearPercentual(chip?.label?.text) ?? parsearPercentual(chip?.pill?.text)
}

/** "22%" → 22 · "GANHOS 12%" → 12 */
function parsearPercentual(texto: unknown): number | undefined {
  const m = String(texto ?? '').match(/([\d.,]+)\s*%/)
  if (!m) return undefined
  const n = Number(m[1]!.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** "| +750mil vendidos" → 750000 · "| +100 vendidos" → 100 */
export function parsearVendas(texto: unknown): number | undefined {
  const t = String(texto ?? '')
  const m = t.match(/([\d.,]+)\s*(mil|mi)?\s*vendidos/i)
  if (!m) return undefined
  const base = Number(m[1]!.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(base)) return undefined
  const escala = m[2]?.toLowerCase() === 'mil' ? 1_000 : m[2]?.toLowerCase() === 'mi' ? 1_000_000 : 1
  return Math.round(base * escala)
}

function numero(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** O feed devolve a URL sem esquema. Guardamos sempre canônica e sem query. */
function normalizarUrl(url: unknown): string {
  const bruto = String(url ?? '').split('?')[0] ?? ''
  if (!bruto) return ''
  return bruto.startsWith('http') ? bruto : `https://${bruto}`
}
