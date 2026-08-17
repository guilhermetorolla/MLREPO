import { readFileSync, existsSync } from 'node:fs'

/** Lê .env sem dependência externa. Nunca commitar o .env (está no .gitignore). */
export function carregarEnv(caminho = new URL('../.env', import.meta.url).pathname): void {
  if (!existsSync(caminho)) return
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const t = linha.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const chave = t.slice(0, i).trim()
    const valor = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(chave in process.env)) process.env[chave] = valor
  }
}

export function exigir(chave: string): string {
  const v = process.env[chave]
  if (!v) throw new Error(`Variável ${chave} não definida. Veja env.exemplo`)
  return v
}
