import test from 'node:test'
import assert from 'node:assert/strict'
import { MODELO_PADRAO, marcacoesDesconhecidas, montarMensagem } from '../src/motor/mensagem.ts'
import { pontuar } from '../src/score.ts'
import type { Oferta } from '../src/tipos.ts'

const item = (over: Partial<Oferta> = {}) =>
  pontuar({
    itemId: 'MLB1',
    titulo: 'Fone Bluetooth TWS',
    url: 'u',
    precoAtual: 89.9,
    precoAnterior: 129.9,
    comissaoPct: 12,
    comissaoExtra: false,
    vendas: 5000,
    rating: 4.8,
    vistoEm: '2026-08-18T12:00:00.000Z',
    ...over,
  })

test('substitui as marcações com formato brasileiro', () => {
  const txt = montarMensagem('{titulo} por {preco} — {vendas} vendidos, nota {nota}', {
    item: item(),
    link: 'https://meli.la/x',
  })
  assert.equal(txt, 'Fone Bluetooth TWS por R$ 89,90 — 5.000 vendidos, nota 4,8')
})

// Sem bloco condicional a mensagem sai com "de  ·  OFF" quando não há preço
// anterior — exatamente o tipo de detalhe que faz o grupo desconfiar.
test('bloco de desconto some quando não há preço anterior', () => {
  const com = montarMensagem(MODELO_PADRAO, { item: item(), link: 'L' })
  assert.match(com, /de ~R\$ 129,90~ · 30% OFF/)

  const sem = montarMensagem(MODELO_PADRAO, {
    item: item({ precoAnterior: undefined }),
    link: 'L',
  })
  assert.ok(!sem.includes('de ~'))
  assert.ok(!sem.includes('OFF'))
})

test('bloco de cupom só aparece quando o cupom aplica', () => {
  const sem = montarMensagem(MODELO_PADRAO, { item: item(), link: 'L' })
  assert.ok(!sem.includes('cupom'))

  const com = montarMensagem(MODELO_PADRAO, {
    item: item(),
    link: 'L',
    cupom: { aplica: true, precoFinal: 71.92, desconto: 17.98, cupom: { codigo: 'BL26R20', percentual: 20 } },
  })
  assert.match(com, /cupom \*BL26R20\*/)
  assert.match(com, /R\$ 71,92/)
})

test('desconto trunca, como no site e no card do ML', () => {
  // 129,90 → 89,90 dá 30,79%
  assert.match(montarMensagem('{desconto}', { item: item(), link: 'L' }), /^30%$/)
})

test('marcação desconhecida é preservada, não vira vazio silencioso', () => {
  const txt = montarMensagem('{titulo} {inventada}', { item: item(), link: 'L' })
  assert.match(txt, /\{inventada\}/)
  assert.deepEqual(marcacoesDesconhecidas('{titulo} {inventada} {outra}'), ['inventada', 'outra'])
})

test('não sobra linha em branco dupla quando um bloco é removido', () => {
  const txt = montarMensagem(MODELO_PADRAO, { item: item({ precoAnterior: undefined }), link: 'L' })
  assert.ok(!/\n{3,}/.test(txt))
})
