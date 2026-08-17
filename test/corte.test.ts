import test from 'node:test'
import assert from 'node:assert/strict'
import { aprovado, primeiraQuePassa } from '../src/motor/corte.ts'
import { pontuar } from '../src/score.ts'
import type { RegraDeCorte } from '../src/motor/tipos.ts'
import type { Oferta } from '../src/tipos.ts'

const regra: RegraDeCorte = {
  ganhoMinimo: 10,
  exigirDescontoConfirmado: false,
  notaMinima: 4,
  vendasMinimas: 100,
}

function of(over: Partial<Oferta> = {}): Oferta {
  return {
    itemId: 'MLB1',
    titulo: 'Produto',
    url: 'https://www.mercadolivre.com.br/p/MLB1',
    precoAtual: 200,
    comissaoPct: 10,
    comissaoExtra: false,
    vendas: 5000,
    rating: 4.8,
    vistoEm: '2026-08-17T12:00:00.000Z',
    ...over,
  }
}

test('aprova quem passa em tudo', () => {
  assert.equal(aprovado(pontuar(of()), regra).ok, true)
})

test('reprova por ganho abaixo do mínimo, dizendo o número', () => {
  const r = aprovado(pontuar(of({ precoAtual: 50, comissaoPct: 10 })), regra) // R$ 5
  assert.equal(r.ok, false)
  assert.match(r.motivo!, /ganho R\$ 5,00 < R\$ 10,00/)
})

test('reprova por nota baixa e por item sem nota', () => {
  assert.match(aprovado(pontuar(of({ rating: 3.5 })), regra).motivo!, /nota/i)
  assert.match(aprovado(pontuar(of({ rating: undefined })), regra).motivo!, /sem nota/i)
})

test('reprova por poucas vendas', () => {
  assert.match(aprovado(pontuar(of({ vendas: 12 })), regra).motivo!, /vendas/i)
})

test('preço acima do teto reprova quando o teto existe', () => {
  const comTeto = { ...regra, precoMaximo: 500 }
  assert.equal(aprovado(pontuar(of({ precoAtual: 400 })), comTeto).ok, true)
  assert.match(aprovado(pontuar(of({ precoAtual: 900 })), comTeto).motivo!, /preço/i)
})

test('exigir desconto confirmado barra quem não tem histórico', () => {
  const exigente = { ...regra, exigirDescontoConfirmado: true }
  const semHistorico = pontuar(of({ precoAnterior: 400 }))
  assert.match(aprovado(semHistorico, exigente).motivo!, /desconto não confirmado/i)

  const comHistorico = pontuar(of({ precoAtual: 200, precoAnterior: 400 }), {
    historico: { itemId: 'MLB1', menorPreco: 300, menorPrecoEm: '2026-07-01', amostras: 8 },
  })
  assert.equal(aprovado(comHistorico, exigente).ok, true)
})

test('primeiraQuePassa devolve a melhor aprovada e ignora as bloqueadas', () => {
  const fila = [
    pontuar(of({ itemId: 'A', precoAtual: 30, comissaoPct: 10 })), // ganho R$ 3 → reprova
    pontuar(of({ itemId: 'B', precoAtual: 300, comissaoPct: 20 })), // R$ 60 → passa
    pontuar(of({ itemId: 'C', precoAtual: 500, comissaoPct: 20 })), // R$ 100 → passa
  ]
  const escolhida = primeiraQuePassa(fila, regra, new Set(['C']))
  assert.equal(escolhida?.oferta.itemId, 'B', 'C está bloqueada, A não passa no corte')
})

test('primeiraQuePassa devolve undefined quando ninguém passa', () => {
  const fila = [pontuar(of({ precoAtual: 20, comissaoPct: 5 }))]
  assert.equal(primeiraQuePassa(fila, regra, new Set()), undefined)
})
