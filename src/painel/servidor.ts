import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import estatico from '@fastify/static'
import { existsSync } from 'node:fs'
import { carregarEnv } from '../config.ts'
import {
  abrir,
  agendamentos,
  agendar,
  apagarDestino,
  decisoes,
  destinos,
  faixasPreco,
  historicos,
  linkSalvo,
  marcarAgendamento,
  ofertasSalvas,
  publicacoesRecentes,
  publicadosRecentemente,
  salvarDecisao,
  salvarDestino,
  contarErrosRecentes,
  eventos,
  ofertaPorId,
  registrarEvento,
  type DestinoLinha,
} from '../db.ts'
import { motivoParaEsperar, proximoHorario } from '../motor/agenda.ts'
import * as tarefas from './tarefas.ts'
import { aprovado } from '../motor/corte.ts'
import { CAMINHO_DESTINOS, carregarDestinos } from '../motor/destinos.ts'
import { CORTE_PADRAO } from '../motor/tipos.ts'
import { ranquear } from '../score.ts'
import { urlImagem } from '../tipos.ts'

carregarEnv()

const PORTA = Number(process.env.PAINEL_PORTA ?? 4477)
const HOST = process.env.PAINEL_HOST ?? '0.0.0.0'
const TOKEN = process.env.PAINEL_TOKEN ?? ''
const ETIQUETA = process.env.ETIQUETA ?? ''

if (!TOKEN) {
  console.error(
    'PAINEL_TOKEN não definido.\n' +
      'Sua tailnet tem máquinas de outras pessoas — sem token, qualquer uma delas\n' +
      'alcança este painel e dispara post em nome do seu afiliado.\n' +
      'Gere um: openssl rand -hex 16   e coloque em .env como PAINEL_TOKEN=',
  )
  process.exit(1)
}

const db = abrir()
semearDestinos()

const app = Fastify({ logger: false })

await app.register(estatico, {
  root: new URL('./publico', import.meta.url).pathname,
  prefix: '/',
})

/**
 * REGRA DE OURO Fastify v4+: todo hook/preHandler precisa ser `async` explícito.
 * Sem isso o Fastify trata como assinatura legada (req, reply, done) e a rota
 * fica pendurada para sempre — sem erro, sem timeout, sem log.
 */
app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.url.startsWith('/api/')) return
  const enviado = req.headers['x-painel-token']
  if (enviado !== TOKEN) {
    return reply.code(401).send({ erro: 'token_invalido' })
  }
})

// ─── Fila ────────────────────────────────────────────────────────

app.get('/api/fila', async () => {
  const cfg = corteAtual()
  const mapaDecisoes = decisoes(db)
  const faixas = faixasPreco(db)
  const publicados = publicadosRecentemente(db)
  const agora = new Date()

  const fila = ranquear(ofertasSalvas(db), { historicos: historicos(db), agora })

  return {
    corte: cfg,
    ofertas: fila.map((i) => {
      const d = mapaDecisoes.get(i.oferta.itemId)
      const v = aprovado(i, cfg)
      const faixa = faixas.get(i.oferta.itemId)
      return {
        itemId: i.oferta.itemId,
        titulo: i.oferta.titulo,
        url: i.oferta.url,
        imagem: urlImagem(i.oferta.imagemId),
        preco: i.oferta.precoAtual,
        precoAnterior: i.oferta.precoAnterior,
        comissaoPct: i.oferta.comissaoPct,
        comissaoExtra: i.oferta.comissaoExtra,
        vendas: i.oferta.vendas,
        rating: i.oferta.rating,
        ganhoReais: i.ganhoReais,
        motivos: i.motivos,
        passaNoCorte: v.ok,
        motivoCorte: v.motivo,
        decisao: d?.estado ?? null,
        adiadoAte: d?.adiadoAte ?? null,
        jaPublicado: publicados.has(i.oferta.itemId),
        link: ETIQUETA ? linkSalvo(db, i.oferta.itemId, ETIQUETA) ?? null : null,
        temLink: ETIQUETA ? Boolean(linkSalvo(db, i.oferta.itemId, ETIQUETA)) : false,
        leiturasDePreco: faixa?.amostras ?? 1,
      }
    }),
  }
})

