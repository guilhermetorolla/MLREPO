import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrir, ofertasSalvas, salvarOfertas } from '../src/db.ts'
import type { Oferta } from '../src/tipos.ts'

const base: Oferta = {
  itemId: 'ml:MLB1',
  titulo: 'Título antigo',
  url: 'https://www.mercadolivre.com.br/p/MLB1',
  precoAtual: 100,
  comissaoPct: 10,
  comissaoExtra: false,
  vistoEm: '2026-08-18T10:00:00.000Z',
}

// Regressão: a URL de 151 ofertas estava errada e a recoleta não corrigia,
// porque url/product_id/titulo ficaram de fora do UPDATE do upsert. O link
// publicado no canal saía quebrado e continuaria quebrado para sempre.
test('recoletar corrige URL, product_id e título errados', () => {
  const db = abrir(join(mkdtempSync(join(tmpdir(), 'ofertas-up-')), 'teste.db'))
  salvarOfertas(db, [base])

  salvarOfertas(db, [
    {
      ...base,
      titulo: 'Título correto',
      url: 'https://produto.mercadolivre.com.br/MLB-1-titulo-correto-_JM',
      productId: 'MLB999',
      precoAtual: 90,
    },
  ])

  const [o] = ofertasSalvas(db)
  assert.equal(o!.url, 'https://produto.mercadolivre.com.br/MLB-1-titulo-correto-_JM')
  assert.equal(o!.productId, 'MLB999')
  assert.equal(o!.titulo, 'Título correto')
  assert.equal(o!.precoAtual, 90)
  db.close()
})
