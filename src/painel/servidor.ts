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
  salvarOfertas,
  apagarAutomacao,
  automacoes,
  estatisticaAutomacao,
  salvarAutomacao,
  addItemLista,
  apagarBusca,
  apagarCupom,
  apagarLista,
  buscas,
  cupons,
  listas,
  salvarBusca,
  salvarCupom,
  salvarLista,
  apagarConfig,
  config,
  gravarConfig,
  lerConfig,
  type DestinoLinha,
} from '../db.ts'
import { melhorCupom, type Cupom } from '../motor/cupom.ts'
import { fontes, provedoresDeLink } from '../fontes/registry.ts'
import { MARKETPLACES } from '../tipos.ts'
import { diaLocal } from '../motor/agenda.ts'
import { filtrarConteudo, motivoAutomacaoEsperar, type Automacao } from '../motor/automacao.ts'
import { parsearFeed } from '../parser.ts'
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
let ETIQUETA = process.env.ETIQUETA ?? ''

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
// A importação vem da aba do Mercado Livre, que é outra origem. Liberamos
// CORS apenas para o que o token já protege — o token continua obrigatório.
app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
  reply.header('Access-Control-Allow-Origin', '*')
  reply.header('Access-Control-Allow-Headers', 'content-type, x-painel-token')
  reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return reply.code(204).send()
})

app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.url.startsWith('/api/')) return
  const enviado = req.headers['x-painel-token']
  if (enviado !== TOKEN) {
    return reply.code(401).send({ erro: 'token_invalido' })
  }
})

// ─── Fila ────────────────────────────────────────────────────────