app.post('/api/decisao', async (req, reply) => {
  const { itemId, estado, adiadoAte } = (req.body ?? {}) as {
    itemId?: string
    estado?: string
    adiadoAte?: string
  }
  if (!itemId || !estado || !['aprovado', 'rejeitado', 'adiado'].includes(estado)) {
    return reply.code(400).send({ erro: 'itemId e estado (aprovado|rejeitado|adiado) obrigatórios' })
  }
  salvarDecisao(db, itemId, estado as 'aprovado', adiadoAte)
  return { ok: true }
})

// ─── Destinos ────────────────────────────────────────────────────

app.get('/api/destinos', async () => ({ destinos: destinos(db) }))

app.post('/api/destinos', async (req, reply) => {
  const d = (req.body ?? {}) as Partial<DestinoLinha>
  const erro = validarDestino(d)
  if (erro) return reply.code(400).send({ erro })
  salvarDestino(db, {
    id: d.id!,
    chatId: d.chatId!,
    nome: d.nome || d.id!,
    janelas: d.janelas!,
    limiteDiario: Number(d.limiteDiario),
    intervaloMinutos: Number(d.intervaloMinutos),
    ativo: d.ativo ?? true,
  })
  return { ok: true }
})

app.delete('/api/destinos/:id', async (req) => {
  apagarDestino(db, (req.params as { id: string }).id)
  return { ok: true }
})

// ─── Agendamentos ────────────────────────────────────────────────

app.get('/api/agendamentos', async () => ({
  // Junta o produto: a tela mostrava só "MLB6235293422", que não diz nada.
  agendamentos: agendamentos(db).map((a) => {
    const o = ofertaPorId(db, a.itemId)
    return {
      ...a,
      titulo: o?.titulo ?? '(oferta saiu da base)',
      imagem: urlImagem(o?.imagemId),
      preco: o?.precoAtual ?? null,
    }
  }),
}))

app.post('/api/agendamentos', async (req, reply) => {
  const { itemId, destinoId, quando } = (req.body ?? {}) as Record<string, string>
  if (!itemId || !destinoId || !quando) {
    return reply.code(400).send({ erro: 'itemId, destinoId e quando são obrigatórios' })
  }
  const data = new Date(quando)
  if (Number.isNaN(data.getTime())) return reply.code(400).send({ erro: 'quando inválido' })
  if (!destinos(db).some((d) => d.id === destinoId)) {
    return reply.code(400).send({ erro: `destino "${destinoId}" não existe` })
  }
  return { ok: true, id: agendar(db, itemId, destinoId, data.toISOString()) }
})

app.delete('/api/agendamentos/:id', async (req) => {
  marcarAgendamento(db, Number((req.params as { id: string }).id), 'cancelado')
  return { ok: true }
})

// ─── Motor ───────────────────────────────────────────────────────

app.get('/api/motor/status', async () => {
  const agora = new Date()
  const pubs = publicacoesRecentes(db)
  const lista = destinos(db)

  return {
    agora: agora.toISOString(),
    etiqueta: ETIQUETA || null,
    destinos: lista.map((d) => ({
      ...d,
      bloqueio: motivoParaEsperar(
        {
          id: d.id,
          chatId: d.chatId,
          nome: d.nome,
          janelas: d.janelas,
          limiteDiario: d.limiteDiario,
          intervaloMinutos: d.intervaloMinutos,
          ativo: d.ativo,
        },
        pubs,
        agora,
      ) ?? null,
      proximaJanela: proximoHorario(
        {
          id: d.id, chatId: d.chatId, nome: d.nome, janelas: d.janelas,
          limiteDiario: d.limiteDiario, intervaloMinutos: d.intervaloMinutos, ativo: d.ativo,
        },
        agora,
      ) ?? null,
      publicadosHoje: pubs.filter(
        (p) => p.destinoId === d.id && p.publicadoEm.slice(0, 10) === agora.toISOString().slice(0, 10),
      ).length,
    })),
    ultimasPublicacoes: pubs.slice(0, 30),
    agendamentosPendentes: agendamentos(db, 'pendente').length,
  }
})

