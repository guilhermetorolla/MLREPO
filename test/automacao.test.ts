import test from 'node:test'
import assert from 'node:assert/strict'
import {
  diaSemanaLocal,
  filtrarConteudo,
  motivoAutomacaoEsperar,
  type Automacao,
} from '../src/motor/automacao.ts'
import { pontuar } from '../src/score.ts'
import type { Oferta } from '../src/tipos.ts'

function automacao(over: Partial<Automacao> = {}): Automacao {
  return {
    id: 'a1',
    nome: 'Teste',
    ativa: true,
    diasSemana: [],
    janelas: ['09:00-21:00'],
    intervaloMinutos: 60,
    limiteDiario: 10,
    filtro: { ganhoMinimo: 10, exigirDescontoConfirmado: false },
    destinos: ['g1'],
    ...over,
  }
}

function of(over: Partial<Oferta> = {}) {
  return pontuar({
    itemId: 'MLB1',
    titulo: 'Fone Bluetooth TWS',
    url: 'u',
    precoAtual: 200,
    comissaoPct: 10,
    comissaoExtra: false,
    vendas: 5000,
    rating: 4.8,
    vistoEm: '2026-08-18T12:00:00.000Z',
    ...over,
  })
}

const em = (iso: string) => new Date(iso)

test('dia da semana usa horário de Brasília', () => {
  // 2026-08-18T02:00:00Z = 23:00 de segunda 17/08 em São Paulo.
  assert.equal(diaSemanaLocal(em('2026-08-18T02:00:00Z')), 1, 'ainda é segunda em SP')
  // 2026-08-18T12:00:00Z = 09:00 de terça 18/08.
  assert.equal(diaSemanaLocal(em('2026-08-18T12:00:00Z')), 2)
})

test('automação pausada não roda', () => {
  assert.match(motivoAutomacaoEsperar(automacao({ ativa: false }), em('2026-08-18T15:00:00Z'), undefined, 0) ?? '', /pausada/i)
})

test('automação sem destino avisa em vez de rodar em silêncio', () => {
  assert.match(motivoAutomacaoEsperar(automacao({ destinos: [] }), em('2026-08-18T15:00:00Z'), undefined, 0) ?? '', /nenhum destino/i)
})

test('respeita os dias da semana escolhidos', () => {
  const soSegunda = automacao({ diasSemana: [1] })
  // terça 18/08 às 12:00 em SP
  assert.match(motivoAutomacaoEsperar(soSegunda, em('2026-08-18T15:00:00Z'), undefined, 0) ?? '', /não é dia/i)
  const soTerca = automacao({ diasSemana: [2] })
  assert.equal(motivoAutomacaoEsperar(soTerca, em('2026-08-18T15:00:00Z'), undefined, 0), undefined)
})

test('dias vazios significa todos os dias', () => {
  assert.equal(motivoAutomacaoEsperar(automacao(), em('2026-08-18T15:00:00Z'), undefined, 0), undefined)
})

test('respeita janela, intervalo e limite da automação', () => {
  const a = automacao()
  // 05:00 em SP → fora da janela 09:00-21:00
  assert.match(motivoAutomacaoEsperar(a, em('2026-08-18T08:00:00Z'), undefined, 0) ?? '', /fora da janela/i)
  // dentro da janela, mas executou há 30 min
  assert.match(
    motivoAutomacaoEsperar(a, em('2026-08-18T15:00:00Z'), em('2026-08-18T14:30:00Z'), 0) ?? '',
    /intervalo/i,
  )
  // limite diário estourado
  assert.match(motivoAutomacaoEsperar(a, em('2026-08-18T15:00:00Z'), undefined, 10) ?? '', /limite diário/i)
})

test('filtro por palavra: incluir e excluir', () => {
  const lista = [of(), of({ itemId: 'B', titulo: 'Cafeteira Expresso' })]
  const so = filtrarConteudo(lista, { ganhoMinimo: 0, exigirDescontoConfirmado: false, palavrasIncluir: ['fone'] })
  assert.deepEqual(so.map((i) => i.oferta.itemId), ['MLB1'])

  const sem = filtrarConteudo(lista, { ganhoMinimo: 0, exigirDescontoConfirmado: false, palavrasExcluir: ['fone'] })
  assert.deepEqual(sem.map((i) => i.oferta.itemId), ['B'])
})

test('filtro por faixa de preço e comissão extra', () => {
  const lista = [
    of({ itemId: 'barato', precoAtual: 30 }),
    of({ itemId: 'caro', precoAtual: 3000 }),
    of({ itemId: 'extra', precoAtual: 200, comissaoExtra: true }),
  ]
  const faixa = filtrarConteudo(lista, {
    ganhoMinimo: 0,
    exigirDescontoConfirmado: false,
    precoMinimo: 100,
    precoMaximo: 1000,
  })
  assert.deepEqual(faixa.map((i) => i.oferta.itemId).sort(), ['extra'])

  const soExtra = filtrarConteudo(lista, {
    ganhoMinimo: 0,
    exigirDescontoConfirmado: false,
    somenteComissaoExtra: true,
  })
  assert.deepEqual(soExtra.map((i) => i.oferta.itemId), ['extra'])
})

test('filtro aplica o corte de qualidade da automação', () => {
  const lista = [of({ itemId: 'ruim', rating: 3 }), of({ itemId: 'bom' })]
  const saida = filtrarConteudo(lista, { ganhoMinimo: 10, exigirDescontoConfirmado: false, notaMinima: 4 })
  assert.deepEqual(saida.map((i) => i.oferta.itemId), ['bom'])
})

test('palavra-chave não é sensível a maiúscula', () => {
  const saida = filtrarConteudo([of({ titulo: 'FONE BLUETOOTH' })], {
    ganhoMinimo: 0,
    exigirDescontoConfirmado: false,
    palavrasIncluir: ['Fone'],
  })
  assert.equal(saida.length, 1)
})
