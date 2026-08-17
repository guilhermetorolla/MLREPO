import type { OfertaPontuada } from './tipos.ts'

const API = 'https://api.telegram.org/bot'

export class Telegram {
  constructor(private readonly token: string) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN ausente — veja env.exemplo')
  }

  private async chamar(metodo: string, corpo: unknown): Promise<any> {
    const r = await fetch(`${API}${this.token}/${metodo}`, {
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
    await this.chamar('sendMessage', {
      chat_id: chatId,
      text: montarTexto(item, link),
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

  async publicar(canal: string, item: OfertaPontuada, link: string): Promise<void> {
    await this.chamar('sendMessage', {
      chat_id: canal,
      text: montarTextoPublico(item, link),
      parse_mode: 'HTML',
    })
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
  return [
    `🔥 <b>${escapar(o.titulo)}</b>`,
    '',
    `💰 <b>R$ ${fmt(o.precoAtual)}</b>${desconto}`,
    o.vendas ? `📦 ${o.vendas.toLocaleString('pt-BR')} vendidos` : '',
    '',
    link,
  ]
    .filter(Boolean)
    .join('\n')
}

const fmt = (n: number) => n.toFixed(2).replace('.', ',')
const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
