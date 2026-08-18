import test from 'node:test'
import assert from 'node:assert/strict'
import { Telegram } from '../src/telegram.ts'
import { pontuar } from '../src/score.ts'
import type { Oferta } from '../src/tipos.ts'

const tg = new Telegram('token-de-teste')

const item = (over: Partial<Oferta> = {}) =>
  pontuar({
    itemId: 'ml:MLB1',
    titulo: 'Fone Bluetooth TWS',
    url: 'https://www.mercadolivre.com.br/p/MLB1',
    precoAtual: 89.9,
    precoAnterior: 129.9,
    comissaoPct: 12,
    comissaoExtra: false,
    vendas: 5000,
    rating: 4.8,
    imagemId: '894230-MLA111390627295_052026',
    vistoEm: '2026-08-18T12:00:00.000Z',
    ...over,
  })

// A prévia automática do link não pode ser a fonte da imagem: ela depende de
// og:image e, com parâmetro de afiliado, o card chegou sem foto no WhatsApp.
test('oferta com foto é publicada como imagem com legenda', () => {
  assert.equal(tg.formatoDe(item(), 'https://meli.la/x'), 'foto')
})

test('sem foto conhecida, cai para texto em vez de falhar', () => {
  assert.equal(tg.formatoDe(item({ imagemId: undefined }), 'https://meli.la/x'), 'texto')
})

test('foto da Shopee (URL pronta) também vale', () => {
  const shopee = item({ imagemId: undefined, imagemUrl: 'https://cf.shopee.com.br/file/abc' })
  assert.equal(tg.formatoDe(shopee, 'https://s.shopee.com.br/x'), 'foto')
})

// O Telegram recusa o envio inteiro quando a legenda passa de 1024 caracteres.
test('legenda longa demais cai para texto, sem perder a publicação', () => {
  const gigante = item({ titulo: 'A'.repeat(1100) })
  assert.equal(tg.formatoDe(gigante, 'https://meli.la/x'), 'texto')
})

test('token vazio é recusado na construção', () => {
  assert.throws(() => new Telegram(''), /TELEGRAM_BOT_TOKEN/)
})