app.get('/api/fila', async () => {
  ETIQUETA = config(db, 'etiqueta', 'ETIQUETA') ?? ''
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
        imagem: urlImagem(i.oferta.imagemId, i.oferta.imagemUrl),
        marketplace: i.oferta.marketplace ?? 'ml',
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
      imagem: urlImagem(o?.imagemId, o?.imagemUrl),
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

// ─── Cupons ──────────────────────────────────────────────────────

app.get('/api/cupons', async () => ({ cupons: cupons(db), marketplaces: MARKETPLACES }))

app.post('/api/cupons', async (req, reply) => {
  const c = (req.body ?? {}) as Cupom & { marketplace?: string }
  if (!c.codigo) return reply.code(400).send({ erro: 'código é obrigatório' })
  if (c.percentual === undefined && c.valorFixo === undefined) {
    return reply.code(400).send({ erro: 'informe percentual OU valor fixo' })
  }
  salvarCupom(db, c)
  return { ok: true }
})

app.delete('/api/cupons/:codigo', async (req) => {
  apagarCupom(db, (req.params as { codigo: string }).codigo)
  return { ok: true }
})

/** Prévia: quantas ofertas da base este cupom alcança, e o melhor preço. */
app.get('/api/cupons/:codigo/previa', async (req, reply) => {
  const codigo = (req.params as { codigo: string }).codigo
  const cupom = cupons(db).find((c) => c.codigo === codigo)
  if (!cupom) return reply.code(404).send({ erro: 'cupom não encontrado' })

  const agora = new Date()
  const ofertas = ofertasSalvas(db)
  const alcanca = ofertas
    .map((o) => ({ o, r: melhorCupom([cupom], o, agora) }))
    .filter((x) => x.r?.aplica)

  return {
    total: ofertas.length,
    alcanca: alcanca.length,
    exemplos: alcanca.slice(0, 5).map((x) => ({
      titulo: x.o.titulo,
      preco: x.o.precoAtual,
      precoFinal: x.r!.precoFinal,
      economia: x.r!.desconto,
    })),
  }
})

// ─── Listas ──────────────────────────────────────────────────────

app.get('/api/listas', async () => ({ listas: listas(db) }))

app.post('/api/listas', async (req, reply) => {
  const { id, nome, horasValidade } = (req.body ?? {}) as Record<string, any>
  if (!id || !nome) return reply.code(400).send({ erro: 'id e nome são obrigatórios' })
  salvarLista(db, id, nome, horasValidade ? Number(horasValidade) : undefined)
  return { ok: true }
})

app.post('/api/listas/:id/itens', async (req, reply) => {
  const { itemId } = (req.body ?? {}) as { itemId?: string }
  if (!itemId) return reply.code(400).send({ erro: 'itemId é obrigatório' })
  addItemLista(db, (req.params as { id: string }).id, itemId)
  return { ok: true }
})

app.delete('/api/listas/:id', async (req) => {
  apagarLista(db, (req.params as { id: string }).id)
  return { ok: true }
})

// ─── Buscas salvas ───────────────────────────────────────────────

app.get('/api/buscas', async () => ({ buscas: buscas(db) }))

app.post('/api/buscas', async (req, reply) => {
  const b = (req.body ?? {}) as Record<string, any>
  if (!b.id || !b.termo) return reply.code(400).send({ erro: 'id e termo são obrigatórios' })
  salvarBusca(db, {
    id: b.id,
    termo: b.termo,
    marketplace: b.marketplace ?? 'shopee',
    ativa: b.ativa ?? true,
  })
  return { ok: true }
})

app.delete('/api/buscas/:id', async (req) => {
  apagarBusca(db, (req.params as { id: string }).id)
  return { ok: true }
})

/**
 * Configuração pela tela, com validação de verdade antes de gravar.
 *
 * Guardar credencial que não funciona é pior que não guardar: o checklist
 * ficaria verde e o motor falharia calado toda madrugada.
 */
app.post('/api/config/telegram', async (req, reply) => {
  const { token, canal } = (req.body ?? {}) as { token?: string; canal?: string }
  if (!token) return reply.code(400).send({ erro: 'informe o token do BotFather' })

  let bot: any
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    bot = await r.json()
  } catch (e) {
    return reply.code(502).send({ erro: `não consegui falar com o Telegram: ${(e as Error).message}` })
  }
  if (!bot?.ok) {
    return reply.code(400).send({ erro: `o Telegram recusou o token: ${bot?.description ?? 'inválido'}` })
  }

  gravarConfig(db, 'telegram_token', token)
  if (canal) gravarConfig(db, 'telegram_canal', canal)
  registrarEvento(db, 'info', 'config', `bot do Telegram conectado: @${bot.result.username}`)
  return { ok: true, bot: { username: bot.result.username, nome: bot.result.first_name } }
})

/** Confere se o bot consegue mesmo publicar no destino, antes de você confiar. */
app.post('/api/config/testar-destino', async (req, reply) => {
  const { chatId } = (req.body ?? {}) as { chatId?: string }
  const token = config(db, 'telegram_token', 'TELEGRAM_BOT_TOKEN')
  if (!token) return reply.code(400).send({ erro: 'conecte o Telegram antes' })
  if (!chatId) return reply.code(400).send({ erro: 'informe o chat_id' })

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '✅ Teste do painel. Se você está lendo isto, o bot consegue publicar aqui.',
    }),
  })
  const corpo = (await r.json()) as any
  if (!corpo?.ok) {
    return reply.code(400).send({
      erro: `o Telegram recusou: ${corpo?.description ?? 'erro desconhecido'}`,
      dica: 'o bot precisa ser ADMINISTRADOR do grupo ou canal',
    })
  }
  return { ok: true }
})

app.post('/api/config/shopee', async (req, reply) => {
  const { appId, appSecret } = (req.body ?? {}) as { appId?: string; appSecret?: string }
  if (!appId || !appSecret) return reply.code(400).send({ erro: 'informe App ID e Chave Secreta' })

  const { FonteShopee } = await import('../fontes/shopee.ts')
  try {
    await new FonteShopee(appId, appSecret).buscar({ paginas: 1 })
  } catch (e) {
    return reply.code(400).send({ erro: `a Shopee recusou as credenciais: ${(e as Error).message}` })
  }

  gravarConfig(db, 'shopee_app_id', appId)
  gravarConfig(db, 'shopee_app_secret', appSecret)
  registrarEvento(db, 'info', 'config', 'credenciais da Shopee validadas e salvas')
  return { ok: true }
})

app.post('/api/config/etiqueta', async (req, reply) => {
  const { etiqueta } = (req.body ?? {}) as { etiqueta?: string }
  if (!etiqueta) return reply.code(400).send({ erro: 'informe a etiqueta' })
  gravarConfig(db, 'etiqueta', etiqueta)
  return { ok: true }
})

