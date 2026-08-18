import type { Aplicacao, Cupom } from './cupom.ts'
import type { OfertaPontuada } from '../tipos.ts'

/**
 * Modelo da mensagem enviada ao grupo. O usuário escreve o texto com marcações
 * e o motor troca pelos valores da oferta.
 *
 * Marcações disponíveis:
 *   {titulo} {preco} {preco_anterior} {desconto} {vendas} {nota} {link}
 *   {cupom} {preco_com_cupom} {economia}
 *
 * Blocos condicionais: [[se_desconto]]…[[/se_desconto]] e [[se_cupom]]…[[/se_cupom]]
 * O que estiver dentro só aparece quando o dado existe — sem isso a mensagem
 * sai com "De R$ por" vazio quando o produto não tem preço anterior.
 */
export const MODELO_PADRAO = `🔥 {titulo}

💰 *{preco}*[[se_desconto]] (de ~{preco_anterior}~ · {desconto} OFF)[[/se_desconto]]
[[se_cupom]]🎟️ Com o cupom *{cupom}*: *{preco_com_cupom}*
[[/se_cupom]]
{link}`

export interface DadosMensagem {
  item: OfertaPontuada
  link: string
  cupom?: { cupom: Cupom } & Aplicacao
}

export function montarMensagem(modelo: string, dados: DadosMensagem): string {
  const o = dados.item.oferta
  const temDesconto = Boolean(o.precoAnterior && o.precoAnterior > o.precoAtual)
  const temCupom = Boolean(dados.cupom?.aplica)

  let texto = resolverBloco(modelo, 'se_desconto', temDesconto)
  texto = resolverBloco(texto, 'se_cupom', temCupom)

  const descontoPct = temDesconto
    ? `${Math.floor((1 - o.precoAtual / o.precoAnterior!) * 100)}%`
    : ''

  const valores: Record<string, string> = {
    titulo: o.titulo,
    preco: reais(o.precoAtual),
    preco_anterior: o.precoAnterior ? reais(o.precoAnterior) : '',
    desconto: descontoPct,
    vendas: o.vendas ? o.vendas.toLocaleString('pt-BR') : '',
    nota: o.rating ? String(o.rating).replace('.', ',') : '',
    link: dados.link,
    cupom: dados.cupom?.cupom.codigo ?? '',
    preco_com_cupom: dados.cupom?.precoFinal !== undefined ? reais(dados.cupom.precoFinal) : '',
    economia: dados.cupom?.desconto !== undefined ? reais(dados.cupom.desconto) : '',
  }

  texto = texto.replace(/\{(\w+)\}/g, (inteiro, chave: string) =>
    chave in valores ? valores[chave]! : inteiro,
  )

  // Sobrou linha vazia por causa de bloco removido: colapsa.
  return texto.replace(/\n{3,}/g, '\n\n').trim()
}

function resolverBloco(texto: string, nome: string, manter: boolean): string {
  const re = new RegExp(`\\[\\[${nome}\\]\\]([\\s\\S]*?)\\[\\[\\/${nome}\\]\\]`, 'g')
  return texto.replace(re, (_, dentro: string) => (manter ? dentro : ''))
}

const reais = (n: number) =>
  `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Marcações usadas no modelo que não existem — para avisar antes de salvar. */
export function marcacoesDesconhecidas(modelo: string): string[] {
  const validas = new Set([
    'titulo', 'preco', 'preco_anterior', 'desconto', 'vendas',
    'nota', 'link', 'cupom', 'preco_com_cupom', 'economia',
  ])
  const usadas = [...modelo.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
  return [...new Set(usadas.filter((u) => !validas.has(u)))]
}
