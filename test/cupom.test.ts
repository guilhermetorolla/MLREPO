import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarCupom, melhorCupom, type Cupom } from '../src/motor/cupom.ts'
import type { Oferta } from '../src/tipos.ts'

const oferta = (over: Partial<Oferta> = {}): Oferta => ({
  itemId: 'MLB1',
  titulo: 'Fone Bluetooth TWS à prova d água',
  url: 'u',
  precoAtual: 100,
  comissaoPct: 10,
  comissaoExtra: false,
  vistoEm: '2026-08-18T12:00:00.000Z',
  ...over,
})

const agora = new Date('2026-08-18T12:00:00.000Z')

test('percentual simples calcula o preço final', () => {
  const r = aplicarCupom({ codigo: 'X', percentual: 20 }, oferta(), agora)
  assert.equal(r.aplica, true)
  assert.equal(r.desconto, 20)
  assert.equal(r.precoFinal, 80)
})

test('teto limita o abatimento', () => {
  // 20% de 1000 = 200, mas o teto é 50.
  const r = aplicarCupom({ codigo: 'X', percentual: 20, tetoDesconto: 50 }, oferta({ precoAtual: 1000 }), agora)
  assert.equal(r.desconto, 50)
  assert.equal(r.precoFinal, 950)
})

test('produto abaixo da compra mínima não recebe o cupom', () => {
  const r = aplicarCupom({ codigo: 'X', percentual: 20, compraMinima: 150 }, oferta(), agora)
  assert.equal(r.aplica, false)
  assert.match(r.motivo!, /compra mínima/i)
})

test('cupom vencido ou fora da janela não entra', () => {
  assert.match(
    aplicarCupom({ codigo: 'X', percentual: 10, validoAte: '2026-08-17T00:00:00Z' }, oferta(), agora).motivo!,
    /vencido/i,
  )
  assert.match(
    aplicarCupom({ codigo: 'X', percentual: 10, validoDe: '2026-08-19T00:00:00Z' }, oferta(), agora).motivo!,
    /não começou/i,
  )
})

test('categoria e item restringem onde o cupom vale', () => {
  assert.equal(aplicarCupom({ codigo: 'X', percentual: 10, categorias: ['fone'] }, oferta(), agora).aplica, true)
  assert.match(
    aplicarCupom({ codigo: 'X', percentual: 10, categorias: ['cafeteira'] }, oferta(), agora).motivo!,
    /categoria/i,
  )
  assert.match(
    aplicarCupom({ codigo: 'X', percentual: 10, itens: ['OUTRO'] }, oferta(), agora).motivo!,
    /não vale para este item/i,
  )
})

// Prometer preço menor do que o cliente vai pagar destrói a confiança do grupo
// mais rápido que qualquer outra coisa.
test('desconto arredonda para baixo, nunca prometendo mais do que dá', () => {
  // 33% de 10,00 = 3,30 exato; 33% de 10,01 = 3,3033 → 3,30
  const r = aplicarCupom({ codigo: 'X', percentual: 33 }, oferta({ precoAtual: 10.01 }), agora)
  assert.equal(r.desconto, 3.3)
  assert.equal(r.precoFinal, 6.71)
})

test('cupom sem regra de desconto é recusado em vez de virar zero', () => {
  const r = aplicarCupom({ codigo: 'X' }, oferta(), agora)
  assert.equal(r.aplica, false)
  assert.match(r.motivo!, /sem percentual/i)
})

test('melhorCupom escolhe o que deixa o preço final menor', () => {
  const cupons: Cupom[] = [
    { codigo: 'DEZ', percentual: 10 },
    { codigo: 'FIXO25', valorFixo: 25 },
    { codigo: 'VENCIDO', percentual: 90, validoAte: '2026-01-01T00:00:00Z' },
  ]
  const r = melhorCupom(cupons, oferta(), agora)
  assert.equal(r?.cupom.codigo, 'FIXO25')
  assert.equal(r?.precoFinal, 75)
})

test('nenhum cupom aplicável devolve undefined, sem inventar', () => {
  assert.equal(melhorCupom([{ codigo: 'A', percentual: 10, compraMinima: 999 }], oferta(), agora), undefined)
})
