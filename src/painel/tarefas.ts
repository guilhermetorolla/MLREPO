import { spawn } from 'node:child_process'

export interface Tarefa {
  id: string
  comando: string
  rotulo: string
  estado: 'rodando' | 'ok' | 'falhou'
  inicio: string
  fim?: string
  linhas: string[]
}

const tarefas = new Map<string, Tarefa>()
let emAndamento: string | undefined

/**
 * Roda um script do projeto em processo separado e guarda a saída para o
 * painel mostrar.
 *
 * Uma tarefa por vez, de propósito: coletar e rodar o motor ao mesmo tempo
 * disputam o mesmo perfil do navegador e o mesmo banco.
 */
export function iniciar(rotulo: string, arquivo: string, args: string[] = []): Tarefa {
  if (emAndamento) {
    const atual = tarefas.get(emAndamento)!
    if (atual.estado === 'rodando') return atual
  }

  const id = `${Date.now()}`
  const tarefa: Tarefa = {
    id,
    comando: `${arquivo} ${args.join(' ')}`.trim(),
    rotulo,
    estado: 'rodando',
    inicio: new Date().toISOString(),
    linhas: [],
  }
  tarefas.set(id, tarefa)
  emAndamento = id

  const filho = spawn(
    process.execPath,
    ['--experimental-strip-types', new URL(`../cli/${arquivo}`, import.meta.url).pathname, ...args],
    { cwd: new URL('../..', import.meta.url).pathname, env: process.env },
  )

  const anexar = (buf: Buffer) => {
    for (const linha of buf.toString().split('\n')) {
      const t = linha.trimEnd()
      if (t) tarefa.linhas.push(t)
    }
    // Limite de memória: guardamos só o fim, que é o que interessa.
    if (tarefa.linhas.length > 300) tarefa.linhas.splice(0, tarefa.linhas.length - 300)
  }

  filho.stdout.on('data', anexar)
  filho.stderr.on('data', anexar)

  filho.on('close', (codigo) => {
    tarefa.estado = codigo === 0 ? 'ok' : 'falhou'
    tarefa.fim = new Date().toISOString()
    if (emAndamento === id) emAndamento = undefined
  })

  filho.on('error', (e) => {
    tarefa.linhas.push(`falha ao iniciar: ${e.message}`)
    tarefa.estado = 'falhou'
    tarefa.fim = new Date().toISOString()
    if (emAndamento === id) emAndamento = undefined
  })

  return tarefa
}

export function ultima(): Tarefa | undefined {
  const todas = [...tarefas.values()].sort((a, b) => b.inicio.localeCompare(a.inicio))
  return todas[0]
}

export function porId(id: string): Tarefa | undefined {
  return tarefas.get(id)
}

export function ocupado(): boolean {
  return Boolean(emAndamento && tarefas.get(emAndamento)?.estado === 'rodando')
}
