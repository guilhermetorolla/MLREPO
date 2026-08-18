import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrir, eventos } from '../src/db.ts'
import { SessaoExpirada, avisarSessaoCaida, ehSessaoExpirada, marcarSessaoOk } from '../src/motor/aviso.ts'

const T = (h: number) => new Date(`2026-08-18T${String(h).padStart(2, '0')}:00:00.000Z`)

function banco() {
  return abrir(join(mkdtempSync(join(tmpdir(), 'ofertas-aviso-')), 'teste.db'))
}

/** Coleta os textos enviados, no lugar do Telegram. */
function espiao() {
  const enviados: string[] = []
  return { enviados, enviar: async (t: string) => void enviados.push(t) }
}

test('a primeira queda da sessão avisa', async () => {
  const db = banco()
  const tg = espiao()

  const avisou = await avisarSessaoCaida({ db, agora: T(14), enviar: tg.enviar })

  assert.equal(avisou, true)
  assert.equal(tg.enviados.length, 1)
  // O aviso só serve se disser o que fazer: sem isso vira notificação de susto.
  assert.match(tg.enviados[0]!, /npm run entrar/)
  db.close()
})

test('rodada seguinte não repete o aviso', async () => {
  const db = banco()
  const tg = espiao()

  await avisarSessaoCaida({ db, agora: T(14), enviar: tg.enviar })
  // O motor roda a cada 15 min. Sem silêncio, uma sessão caída viraria 4
  // mensagens por hora até alguém relogar — e aviso que vira ruído é ignorado.
  const segundo = await avisarSessaoCaida({ db, agora: new Date(T(14).getTime() + 15 * 60_000), enviar: tg.enviar })

  assert.equal(segundo, false)
  assert.equal(tg.enviados.length, 1)
  db.close()
})

test('passado o silêncio, lembra de novo', async () => {
  const db = banco()
  const tg = espiao()

  await avisarSessaoCaida({ db, agora: T(14), enviar: tg.enviar, silencioHoras: 6 })
  const depois = await avisarSessaoCaida({ db, agora: T(21), enviar: tg.enviar, silencioHoras: 6 })

  assert.equal(depois, true)
  assert.equal(tg.enviados.length, 2)
  db.close()
})

test('sessão que voltou e caiu de novo avisa na hora, sem esperar o silêncio', async () => {
  const db = banco()
  const tg = espiao()

  await avisarSessaoCaida({ db, agora: T(14), enviar: tg.enviar, silencioHoras: 6 })
  marcarSessaoOk(db)
  // Nova queda 1h depois: é um incidente novo, não a repetição do anterior.
  const novaQueda = await avisarSessaoCaida({ db, agora: T(15), enviar: tg.enviar, silencioHoras: 6 })

  assert.equal(novaQueda, true)
  assert.equal(tg.enviados.length, 2)
  db.close()
})

test('o aviso fica registrado nos eventos, mesmo se o Telegram falhar', async () => {
  const db = banco()

  const avisou = await avisarSessaoCaida({
    db,
    agora: T(14),
    enviar: async () => {
      throw new Error('Telegram sendMessage: chat not found')
    },
  })

  // Telegram fora do ar não pode apagar o rastro: o painel continua sabendo.
  assert.equal(avisou, false)
  const registro = eventos(db).find((e) => e.mensagem.includes('sessão'))
  assert.ok(registro, 'esperava evento de sessão expirada')
  assert.equal(registro!.nivel, 'erro')
  db.close()
})

test('reconhece a queda de sessão e ignora erro de outra natureza', () => {
  assert.equal(ehSessaoExpirada(new SessaoExpirada('Sessão do Mercado Livre expirou')), true)
  assert.equal(ehSessaoExpirada(new Error('Sessão do Mercado Livre expirou — refaça o login')), true)
  assert.equal(ehSessaoExpirada(new Error('Telegram sendMessage: chat not found')), false)
  assert.equal(ehSessaoExpirada(undefined), false)
})
