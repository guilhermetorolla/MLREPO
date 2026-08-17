import test from 'node:test'
import assert from 'node:assert/strict'
import { avaliarPreco, gerarFeed, gerarHtml, posicaoNaRegua, type ItemSite } from '../src/site/template.ts'
import { pontuar } from '../src/score.ts'
import type { Oferta } from '../src/tipos.ts'

function item(over: Partial<Oferta> = {}, faixa?: ItemSite['faixa']): ItemSite {
  const oferta: Oferta = {
    itemId: 'MLB1',
    titulo: 'Produto de teste',
    url: 'https://www.mercadolivre.com.br/p/MLB1',
    precoAtual: 100,
    comissaoPct: 10,
    comissaoExtra: false,
    vistoEm: '2026-08-17T12:00:00.000Z',
    ...over,
  }
  return { item: pontuar(oferta), link: 'https://meli.la/abc', faixa }
}

test('veredito: uma leitura só não vira auditoria', () => {
  assert.equal(avaliarPreco(100, undefined), 'primeira-leitura')
  assert.equal(avaliarPreco(100, { min: 100, max: 100, amostras: 1 }), 'primeira-leitura')
})

test('veredito: reconhece o menor preço já observado', () => {
  assert.equal(avaliarPreco(80, { min: 80, max: 200, amostras: 9 }), 'menor-ja-visto')
  assert.equal(avaliarPreco(75, { min: 80, max: 200, amostras: 9 }), 'menor-ja-visto')
})

test('veredito: denuncia quando já esteve mais barato', () => {
  assert.equal(avaliarPreco(180, { min: 80, max: 200, amostras: 9 }), 'ja-esteve-menor')
})

test('veredito: tolera diferença pequena perto do mínimo', () => {
  // 90 está a 8% da amplitude (80–200) acima do mínimo.
  assert.equal(avaliarPreco(89, { min: 80, max: 200, amostras: 5 }), 'perto-do-menor')
})

test('posição na régua reflete o preço dentro da faixa', () => {
  assert.equal(posicaoNaRegua(80, { min: 80, max: 180, amostras: 4 }), 0)
  assert.equal(posicaoNaRegua(180, { min: 80, max: 180, amostras: 4 }), 100)
  assert.equal(posicaoNaRegua(130, { min: 80, max: 180, amostras: 4 }), 50)
  assert.equal(posicaoNaRegua(100, undefined), undefined, 'sem histórico não desenha régua')
})

test('html: link de afiliado sai marcado como patrocinado', () => {
  const html = gerarHtml([item()], new Date('2026-08-17T12:00:00.000Z'))
  assert.match(html, /rel="nofollow sponsored noopener"/)
  assert.match(html, /são de afiliado/i, 'divulgação de link de afiliado presente')
  assert.match(html, /não é o mercado livre/i, 'deixa claro que o site é independente')
})

test('html: escapa título malicioso', () => {
  const html = gerarHtml([item({ titulo: '<script>alert(1)</script>' })], new Date())
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.match(html, /&lt;script&gt;/)
})

test('html: sem histórico, a página diz isso em vez de inventar régua', () => {
  const html = gerarHtml([item()], new Date())
  assert.match(html, /primeira leitura deste preço/i)
  assert.ok(!html.includes('class="trilho"'))
})

test('feed json traz o veredito e os extremos observados', () => {
  const feed = JSON.parse(
    gerarFeed([item({ precoAtual: 80 }, { min: 80, max: 200, amostras: 9 })], new Date()),
  )
  assert.equal(feed.ofertas[0].veredito, 'menor-ja-visto')
  assert.equal(feed.ofertas[0].menor_observado, 80)
  assert.equal(feed.ofertas[0].maior_observado, 200)
  assert.equal(feed.ofertas[0].leituras, 9)
})
