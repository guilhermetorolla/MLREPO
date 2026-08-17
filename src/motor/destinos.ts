import { existsSync, readFileSync } from 'node:fs'
import type { Destino, RegraDeCorte } from './tipos.ts'
import { CORTE_PADRAO } from './tipos.ts'

export const CAMINHO_DESTINOS = new URL('../../destinos.json', import.meta.url).pathname

export interface Configuracao {
  destinos: Destino[]
  corte: RegraDeCorte
}

export function carregarDestinos(caminho = CAMINHO_DESTINOS): Configuracao {
  if (!existsSync(caminho)) {
    throw new Error(
      `Arquivo de destinos não encontrado: ${caminho}\n` +
        'Copie destinos.exemplo.json para destinos.json e ajuste os grupos.',
    )
  }

  const bruto = JSON.parse(readFileSync(caminho, 'utf8')) as Partial<Configuracao>
  const destinos = bruto.destinos ?? []
  if (destinos.length === 0) throw new Error('Nenhum destino configurado em destinos.json')

  for (const d of destinos) validar(d)

  const ids = destinos.map((d) => d.id)
  const repetido = ids.find((id, i) => ids.indexOf(id) !== i)
  if (repetido) throw new Error(`Dois destinos usam o mesmo id: "${repetido}"`)

  return { destinos, corte: { ...CORTE_PADRAO, ...(bruto.corte ?? {}) } }
}

/** Erro cedo e específico: configuração torta em motor automático vira silêncio. */
function validar(d: Destino): void {
  const onde = `destino "${d.id ?? '(sem id)'}"`
  if (!d.id) throw new Error(`${onde}: campo "id" é obrigatório`)
  if (!d.chatId) throw new Error(`${onde}: campo "chatId" é obrigatório`)
  if (!Array.isArray(d.janelas) || d.janelas.length === 0) {
    throw new Error(`${onde}: precisa de ao menos uma janela, ex.: "09:00-21:00"`)
  }
  for (const j of d.janelas) {
    if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(j)) {
      throw new Error(`${onde}: janela inválida "${j}". Use o formato "09:00-21:00".`)
    }
  }
  if (!Number.isFinite(d.limiteDiario) || d.limiteDiario <= 0) {
    throw new Error(`${onde}: "limiteDiario" precisa ser maior que zero`)
  }
  if (!Number.isFinite(d.intervaloMinutos) || d.intervaloMinutos < 0) {
    throw new Error(`${onde}: "intervaloMinutos" precisa ser zero ou mais`)
  }
}