app.delete('/api/config/:chave', async (req) => {
  apagarConfig(db, (req.params as { chave: string }).chave)
  return { ok: true }
})

// ─── Integrações (tela de configurações) ─────────────────────────

app.get('/api/integracoes', async () => {
  const fontesEstado = await Promise.all(
    fontes().map(async (f) => ({
      marketplace: f.marketplace,
      nome: f.nome,
      tipo: 'fonte',
      ...(await f.disponivel()),
    })),
  )
  const linksEstado = await Promise.all(
    provedoresDeLink().map(async (p) => ({
      marketplace: p.marketplace,
      nome: p.nome,
      tipo: 'link',
      ...(await p.disponivel()),
    })),
  )

  return {
    marketplaces: [...fontesEstado, ...linksEstado],
    telegram: {
      // Nunca devolve o token: só o suficiente para a tela mostrar o estado.
      configurado: Boolean(config(db, 'telegram_token', 'TELEGRAM_BOT_TOKEN')),
      canal: config(db, 'telegram_canal', 'TELEGRAM_CANAL') ?? null,
      fonte: lerConfig(db, 'telegram_token') ? 'painel' : process.env.TELEGRAM_BOT_TOKEN ? 'arquivo .env' : null,
    },
    shopee: {
      configurado: Boolean(config(db, 'shopee_app_id', 'SHOPEE_APP_ID')),
    },
    etiqueta: config(db, 'etiqueta', 'ETIQUETA') ?? null,
  }
})

// ─── Automações ──────────────────────────────────────────────────

app.get('/api/automacoes', async () => {
  const agora = new Date()
  const hoje = diaLocal(agora)
  const fila = ranquear(ofertasSalvas(db), { historicos: historicos(db), agora })

  return {
    automacoes: automacoes(db).map((a) => {
      const stat = estatisticaAutomacao(db, a.id, hoje)
      return {
        ...a,
        situacao: motivoAutomacaoEsperar(a, agora, stat.ultima, stat.enviadosHoje) ?? null,
        enviadosHoje: stat.enviadosHoje,
        // Quantas ofertas o filtro desta automação aprova agora — é o número
        // que diz se o filtro está apertado demais.
        candidatas: filtrarConteudo(fila, a.filtro).length,
      }
    }),
  }
})

app.post('/api/automacoes', async (req, reply) => {
  const a = (req.body ?? {}) as Partial<Automacao>
  if (!a.id || !a.nome) return reply.code(400).send({ erro: 'id e nome são obrigatórios' })
  for (const j of a.janelas ?? []) {
    if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(j)) {
      return reply.code(400).send({ erro: `janela inválida "${j}" — use 09:00-21:00` })
    }
  }
  const conhecidos = new Set(destinos(db).map((d) => d.id))
  for (const d of a.destinos ?? []) {
    if (!conhecidos.has(d)) return reply.code(400).send({ erro: `destino "${d}" não existe` })
  }

  salvarAutomacao(db, {
    id: a.id,
    nome: a.nome,
    descricao: a.descricao,
    ativa: a.ativa ?? true,
    diasSemana: a.diasSemana ?? [],
    janelas: a.janelas ?? [],
    intervaloMinutos: Number(a.intervaloMinutos ?? 60),
    limiteDiario: Number(a.limiteDiario ?? 10),
    filtro: a.filtro ?? { ganhoMinimo: 10, exigirDescontoConfirmado: false },
    destinos: a.destinos ?? [],
  })
  return { ok: true }
})

