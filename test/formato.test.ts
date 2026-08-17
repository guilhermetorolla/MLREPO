import test from 'node:test'
import assert from 'node:assert/strict'
import { gerarHtml, type ItemSite } from '../src/site/template.ts'
import { pontuar } from '../src/score.ts'
import type { Oferta } from '../src/tipos.ts'

function html(over: Partial<Oferta>): string {
  const oferta: Oferta = {
    itemId: 'MLB1',
    titulo: 'Produto',
    url: 'https://www.mercadolivre.com.br/p/MLB1',
    precoAtual: 100,
    comissaoPct: 10,
    comissaoExtra: false,
    vistoEm: '2026-08-17T12:00:00.000Z',
    ...over,
  }
  const i: ItemSite = { item: pontuar(oferta), link: 'https://meli.la/abc' }
  return gerarHtml([i], new Date('2026-08-17T12:00:00.000Z'))
}

test('preço acima de mil leva separador de milhar', () => {
  assert.match(html({ precoAtual: 8399 }), /R\$ 8\.399,00/)
  assert.match(html({ precoAtual: 2499 }), /R\$ 2\.499,00/)
})

test('desconto trunca, para bater com o número que o Mercado Livre exibe', () => {
  // 199,90 → 78,90 dá 60,53%. O card do ML mostra 60% OFF; arredondar daria 61%
  // e o visitante veria dois números diferentes para a mesma oferta.
  assert.match(html({ precoAtual: 78.9, precoAnterior: 199.9 }), /60% OFF/)
  // 1500 → 465,88 dá 68,9%. O ML mostra 68%.
  assert.match(html({ precoAtual: 465.88, precoAnterior: 1500 }), /68% OFF/)
})

test('sem preço anterior não inventa desconto', () => {
  assert.ok(!html({ precoAtual: 2499 }).includes('% OFF'))
})

test('foto usa o CDN do ML em 2X e não trava a renderização', () => {
  const h = html({ imagemId: '894230-MLA111390627295_052026' })
  assert.match(h, /http2\.mlstatic\.com\/D_NQ_NP_2X_894230-MLA111390627295_052026-F\.webp/)
  assert.match(h, /loading="lazy"/)
})
