import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { assinar, cabecalhoAutorizacao, normalizar, FonteShopee } from '../src/fontes/shopee.ts'
import { idCanonico, partesDoId, urlImagem } from '../src/tipos.ts'

test('id canônico separa marketplaces que poderiam colidir', () => {
  assert.equal(idCanonico('ml', 'MLB123'), 'ml:MLB123')
  assert.equal(idCanonico('shopee', '123'), 'shopee:123')
  // Mesmo número em marketplaces diferentes não vira o mesmo registro.
  assert.notEqual(idCanonico('shopee', '123'), idCanonico('amazon', '123'))
})

test('partesDoId volta ao par original e trata o formato legado', () => {
  assert.deepEqual(partesDoId('shopee:999'), { marketplace: 'shopee', idNativo: '999' })
  // Registros gravados antes do prefixo eram todos do Mercado Livre.
  assert.deepEqual(partesDoId('MLB6713010960'), { marketplace: 'ml', idNativo: 'MLB6713010960' })
})

test('assinatura da Shopee segue appId+timestamp+payload+secret em SHA256', () => {
  const esperado = createHash('sha256').update('app1' + '1700000000' + '{"query":"x"}' + 'segredo').digest('hex')
  assert.equal(assinar('app1', 'segredo', '{"query":"x"}', 1700000000), esperado)
  assert.match(cabecalhoAutorizacao('app1', 'segredo', '{"query":"x"}', 1700000000), /^SHA256 Credential=app1, Timestamp=1700000000, Signature=[0-9a-f]{64}$/)
})

test('normaliza produto da Shopee, convertendo comissão de fração para percentual', () => {
  const o = normalizar(
    {
      itemId: '555',
      productName: 'Fone TWS',
      priceMin: 89.9,
      priceDiscountRate: 30,
      commissionRate: 0.12,
      sales: 4200,
      ratingStar: 4.8,
      imageUrl: 'https://cf.shopee.com.br/file/abc',
      productLink: 'https://shopee.com.br/produto',
    },
    '2026-08-18T12:00:00.000Z',
  )
  assert.ok(o)
  assert.equal(o.itemId, 'shopee:555', 'id vem prefixado')
  assert.equal(o.comissaoPct, 12, '0.12 vira 12%')
  assert.equal(o.precoAtual, 89.9)
  assert.equal(o.vendas, 4200)
  assert.equal(o.imagemUrl, 'https://cf.shopee.com.br/file/abc')
  assert.ok(o.precoAnterior && o.precoAnterior > o.precoAtual, 'reconstrói o preço de antes pelo desconto')
})

test('produto sem id ou sem preço é descartado em vez de virar registro quebrado', () => {
  assert.equal(normalizar({ productName: 'sem id' }, 'agora'), undefined)
  assert.equal(normalizar({ itemId: '1', productName: 'sem preço' }, 'agora'), undefined)
})

test('fonte sem credencial explica o que fazer, não estoura genérico', async () => {
  const fonte = new FonteShopee('', '')
  const d = await fonte.disponivel()
  assert.equal(d.ok, false)
  assert.match(d.motivo!, /SHOPEE_APP_ID/)
  assert.match(d.motivo!, /affiliate\.shopee\.com\.br/)
  await assert.rejects(() => fonte.buscar(), /SHOPEE_APP_ID/)
})

test('urlImagem respeita a diferença entre os marketplaces', () => {
  assert.match(urlImagem('894230-MLA111')!, /http2\.mlstatic\.com/)
  assert.equal(urlImagem(undefined, 'https://cf.shopee.com.br/x'), 'https://cf.shopee.com.br/x')
  assert.equal(urlImagem(undefined, undefined), undefined)
})