app.delete('/api/automacoes/:id', async (req) => {
  apagarAutomacao(db, (req.params as { id: string }).id)
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

/**
 * Importa o feed cru do hub, vindo do navegador onde você já está logado.
 * É o caminho que dispensa o Playwright: a aba do Mercado Livre lê o próprio
 * feed com a sua sessão e despeja aqui.
 */
app.post('/api/ofertas/importar', async (req, reply) => {
  const corpo = (req.body ?? {}) as { paginas?: unknown[] }
  if (!Array.isArray(corpo.paginas) || corpo.paginas.length === 0) {
    return reply.code(400).send({ erro: 'envie { paginas: [ <resposta do hub/search>, ... ] }' })
  }

  const vistos = new Set<string>()
  const ofertas = []
  const falhas: string[] = []

  for (const [i, bruto] of corpo.paginas.entries()) {
    try {
      for (const o of parsearFeed(bruto)) {
        if (vistos.has(o.itemId)) continue
        vistos.add(o.itemId)
        ofertas.push(o)
      }
    } catch (e) {
      falhas.push(`página ${i}: ${(e as Error).message}`)
    }
  }

  if (ofertas.length > 0) salvarOfertas(db, ofertas)
  registrarEvento(
    db,
    falhas.length > 0 ? 'erro' : 'info',
    'importacao',
    `${ofertas.length} ofertas importadas do navegador`,
    falhas.join(' · ') || undefined,
  )

  return { importadas: ofertas.length, paginas: corpo.paginas.length, falhas }
})

// ─── Ações (os botões que fazem coisa) ───────────────────────────

const ACOES: Record<string, { rotulo: string; arquivo: string; args?: string[] }> = {
  coletar: { rotulo: 'Buscar ofertas no Mercado Livre', arquivo: 'coletar.ts' },
  links: { rotulo: 'Gerar links de afiliado', arquivo: 'links.ts' },
  simular: { rotulo: 'Simular rodada do motor', arquivo: 'motor.ts', args: ['--simular'] },
  publicar: { rotulo: 'Rodar motor de verdade', arquivo: 'motor.ts' },
  site: { rotulo: 'Regerar o site', arquivo: 'site.ts' },
  entrar: { rotulo: 'Abrir navegador para login no Mercado Livre', arquivo: 'entrar.ts' },
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

/** Tela inicial: o que já está pronto e o que falta configurar. */
app.get('/api/resumo', async () => {
  const totalOfertas = (db.prepare('SELECT COUNT(*) AS c FROM ofertas').get() as { c: number }).c
  const comLink = ETIQUETA
    ? (db.prepare('SELECT COUNT(*) AS c FROM links WHERE etiqueta = ?').get(ETIQUETA) as { c: number }).c
    : 0
  const listaDestinos = destinos(db)
  const listaAutomacoes = automacoes(db)
  const pubs = publicacoesRecentes(db)
  const hoje = diaLocal(new Date())

  return {
    passos: [
      {
        chave: 'ofertas',
        titulo: 'Trazer ofertas do Mercado Livre',
        feito: totalOfertas > 0,
        detalhe: totalOfertas > 0 ? `${totalOfertas} ofertas na base` : 'nenhuma oferta ainda',
        acao: 'coletar',
      },
      {
        chave: 'links',
        titulo: 'Gerar links de afiliado',
        feito: comLink > 0,
        detalhe: comLink > 0 ? `${comLink} links prontos` : 'nenhum link gerado',
        acao: 'links',
      },
      {
        chave: 'destinos',
        titulo: 'Cadastrar um grupo ou canal',
        feito: listaDestinos.length > 0,
        detalhe: listaDestinos.length > 0 ? `${listaDestinos.length} destinos` : 'nenhum destino',
        tela: 'destinos',
      },
      {
        chave: 'automacao',
        titulo: 'Criar uma automação',
        feito: listaAutomacoes.length > 0,
        detalhe: listaAutomacoes.some((a) => a.ativa)
          ? `${listaAutomacoes.filter((a) => a.ativa).length} ativas`
          : listaAutomacoes.length > 0
            ? 'criada, mas pausada'
            : 'nenhuma automação',
        tela: 'automacoes',
      },
      {
        chave: 'telegram',
        titulo: 'Conectar o Telegram',
        feito: Boolean(config(db, 'telegram_token', 'TELEGRAM_BOT_TOKEN')),
        detalhe: config(db, 'telegram_token', 'TELEGRAM_BOT_TOKEN')
          ? 'bot conectado'
          : 'cole o token do BotFather',
        tela: 'config',
      },
    ],
    metricas: {
      ofertas: totalOfertas,
      publicadasHoje: pubs.filter((p) => diaLocal(new Date(p.publicadoEm)) === hoje).length,
      publicadasTotal: pubs.length,
      erros24h: contarErrosRecentes(db),
      agendamentosPendentes: agendamentos(db, 'pendente').length,
    },
  }
})

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
