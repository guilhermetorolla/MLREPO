import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { assinaturaV4, canonicalRequest, carimbos, normalizar, FonteAmazon, LinkAmazon } from '../src/fontes/amazon.ts'

// A AWS deriva a chave em quatro etapas encadeadas. Errar a ordem devolve 403
// genérico, sem dizer onde — por isso cada etapa tem verificação própria.
test('assinatura V4 encadeia data, região, serviço e aws4_request', () => {
  const kData = createHmac('sha256', 'AWS4segredo').update('20260818').digest()
  const kRegiao = createHmac('sha256', kData).update('us-east-1').digest()
  const kServico = createHmac('sha256', kRegiao).update('ProductAdvertisingAPI').digest()
  const kFinal = createHmac('sha256', kServico).update('aws4_request').digest()
  const esperado = createHmac('sha256', kFinal).update('conteudo').digest('hex')

  assert.equal(
    assinaturaV4('segredo', '20260818', 'us-east-1', 'ProductAdvertisingAPI', 'conteudo'),
    esperado,
  )
})

test('cabeçalhos assinados saem em minúsculo e ordenados', () => {
  const { assinados } = canonicalRequest('POST', '/paapi5/searchitems', {
    'X-Amz-Date': '20260818T120000Z',
    host: 'webservices.amazon.com.br',
    'Content-Type': 'application/json',
  }, '{}')
  assert.equal(assinados, 'content-type;host;x-amz-date')
})

test('carimbo de data segue o formato exigido pela AWS', () => {
  const { data, carimbo } = carimbos(new Date('2026-08-18T12:34:56.789Z'))
  assert.equal(data, '20260818')
  assert.equal(carimbo, '20260818T123456Z')
})

test('normaliza item da Amazon reconstruindo o preço anterior pela economia', () => {
  const o = normalizar(
    {
      ASIN: 'B0ABC123',
      DetailPageURL: 'https://www.amazon.com.br/dp/B0ABC123',
      ItemInfo: { Title: { DisplayValue: 'Fone TWS' } },
      Offers: { Listings: [{ Price: { Amount: 89.9, Savings: { Amount: 40 } } }] },
      Images: { Primary: { Large: { URL: 'https://m.media-amazon.com/x.jpg' } } },
      CustomerReviews: { StarRating: { Value: 4.6 } },
    },
    '2026-08-18T12:00:00.000Z',
  )
  assert.ok(o)
  assert.equal(o.itemId, 'amazon:B0ABC123')
  assert.equal(o.precoAtual, 89.9)
  assert.equal(o.precoAnterior, 129.9, '89,90 + 40 de economia')
  assert.equal(o.rating, 4.6)
  assert.equal(o.comissaoPct, 0, 'a PA-API não devolve comissão; 0 é honesto, inventar não seria')
})

test('item sem ASIN ou sem preço é descartado', () => {
  assert.equal(normalizar({ ItemInfo: { Title: { DisplayValue: 'x' } } }, 'agora'), undefined)
  assert.equal(normalizar({ ASIN: 'B1', Offers: { Listings: [] } }, 'agora'), undefined)
})

test('sem credencial, explica inclusive o requisito de vendas', async () => {
  const d = await new FonteAmazon('', '', '').disponivel()
  assert.equal(d.ok, false)
  assert.match(d.motivo!, /3 vendas qualificadas/)
})

test('link da Amazon é a URL do produto com a tag — sem API e sem navegador', async () => {
  const links = await new LinkAmazon('minhatag-20').gerar([
    {
      itemId: 'amazon:B0ABC123',
      titulo: 'x',
      url: 'https://www.amazon.com.br/dp/B0ABC123',
      precoAtual: 10,
      comissaoPct: 0,
      comissaoExtra: false,
      vistoEm: 'agora',
    },
  ])
  assert.equal(links.get('amazon:B0ABC123'), 'https://www.amazon.com.br/dp/B0ABC123?tag=minhatag-20')
})
