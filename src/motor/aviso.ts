import type Database from 'better-sqlite3'
import { apagarConfig, gravarConfig, lerConfig, registrarEvento } from '../db.ts'

/**
 * A sessão do Mercado Livre no perfil do navegador caiu.
 *
 * Vale a classe própria porque essa falha tem tratamento diferente de
 * qualquer outra: ela derruba a rodada inteira (todo link nasce da mesma
 * sessão) e só uma pessoa resolve, refazendo o login.
 */
export class SessaoExpirada extends Error {
  constructor(mensagem = 'Sessão do Mercado Livre expirou — refaça o login no perfil do navegador.') {
    super(mensagem)
    this.name = 'SessaoExpirada'
  }
}

/** Chave onde fica a hora do último aviso. Ausente = nenhuma queda em aberto. */
const CHAVE = 'aviso_sessao_em'

const SILENCIO_PADRAO_HORAS = 6

export function ehSessaoExpirada(e: unknown): boolean {
  if (e instanceof SessaoExpirada) return true
  // O erro também chega como Error comum quando atravessa camadas antigas.
  return e instanceof Error && /sess[ãa]o do mercado livre expirou/i.test(e.message)
}

/**
 * Avisa você de que o motor parou por sessão caída — no máximo uma vez por
 * incidente, com lembrete só depois do silêncio.
 *
 * O motor roda a cada 15 minutos. Avisar em toda rodada transformaria uma
 * sessão caída em quatro mensagens por hora, e aviso que vira ruído deixa de
 * ser lido justamente quando importa.
 *
 * Devolve se a mensagem chegou a ser enviada.
 */
export async function avisarSessaoCaida(opts: {
  db: Database.Database
  agora: Date
  enviar: (texto: string) => Promise<void>
  silencioHoras?: number
}): Promise<boolean> {
  const { db, agora, enviar } = opts
  const silencio = (opts.silencioHoras ?? SILENCIO_PADRAO_HORAS) * 3_600_000

  const ultimo = lerConfig(db, CHAVE)
  const primeiraDoIncidente = !ultimo
  const venceuSilencio = ultimo ? agora.getTime() - Date.parse(ultimo) >= silencio : true

  if (!primeiraDoIncidente && !venceuSilencio) return false

  // O registro vem ANTES do envio: se o Telegram estiver fora do ar, o painel
  // ainda mostra por que o motor parou. Rastro perdido é o que faz um motor
  // automático passar dias quebrado sem ninguém perceber.
  registrarEvento(
    db,
    'erro',
    'motor',
    'sessão do Mercado Livre expirou',
    'nenhuma publicação sai até o login ser refeito com `npm run entrar`',
  )
  gravarConfig(db, CHAVE, agora.toISOString())

  try {
    await enviar(TEXTO)
    return true
  } catch (e) {
    console.error(`[aviso] não consegui te avisar pelo Telegram: ${(e as Error).message}`)
    return false
  }
}

/**
 * A sessão voltou a funcionar. Zera o incidente para que a PRÓXIMA queda
 * avise na hora, em vez de ficar presa ao silêncio da queda anterior.
 */
export function marcarSessaoOk(db: Database.Database): void {
  if (lerConfig(db, CHAVE)) apagarConfig(db, CHAVE)
}

const TEXTO = [
  '⚠️ <b>Motor parado</b>',
  '',
  'A sessão do Mercado Livre no perfil do navegador expirou, então nenhum link novo',
  'é gerado e nada é publicado.',
  '',
  'Para voltar ao ar:',
  '<code>cd ~/pessoal/ofertas-ml && npm run entrar</code>',
  '',
  'Faça o login na janela que abrir. O motor volta sozinho na rodada seguinte.',
].join('\n')
