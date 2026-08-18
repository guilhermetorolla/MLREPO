import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrir, ofertasSalvas, salvarOfertas } from '../src/db.ts'
import type { Oferta } from '../src/tipos.ts'

function bancoTemporario() {
  return abrir(join(mkdtempSync(join(tmpdir(), 'ofertas-db-')), 'teste.db'))
}

const exemplo: Oferta = {
  itemId: 'MLB1',
  productId: 'MLB2',
  titulo: 'Produto',
  url: 'https://www.mercadolivre.com.br/p/MLB1',
  precoAtual: 100,
  precoAnterior: 200,
  comissaoPct: 15,
  comissaoExtra: true,
  vendas: 5000,
  rating: 4.7,
  imagemId: '894230-MLA111390627295_052026',
  vistoEm: '2026-08-18T12:00:00.000Z',
}

// Regressão: imagemId existia no tipo, no parser e no template, mas a coluna
// nunca foi criada — a foto se perdia ao salvar, e o site saía sem imagem.
test('salvar e reler preserva TODOS os campos, inclusive a foto', () => {
  const db = bancoTemporario()
  salvarOfertas(db, [exemplo])
  const [lida] = ofertasSalvas(db)

  assert.ok(lida)
  assert.equal(lida.imagemId, exemplo.imagemId, 'imagemId precisa sobreviver ao banco')
  assert.equal(lida.titulo, exemplo.titulo)
  assert.equal(lida.precoAtual, 100)
  assert.equal(lida.precoAnterior, 200)
  assert.equal(lida.comissaoPct, 15)
  assert.equal(lida.comissaoExtra, true)
  assert.equal(lida.vendas, 5000)
  assert.equal(lida.rating, 4.7)
  assert.equal(lida.productId, 'MLB2')
  db.close()
})

test('reler uma oferta atualizada mantém a foto', () => {
  const db = bancoTemporario()
  salvarOfertas(db, [exemplo])
  salvarOfertas(db, [{ ...exemplo, precoAtual: 90 }])
  const [lida] = ofertasSalvas(db)
  assert.equal(lida!.precoAtual, 90)
  assert.equal(lida!.imagemId, exemplo.imagemId, 'update não pode zerar a foto')
  db.close()
})

test('campos opcionais ausentes voltam como undefined, não null', () => {
  const db = bancoTemporario()
  salvarOfertas(db, [
    { itemId: 'X', titulo: 'T', url: 'u', precoAtual: 10, comissaoPct: 5, comissaoExtra: false, vistoEm: 'agora' },
  ])
  const [lida] = ofertasSalvas(db)
  assert.equal(lida!.imagemId, undefined)
  assert.equal(lida!.vendas, undefined)
  assert.equal(lida!.precoAnterior, undefined)
  db.close()
})
