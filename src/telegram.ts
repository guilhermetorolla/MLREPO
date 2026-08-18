import { urlImagem, type OfertaPontuada } from './tipos.ts'

/**
 * O Telegram corta legenda de foto em 1024 caracteres. Acima disso a API
 * recusa o envio inteiro, então o motor cai para mensagem de texto.
 */
const LIMITE_LEGENDA = 1024

const API = 'https://api.telegram.org/bot'

export class Telegram {
  // Campo declarado + atribuição explícita: o Node roda TypeScript em
  // "strip-only" e NÃO aceita parameter property (`constructor(private x)`).
  // O tsc aceita, então o erro só aparece na execução.
  readonly #token: string

  constructor(token: string) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN ausente — veja env.exemplo')
    this.#token = token
  }

  private async chamar(metodo: string, corpo: unknown): Promise<any> {
    const r = await fetch(`${API}${this.#token}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    const j = (await r.json()) as { ok?: boolean; description?: string; result?: unknown }
    if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description ?? r.status}`)
    return j.result
  }

  /** Manda a oferta para VOCÊ decidir. Nada vai ao canal sem esse passo. */
  async pedirAprovacao(chatId: string, item: OfertaPontuada, link: string): Promise<void> {
    const foto = urlImagem(item.oferta.imagemId, item.oferta.imagemUrl)
    const texto = montarTexto(item, link)

    if (foto && texto.length <= LIMITE_LEGENDA) {
      await this.chamar('sendPhoto', {
        chat_id: chatId,
        photo: foto,
        caption: texto,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Publicar', callback_data: `ok:${item.oferta.itemId}` },
              { text: '❌ Descartar', callback_data: `no:${item.oferta.itemId}` },
            ],
          ],
        },
      })
      return
    }

    await this.chamar('sendMessage', {
      chat_id: chatId,
      text: texto,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: false },
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Publicar', callback_data: `ok:${item.oferta.itemId}` },
            { text: '❌ Descartar', callback_data: `no:${item.oferta.itemId}` },
          ],
        ],
      },
    })
  }

  /**
   * Publica com a FOTO do produto e o texto como legenda.
   *
   * Não dá para contar com a prévia automática do link: ela depende de o site
   * devolver og:image, e a URL com parâmetros de afiliado não devolveu — o
   * card chegou só com título e endereço. Post de oferta sem imagem converte
   * muito menos, então a foto vai explícita.
   *
   * Sem foto conhecida, ou com legenda longa demais, cai para texto.
   */
  async publicar(canal: string, item: OfertaPontuada, link: string): Promise<void> {
    const texto = montarTextoPublico(item, link)
    const foto = urlImagem(item.oferta.imagemId, item.oferta.imagemUrl)

    if (foto && texto.length <= LIMITE_LEGENDA) {
      try {
        await this.chamar('sendPhoto', {
          chat_id: canal,
          photo: foto,
          caption: texto,
          parse_mode: 'HTML',
        })
        return
      } catch (e) {
        // Imagem fora do ar ou recusada pelo Telegram: a oferta ainda vale,
        // então segue como texto em vez de perder a publicação.
        console.warn(`[telegram] foto recusada, enviando como texto: ${(e as Error).message}`)
      }
    }

    await this.chamar('sendMessage', {
      chat_id: canal,
      text: texto,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: false },
    })
  }

  /** Decide o formato do envio — exposto para teste sem rede. */
  formatoDe(item: OfertaPontuada, link: string): 'foto' | 'texto' {
    const foto = urlImagem(item.oferta.imagemId, item.oferta.imagemUrl)
    return foto && montarTextoPublico(item, link).length <= LIMITE_LEGENDA ? 'foto' : 'texto'
  }

  async responderCallback(id: string, texto: string): Promise<void> {
    await this.chamar('answerCallbackQuery', { callback_query_id: id, text: texto })
  }

  async receber(offset: number): Promise<any[]> {
    return this.chamar('getUpdates', { offset, timeout: 25, allowed_updates: ['callback_query'] })
  }
}

/** Card de decisão: mostra o que você precisa para aprovar em 3 segundos. */
function montarTexto(item: OfertaPontuada, link: string): string {
  const o = item.oferta
  const linhas = [
    `<b>${escapar(o.titulo)}</b>`,
    '',
    `💰 <b>R$ ${fmt(o.precoAtual)}</b>${o.precoAnterior ? ` <s>R$ ${fmt(o.precoAnterior)}</s>` : ''}`,
    `🏷 Comissão ${o.comissaoPct}%${o.comissaoExtra ? ' <i>(EXTRA)</i>' : ''} → <b>R$ ${fmt(item.ganhoReais)}</b> por venda`,
  ]
  if (o.vendas) linhas.push(`📦 ${o.vendas.toLocaleString('pt-BR')} vendidos${o.rating ? ` · ⭐ ${o.rating}` : ''}`)
  linhas.push('', `<i>${item.motivos.map(escapar).join(' · ')}</i>`, '', link)
  return linhas.join('\n')
}

/** Post do canal: sem números internos de comissão. */
function montarTextoPublico(item: OfertaPontuada, link: string): string {
  const o = item.oferta
  const desconto =
    o.precoAnterior && o.precoAnterior > o.precoAtual
      ? ` (${Math.round((1 - o.precoAtual / o.precoAnterior) * 100)}% OFF)`
      : ''
  const social = [
    o.vendas ? `${o.vendas.toLocaleString('pt-BR')} vendidos` : '',
    o.rating ? `nota ${String(o.rating).replace('.', ',')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return [
    `🔥 <b>${escapar(o.titulo)}</b>`,
    '',
    `💰 <b>R$ ${fmt(o.precoAtual)}</b>${desconto}`,
    social ? `⭐ ${social}` : '',
    '',
    link,
  ]
    .filter(Boolean)
    .join('\n')
}

const fmt = (n: number) => n.toFixed(2).replace('.', ',')
const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
