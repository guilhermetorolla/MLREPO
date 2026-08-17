import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carregarDestinos } from '../src/motor/destinos.ts'

function arquivo(conteudo: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'ofertas-'))
  const caminho = join(dir, 'destinos.json')
  writeFileSync(caminho, JSON.stringify(conteudo))
  return caminho
}

const valido = {
  id: 'g1',
  chatId: '-100123',
  nome: 'Grupo',
  janelas: ['09:00-21:00'],
  limiteDiario: 5,
  intervaloMinutos: 30,
}

test('aplica o corte padrão quando o arquivo não define um', () => {
  const cfg = carregarDestinos(arquivo({ destinos: [valido] }))
  assert.equal(cfg.corte.ganhoMinimo, 10)
  assert.equal(cfg.destinos.length, 1)
})

test('o corte do arquivo sobrescreve só o que declara', () => {
  const cfg = carregarDestinos(arquivo({ destinos: [valido], corte: { ganhoMinimo: 50 } }))
  assert.equal(cfg.corte.ganhoMinimo, 50)
  assert.equal(cfg.corte.notaMinima, 4, 'o resto do padrão permanece')
})

// Motor automático com configuração torta falha em silêncio: publica na hora
// errada ou não publica nunca. Melhor recusar a subir.
test('recusa janela em formato inválido', () => {
  assert.throws(
    () => carregarDestinos(arquivo({ destinos: [{ ...valido, janelas: ['9h às 21h'] }] })),
    /janela inválida/i,
  )
})

test('recusa dois destinos com o mesmo id', () => {
  assert.throws(
    () => carregarDestinos(arquivo({ destinos: [valido, { ...valido, chatId: '-999' }] })),
    /mesmo id/i,
  )
})

test('recusa destino sem chatId', () => {
  assert.throws(
    () => carregarDestinos(arquivo({ destinos: [{ ...valido, chatId: '' }] })),
    /chatId/i,
  )
})

test('recusa limite diário zerado', () => {
  assert.throws(
    () => carregarDestinos(arquivo({ destinos: [{ ...valido, limiteDiario: 0 }] })),
    /limiteDiario/i,
  )
})

test('recusa arquivo sem destinos', () => {
  assert.throws(() => carregarDestinos(arquivo({ destinos: [] })), /nenhum destino/i)
})

test('arquivo ausente explica o que fazer', () => {
  assert.throws(() => carregarDestinos('/caminho/que/nao/existe.json'), /destinos\.exemplo\.json/)
})
