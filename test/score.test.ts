import test from 'node:test'
import assert from 'node:assert/strict'
import { pontuar, ranquear } from '../src/score.ts'
import type { Oferta } from '../src/tipos.ts'

function oferta(over: Partial<Oferta> = {}): Oferta {
  return {
    itemId: 'MLB1',
    titulo: 'Produto',
    url: 'https://www.mercadolivre.com.br/p/MLB1',
    precoAtual: 100,
    comissaoPct: 10,
    comissaoExtra: false,
    vistoEm: '2026-08-17T12:00:00.000Z',
    ...over,
  }
}

test('ganho é em reais, não em percentual', () => {
  // Caso real do hub: o compressor tem percentual MUITO maior, mas rende menos.
  const compressor = oferta({ itemId: 'MLB-C', precoAtual: 66, comissaoPct: 62 })
  const bicicleta = oferta({ itemId: 'MLB-B', precoAtual: 465.88, comissaoPct: 16 })

  assert.equal(Math.round(pontuar(compressor).ganhoReais * 100) / 100, 40.92)
  assert.equal(Math.round(pontuar(bicicleta).ganhoReais * 100) / 100, 74.54)

  const [primeiro] = ranquear([compressor, bicicleta])
  assert.equal(primeiro!.oferta.itemId, 'MLB-B', 'quem rende mais reais vem primeiro')
})

test('desconto sem histórico próprio não infla o score', () => {
  const semHistorico = oferta({ itemId: 'MLB-S', precoAtual: 80, precoAnterior: 200 })
  const comHistorico = oferta({ itemId: 'MLB-H', precoAtual: 80, precoAnterior: 200 })

  const a = pontuar(semHistorico)
  const b = pontuar(comHistorico, {
    historico: { itemId: 'MLB-H', menorPreco: 150, menorPrecoEm: '2026-07-01', amostras: 9 },
  })

  assert.ok(b.score > a.score, 'desconto confirmado por histórico vale mais')
  assert.ok(
    a.motivos.some((m) => m.includes('não confirmado')),
    'sem histórico o desconto é marcado como não confirmado',
  )
})

test('desconto desmentido pelo histórico penaliza', () => {
  // Card diz "60% OFF" de 200 para 80, mas nós já vimos esse item a 79.
  const inflado = oferta({ itemId: 'MLB-F', precoAtual: 80, precoAnterior: 200 })
  const r = pontuar(inflado, {
    historico: { itemId: 'MLB-F', menorPreco: 79, menorPrecoEm: '2026-08-01', amostras: 12 },
  })
  assert.ok(r.motivos.some((m) => m.includes('desconto duvidoso')))
  assert.ok(r.score < pontuar(oferta({ itemId: 'MLB-F', precoAtual: 80 })).score + 1)
})

test('comissão extra expirada não conta como extra', () => {
  const recente = oferta({ comissaoExtra: true, vistoEm: '2026-08-17T12:00:00.000Z' })
  const velha = oferta({ comissaoExtra: true, vistoEm: '2026-08-01T12:00:00.000Z' })
  const agora = new Date('2026-08-17T18:00:00.000Z')

  assert.ok(pontuar(recente, { agora }).motivos.some((m) => m.includes('comissão extra')))
  assert.ok(pontuar(velha, { agora }).motivos.some((m) => m.includes('leitura vencida')))
})

test('produto em cooldown é descartado do ranking', () => {
  const a = oferta({ itemId: 'MLB-A' })
  const b = oferta({ itemId: 'MLB-B', precoAtual: 50 })
  const saida = ranquear([a, b], { publicadosRecentemente: new Set(['MLB-A']) })
  assert.deepEqual(saida.map((o) => o.oferta.itemId), ['MLB-B'])
})

test('ranking evita monotonia de categoria', () => {
  const ofertas = [
    oferta({ itemId: '1', categoria: 'Beleza', precoAtual: 1000, comissaoPct: 20 }),
    oferta({ itemId: '2', categoria: 'Beleza', precoAtual: 990, comissaoPct: 20 }),
    oferta({ itemId: '3', categoria: 'Ferramentas', precoAtual: 900, comissaoPct: 20 }),
  ]
  const saida = ranquear(ofertas)
  assert.notEqual(saida[1]!.oferta.categoria, 'Beleza', 'não repete categoria em sequência')
})

test('oferta sem comissão não entra', () => {
  const saida = ranquear([oferta({ itemId: 'X', comissaoPct: 0 })])
  assert.equal(saida.length, 0)
})
