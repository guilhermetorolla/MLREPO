import test from 'node:test'
import assert from 'node:assert/strict'
import { dentroDaJanela, motivoParaEsperar, proximoHorario } from '../src/motor/agenda.ts'
import type { Destino, Publicacao } from '../src/motor/tipos.ts'

const destino: Destino = {
  id: 'grupo-teste',
  chatId: '-100123',
  nome: 'Grupo de teste',
  janelas: ['09:00-12:00', '14:00-21:00'],
  limiteDiario: 6,
  intervaloMinutos: 45,
}

// Datas em UTC; o horário de Brasília é UTC-3.
const em = (iso: string) => new Date(iso)

test('janela: respeita horário local de Brasília, não UTC', () => {
  // 12:00Z = 09:00 em São Paulo → dentro da primeira janela.
  assert.equal(dentroDaJanela(destino, em('2026-08-17T12:00:00Z')), true)
  // 11:00Z = 08:00 em SP → fora, ainda não abriu.
  assert.equal(dentroDaJanela(destino, em('2026-08-17T11:00:00Z')), false)
  // 03:00Z = 00:00 em SP → madrugada, fora.
  assert.equal(dentroDaJanela(destino, em('2026-08-17T03:00:00Z')), false)
})

test('janela: o intervalo entre as faixas fica de fora', () => {
  // 16:00Z = 13:00 em SP → entre as duas janelas.
  assert.equal(dentroDaJanela(destino, em('2026-08-17T16:00:00Z')), false)
  // 17:00Z = 14:00 em SP → abriu a segunda janela.
  assert.equal(dentroDaJanela(destino, em('2026-08-17T17:00:00Z')), true)
})

test('limite diário conta só o dia local corrente', () => {
  const agora = em('2026-08-17T18:00:00Z') // 15:00 em SP
  const seis: Publicacao[] = Array.from({ length: 6 }, (_, i) => ({
    itemId: `MLB${i}`,
    destinoId: 'grupo-teste',
    publicadoEm: `2026-08-17T1${i}:00:00Z`,
  }))
  assert.match(motivoParaEsperar(destino, seis, agora) ?? '', /limite diário/i)

  // As mesmas seis, mas de ontem: não bloqueiam hoje.
  const ontem = seis.map((p) => ({ ...p, publicadoEm: p.publicadoEm.replace('-17T', '-16T') }))
  assert.equal(motivoParaEsperar(destino, ontem, agora), undefined)
})

test('intervalo mínimo entre posts é respeitado', () => {
  const agora = em('2026-08-17T18:00:00Z')
  const recente: Publicacao[] = [
    { itemId: 'MLB1', destinoId: 'grupo-teste', publicadoEm: '2026-08-17T17:30:00Z' }, // 30 min
  ]
  assert.match(motivoParaEsperar(destino, recente, agora) ?? '', /intervalo/i)

  const antigo: Publicacao[] = [
    { itemId: 'MLB1', destinoId: 'grupo-teste', publicadoEm: '2026-08-17T17:00:00Z' }, // 60 min
  ]
  assert.equal(motivoParaEsperar(destino, antigo, agora), undefined)
})

test('publicação de outro destino não bloqueia este', () => {
  const agora = em('2026-08-17T18:00:00Z')
  const deOutro: Publicacao[] = [
    { itemId: 'MLB1', destinoId: 'outro-grupo', publicadoEm: '2026-08-17T17:59:00Z' },
  ]
  assert.equal(motivoParaEsperar(destino, deOutro, agora), undefined)
})

test('destino desligado não publica', () => {
  const off = { ...destino, ativo: false }
  assert.match(motivoParaEsperar(off, [], em('2026-08-17T18:00:00Z')) ?? '', /desligado/i)
})

test('fora da janela, informa quando abre', () => {
  const agora = em('2026-08-17T11:00:00Z') // 08:00 em SP
  assert.match(motivoParaEsperar(destino, [], agora) ?? '', /fora da janela/i)
  assert.equal(proximoHorario(destino, agora), '09:00')
})

test('depois da última janela, o próximo horário é no dia seguinte', () => {
  const agora = em('2026-08-18T01:00:00Z') // 22:00 de 17/08 em SP
  assert.equal(proximoHorario(destino, agora), '09:00')
})