// ─── Ações (os botões que fazem coisa) ───────────────────────────

const ACOES: Record<string, { rotulo: string; arquivo: string; args?: string[] }> = {
  coletar: { rotulo: 'Buscar ofertas no Mercado Livre', arquivo: 'coletar.ts' },
  links: { rotulo: 'Gerar links de afiliado', arquivo: 'links.ts' },
  simular: { rotulo: 'Simular rodada do motor', arquivo: 'motor.ts', args: ['--simular'] },
  publicar: { rotulo: 'Rodar motor de verdade', arquivo: 'motor.ts' },
  site: { rotulo: 'Regerar o site', arquivo: 'site.ts' },
}

app.post('/api/acoes/:nome', async (req, reply) => {
  const nome = (req.params as { nome: string }).nome
  const acao = ACOES[nome]
  if (!acao) return reply.code(404).send({ erro: `ação "${nome}" não existe` })
  if (tarefas.ocupado()) {
    return reply.code(409).send({ erro: 'já tem uma tarefa rodando — espere terminar' })
  }
  registrarEvento(db, 'info', 'painel', `ação: ${acao.rotulo}`)
  return { tarefa: tarefas.iniciar(acao.rotulo, acao.arquivo, acao.args ?? []) }
})

app.get('/api/acoes/estado', async () => ({ tarefa: tarefas.ultima() ?? null }))

app.get('/api/eventos', async () => ({
  eventos: eventos(db),
  errosRecentes: contarErrosRecentes(db),
}))

// ─── Infra ───────────────────────────────────────────────────────

function corteAtual() {
  try {
    return carregarDestinos().corte
  } catch {
    return CORTE_PADRAO
  }
}

/** Primeira execução: importa o destinos.json para o banco, sem perder nada. */
function semearDestinos(): void {
  if (destinos(db).length > 0) return
  if (!existsSync(CAMINHO_DESTINOS)) return
  try {
    for (const d of carregarDestinos().destinos) {
      salvarDestino(db, {
        id: d.id,
        chatId: d.chatId,
        nome: d.nome,
        janelas: d.janelas,
        limiteDiario: d.limiteDiario,
        intervaloMinutos: d.intervaloMinutos,
        ativo: d.ativo ?? true,
      })
    }
    console.log('destinos.json importado para o banco')
  } catch (e) {
    console.warn(`destinos.json não pôde ser importado: ${(e as Error).message}`)
  }
}

function validarDestino(d: Partial<DestinoLinha>): string | undefined {
  if (!d.id) return 'id é obrigatório'
  if (!d.chatId) return 'chatId é obrigatório'
  if (!Array.isArray(d.janelas) || d.janelas.length === 0) return 'informe ao menos uma janela'
  for (const j of d.janelas) {
    if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(j)) {
      return `janela inválida "${j}" — use o formato 09:00-21:00`
    }
  }
  if (!(Number(d.limiteDiario) > 0)) return 'limite diário precisa ser maior que zero'
  if (!(Number(d.intervaloMinutos) >= 0)) return 'intervalo precisa ser zero ou mais'
  return undefined
}

const endereco = await app.listen({ port: PORTA, host: HOST })
console.log(`Painel em ${endereco}`)
console.log(`Pela tailnet: http://mac-mini-de-guilherme:${PORTA}`)
