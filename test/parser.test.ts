import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsearFeed, parsearVendas } from '../src/parser.ts'

const bruto = JSON.parse(
  readFileSync(new URL('./fixtures/hub-search.json', import.meta.url), 'utf8'),
)

test('extrai os campos que importam de um card real', () => {
  const ofertas = parsearFeed(bruto, { agora: new Date('2026-08-17T18:00:00.000Z') })
  const creatina = ofertas.find((o) => o.itemId === 'ml:MLB6713010960')

  assert.ok(creatina, 'card da creatina foi parseado')
  assert.equal(creatina.marketplace, 'ml', 'oferta carrega o marketplace de origem')
  assert.equal(creatina.comissaoPct, 22, 'percentual vem de chip.label.text')
  assert.equal(creatina.comissaoExtra, true, 'EXTRAS no pill marca comissão extra')
  assert.equal(creatina.precoAtual, 78.9, 'base da comissão é o preço ATUAL')
  assert.equal(creatina.precoAnterior, 199.9)
  assert.equal(creatina.vendas, 750_000, '"+750mil vendidos" vira número')
  assert.equal(creatina.rating, 4.8)
  assert.ok(creatina.url.startsWith('https://'), 'URL normalizada com esquema')
  assert.ok(!creatina.url.includes('?'), 'URL sem parâmetros de rastreio')
})

// O feed usa DOIS formatos de chip, descoberto ao rodar contra os 18 cards reais:
//   com extra  → pill.text "{ganancia} {extra}" + values[], percentual em chip.label.text
//   sem extra  → pill.text "GANHOS 12%" direto, SEM chip.label
// A primeira versão do parser só entendia o primeiro e descartava metade do feed.
test('entende o chip do formato SEM comissão extra (percentual dentro do pill.text)', () => {
  const ofertas = parsearFeed(bruto)
  const relogio = ofertas.find((o) => o.itemId === 'ml:MLB66686279')
  assert.ok(relogio, 'card de comissão normal NÃO pode ser descartado')
  assert.equal(relogio.comissaoExtra, false)
  assert.equal(relogio.comissaoPct, 12)
  assert.equal(relogio.precoAtual, 509)
})

test('card sem chip de comissão é descartado', () => {
  const ofertas = parsearFeed(bruto)
  assert.equal(
    ofertas.find((o) => o.itemId === 'ml:MLB-SEM-CHIP'),
    undefined,
    'sem comissão conhecida não entra na fila',
  )
})

test('parsearVendas entende os formatos do card', () => {
  assert.equal(parsearVendas('| +750mil vendidos'), 750_000)
  assert.equal(parsearVendas('| +100 vendidos'), 100)
  assert.equal(parsearVendas('| +5mil vendidos'), 5_000)
  assert.equal(parsearVendas('| +1,5mil vendidos'), 1_500)
  assert.equal(parsearVendas('sem numero'), undefined)
})

// Teste de contrato: se o ML mudar a estrutura, este falha ALTO em vez de
// devolver silenciosamente uma lista vazia.
test('contrato: feed sem polycards é erro explícito, não lista vazia', () => {
  assert.throws(() => parsearFeed({ qualquer: 'coisa' }), /estrutura inesperada/i)
})
