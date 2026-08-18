// Painel de ofertas — JS de módulo nativo, sem build.
// O token fica no localStorage e vai em header; nunca na URL.

const CHAVE_TOKEN = 'painel_token'
const conteudo = document.getElementById('conteudo')
const dlgToken = document.getElementById('dlg-token')
const dlgAgendar = document.getElementById('dlg-agendar')

let tela = 'fila'
let destinosCache = []
let filtro = { busca: '', so: 'todas' }
let ofertasCache = []

// ─── API ─────────────────────────────────────────────────────────

function token() {
  return localStorage.getItem(CHAVE_TOKEN) ?? ''
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(`/api${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      'x-painel-token': token(),
      ...(opcoes.headers ?? {}),
    },
  })
  if (r.status === 401) {
    localStorage.removeItem(CHAVE_TOKEN)
    pedirToken()
    throw new Error('token inválido')
  }
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(corpo.erro ?? `HTTP ${r.status}`)
  return corpo
}

function pedirToken() {
  dlgToken.showModal()
}

dlgToken.addEventListener('close', () => {
  const valor = document.getElementById('campo-token').value.trim()
  if (valor) {
    localStorage.setItem(CHAVE_TOKEN, valor)
    render()
  }
})

// ─── Formatação ──────────────────────────────────────────────────

const brl = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const dataHora = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function relogio() {
  document.getElementById('relogio').textContent = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
setInterval(relogio, 30_000)
relogio()

// ─── Tela: Fila ──────────────────────────────────────────────────

async function telaFila() {
  const { ofertas, corte } = await api('/fila')
  destinosCache = (await api('/destinos')).destinos
  ofertasCache = ofertas

  const aprovadas = ofertas.filter((o) => o.decisao === 'aprovado').length
  const passam = ofertas.filter((o) => o.passaNoCorte).length
  const semLink = ofertas.filter((o) => !o.temLink).length

  const cabecalho = `
    <h2 class="titulo-secao">Fila de ofertas</h2>
    <p class="sub">${ofertas.length} na fila · ${passam} passam no corte · ${aprovadas} aprovadas por você${semLink ? ` · ${semLink} ainda sem link` : ''}.
    Corte: ganho ≥ ${brl(corte.ganhoMinimo)}, nota ≥ ${corte.notaMinima ?? '—'}, vendas ≥ ${corte.vendasMinimas ?? '—'}.</p>
    <div class="filtros">
      <input type="search" id="busca" placeholder="buscar por título" value="${esc(filtro.busca)}">
      ${[
        ['todas', 'Todas'],
        ['passam', 'Passam no corte'],
        ['aprovadas', 'Aprovadas'],
        ['semlink', 'Sem link'],
      ]
        .map(([k, r]) => `<button class="chip ${filtro.so === k ? 'ativo' : ''}" data-filtro="${k}">${r}</button>`)
        .join('')}
    </div>`

  if (ofertas.length === 0) {
    return `${cabecalho}<p class="vazio">Nenhuma oferta na base.<br><br>
      Use <b>Buscar ofertas no ML</b> ali em cima — ele lê direto do seu hub de afiliado.<br>
      Se for a primeira vez, rode <code>npm run entrar</code> no terminal para logar uma vez.</p>`
  }

  const visiveis = aplicarFiltro(ofertas)
  if (visiveis.length === 0) {
    return `${cabecalho}<p class="vazio">Nenhuma oferta com esses filtros.</p>`
  }

  return cabecalho + visiveis.map(cartaoOferta).join('')
}

function aplicarFiltro(ofertas) {
  const termo = filtro.busca.trim().toLowerCase()
  return ofertas.filter((o) => {
    if (termo && !o.titulo.toLowerCase().includes(termo)) return false
    if (filtro.so === 'passam') return o.passaNoCorte
    if (filtro.so === 'aprovadas') return o.decisao === 'aprovado'
    if (filtro.so === 'semlink') return !o.temLink
    return true
  })
}

function cartaoOferta(o) {
  const classe = o.decisao === 'rejeitado' ? 'rejeitada' : o.passaNoCorte ? '' : 'reprovada'
  const selos = [
    o.comissaoExtra ? '<span class="selo selo-extra">EXTRA</span>' : '',
    o.passaNoCorte
      ? '<span class="selo selo-ok">passa no corte</span>'
      : `<span class="selo selo-nao">${esc(o.motivoCorte ?? 'reprovada')}</span>`,
    o.decisao ? `<span class="selo selo-decidido">${esc(o.decisao)}</span>` : '',
    o.jaPublicado ? '<span class="selo selo-neutro">já publicada</span>' : '',
    o.temLink ? '' : '<span class="selo selo-neutro">sem link</span>',
    o.leiturasDePreco < 2 ? '<span class="selo selo-neutro">1 leitura de preço</span>' : '',
  ].join('')

  return `
  <article class="oferta ${classe}" data-item="${esc(o.itemId)}">
    ${o.imagem ? `<img class="miniatura" src="${esc(o.imagem)}" alt="" loading="lazy">` : '<div class="miniatura"></div>'}
    <div>
      <p class="titulo"><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.titulo)}</a></p>
      <div class="linha-meta">
        ${selos}
        <span style="color:var(--fraco)">${o.comissaoPct}%${o.vendas ? ` · ${o.vendas.toLocaleString('pt-BR')} vendidos` : ''}${o.rating ? ` · nota ${String(o.rating).replace('.', ',')}` : ''}</span>
      </div>
    </div>
    <div class="bloco-preco">
      ${o.precoAnterior ? `<div class="antes">${brl(o.precoAnterior)}</div>` : ''}
      <div class="preco">${brl(o.preco)}</div>
      <div class="ganho">ganho ${brl(o.ganhoReais)}</div>
    </div>
    <div class="acoes">
      <button class="botao" data-acao="agendar">Programar</button>
      <button class="botao-fraco" data-acao="aprovado">Aprovar</button>
      <button class="botao-perigo" data-acao="rejeitado">Descartar</button>
    </div>
    ${
      o.link
        ? `<div class="linha-link" style="grid-column:1/-1">
             <span class="link-af">${esc(o.link)}</span>
             <button class="botao-mini" data-copiar="${esc(o.link)}">Copiar link</button>
           </div>`
        : ''
    }
  </article>`
}

// ─── Tela: Programados ───────────────────────────────────────────

async function telaAgenda() {
  const { agendamentos } = await api('/agendamentos')
  const pendentes = agendamentos.filter((a) => a.estado === 'pendente')

  const cabecalho = `
    <h2 class="titulo-secao">Publicações programadas</h2>
    <p class="sub">${pendentes.length} pendentes. Post programado ignora a régua de corte, mas respeita o intervalo mínimo do destino.</p>`

  if (agendamentos.length === 0) {
    return `${cabecalho}<p class="vazio">Nada programado. Use "Programar" na fila.</p>`
  }

  return `${cabecalho}
  <table class="tabela">
    <thead><tr><th>Quando</th><th>Produto</th><th>Destino</th><th>Estado</th><th></th></tr></thead>
    <tbody>${agendamentos
      .map(
        (a) => `<tr>
        <td>${dataHora(a.quando)}</td>
        <td style="display:flex;gap:10px;align-items:center">
          ${a.imagem ? `<img src="${esc(a.imagem)}" alt="" style="width:38px;height:38px;object-fit:contain;background:#fafafa;border-radius:4px">` : ''}
          <span>${esc(a.titulo)}${a.preco ? `<br><span style="color:var(--tenue);font-size:12px">${brl(a.preco)}</span>` : ''}</span>
        </td>
        <td>${esc(a.destinoId)}</td>
        <td>${esc(a.estado)}${a.erro ? ` — ${esc(a.erro)}` : ''}</td>
        <td class="num">${a.estado === 'pendente' ? `<button class="botao-perigo" data-cancelar="${a.id}">Cancelar</button>` : ''}</td>
      </tr>`,
      )
      .join('')}</tbody>
  </table>`
}

// ─── Tela: Destinos ──────────────────────────────────────────────

async function telaDestinos() {
  const { destinos } = await api('/destinos')
  destinosCache = destinos

  const form = `
  <div class="cartao-form">
    <h2 class="titulo-secao">Novo destino</h2>
    <p class="sub">O bot precisa ser administrador do grupo ou canal. Para descobrir o id de um grupo,
    adicione o bot, mande uma mensagem e abra <code>getUpdates</code> na API do Telegram.</p>
    <div class="grade-form">
      <label>Identificador <input id="d-id" placeholder="grupo-promo"></label>
      <label>chat_id <input id="d-chat" placeholder="@canal ou -1001234"></label>
      <label>Nome <input id="d-nome" placeholder="Grupo de promoções"></label>
      <label>Janelas <input id="d-janelas" placeholder="09:00-12:00, 14:00-21:00"></label>
      <label>Limite diário <input id="d-limite" type="number" value="6" min="1"></label>
      <label>Intervalo (min) <input id="d-intervalo" type="number" value="60" min="0"></label>
    </div>
    <div class="acoes-dialogo"><button class="botao" id="salvar-destino">Adicionar destino</button></div>
  </div>`

  const tabela =
    destinos.length === 0
      ? '<p class="vazio">Nenhum destino cadastrado.</p>'
      : `<table class="tabela">
      <thead><tr><th>Destino</th><th>chat_id</th><th>Janelas</th><th class="num">Limite</th><th class="num">Intervalo</th><th>Ativo</th><th></th></tr></thead>
      <tbody>${destinos
        .map(
          (d) => `<tr>
          <td><b>${esc(d.nome)}</b><br><span style="color:var(--tenue);font-size:12px">${esc(d.id)}</span></td>
          <td>${esc(d.chatId)}</td>
          <td>${d.janelas.map(esc).join('<br>')}</td>
          <td class="num">${d.limiteDiario}/dia</td>
          <td class="num">${d.intervaloMinutos} min</td>
          <td><button class="botao-fraco" data-alternar="${esc(d.id)}">${d.ativo ? 'ligado' : 'desligado'}</button></td>
          <td class="num"><button class="botao-perigo" data-apagar="${esc(d.id)}">Remover</button></td>
        </tr>`,
        )
        .join('')}</tbody></table>`

  return form + tabela
}

// ─── Tela: Motor ─────────────────────────────────────────────────

async function telaMotor() {
  const s = await api('/motor/status')

  const destinos = s.destinos
    .map(
      (d) => `<tr>
      <td><b>${esc(d.nome)}</b></td>
      <td>${d.bloqueio ? `<span class="selo selo-nao">${esc(d.bloqueio)}</span>` : '<span class="selo selo-ok">liberado agora</span>'}${d.proximaJanela ? `<br><span style="color:var(--tenue);font-size:12px">próxima janela ${esc(d.proximaJanela)}</span>` : ''}</td>
      <td class="num">${d.publicadosHoje}/${d.limiteDiario}</td>
    </tr>`,
    )
    .join('')

  const pubs =
    s.ultimasPublicacoes.length === 0
      ? '<tr><td colspan="3" style="color:var(--fraco)">Nada publicado ainda.</td></tr>'
      : s.ultimasPublicacoes
          .map(
            (p) => `<tr><td>${dataHora(p.publicadoEm)}</td><td>${esc(p.itemId)}</td><td>${esc(p.destinoId)}</td></tr>`,
          )
          .join('')

  return `
  <h2 class="titulo-secao">Motor</h2>
  <p class="sub">Etiqueta em uso: <b>${esc(s.etiqueta ?? 'nenhuma')}</b> · ${s.agendamentosPendentes} programados pendentes.
  O motor roda por agendamento externo (cron); esta tela mostra o que ele faria agora.</p>

  <div class="aviso">Uma rodada publica no máximo uma oferta por destino liberado.
  Quem controla o ritmo é a janela de cada destino, não a frequência da execução.</div>

  <table class="tabela" style="margin-bottom:22px">
    <thead><tr><th>Destino</th><th>Situação agora</th><th class="num">Hoje</th></tr></thead>
    <tbody>${destinos || '<tr><td colspan="3" style="color:var(--fraco)">Nenhum destino cadastrado.</td></tr>'}</tbody>
  </table>

  <h2 class="titulo-secao">Últimas publicações</h2>
  <p class="sub">Histórico do que saiu, e onde.</p>
  <table class="tabela">
    <thead><tr><th>Quando</th><th>Produto</th><th>Destino</th></tr></thead>
    <tbody>${pubs}</tbody>
  </table>`
}

// ─── Roteamento e eventos ────────────────────────────────────────

async function telaEventos() {
  const { eventos, errosRecentes } = await api('/eventos')
  const cabecalho = `
    <h2 class="titulo-secao">Eventos</h2>
    <p class="sub">${errosRecentes} ${errosRecentes === 1 ? 'erro' : 'erros'} nas últimas 24h.
    Toda falha de publicação e de geração de link cai aqui, com o erro cru.</p>`

  if (eventos.length === 0) {
    return `${cabecalho}<p class="vazio">Nenhum evento ainda.</p>`
  }

  return `${cabecalho}<div class="tabela">${eventos
    .map(
      (e) => `<div class="evento">
        <span class="quando">${dataHora(e.quando)}</span>
        <span class="${e.nivel === 'erro' ? 'nivel-erro' : 'nivel-info'}">${esc(e.nivel)}</span>
        <span>${esc(e.mensagem)}${e.detalhe ? `<br><span class="detalhe">${esc(e.detalhe)}</span>` : ''}</span>
      </div>`,
    )
    .join('')}</div>`
}

const TELAS = { fila: telaFila, agenda: telaAgenda, destinos: telaDestinos, motor: telaMotor, eventos: telaEventos }

async function render() {
  if (!token()) return pedirToken()
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>'
  try {
    conteudo.innerHTML = await TELAS[tela]()
  } catch (e) {
    conteudo.innerHTML = `<div class="aviso erro">Falhou: ${esc(e.message)}</div>`
  }
}

document.querySelectorAll('.aba').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.aba').forEach((x) => x.classList.remove('ativa'))
    b.classList.add('ativa')
    tela = b.dataset.tela
    render()
  }),
)

conteudo.addEventListener('click', async (ev) => {
  const alvo = ev.target
  if (!(alvo instanceof HTMLElement)) return

  const acao = alvo.dataset.acao
  if (acao) {
    const itemId = alvo.closest('.oferta')?.dataset.item
    if (!itemId) return
    if (acao === 'agendar') return abrirAgendar(itemId, alvo.closest('.oferta').querySelector('.titulo').textContent)
    await api('/decisao', { method: 'POST', body: JSON.stringify({ itemId, estado: acao }) })
    return render()
  }

  if (alvo.dataset.cancelar) {
    await api(`/agendamentos/${alvo.dataset.cancelar}`, { method: 'DELETE' })
    return render()
  }

  if (alvo.dataset.apagar) {
    await api(`/destinos/${encodeURIComponent(alvo.dataset.apagar)}`, { method: 'DELETE' })
    return render()
  }

  if (alvo.dataset.alternar) {
    const d = destinosCache.find((x) => x.id === alvo.dataset.alternar)
    if (d) {
      await api('/destinos', { method: 'POST', body: JSON.stringify({ ...d, ativo: !d.ativo }) })
      render()
    }
    return
  }

  if (alvo.id === 'salvar-destino') {
    const corpo = {
      id: document.getElementById('d-id').value.trim(),
      chatId: document.getElementById('d-chat').value.trim(),
      nome: document.getElementById('d-nome').value.trim(),
      janelas: document.getElementById('d-janelas').value.split(',').map((s) => s.trim()).filter(Boolean),
      limiteDiario: Number(document.getElementById('d-limite').value),
      intervaloMinutos: Number(document.getElementById('d-intervalo').value),
      ativo: true,
    }
    try {
      await api('/destinos', { method: 'POST', body: JSON.stringify(corpo) })
      render()
    } catch (e) {
      alert(`Não deu para salvar: ${e.message}`)
    }
  }
})

function abrirAgendar(itemId, titulo) {
  document.getElementById('agendar-titulo').textContent = titulo
  const sel = document.getElementById('agendar-destino')
  sel.innerHTML = destinosCache.map((d) => `<option value="${esc(d.id)}">${esc(d.nome)}</option>`).join('')

  const daquiUmaHora = new Date(Date.now() + 3600_000 - new Date().getTimezoneOffset() * 60_000)
  document.getElementById('agendar-quando').value = daquiUmaHora.toISOString().slice(0, 16)

  dlgAgendar.returnValue = ''
  dlgAgendar.showModal()
  dlgAgendar.onclose = async () => {
    if (dlgAgendar.returnValue !== 'ok') return
    try {
      await api('/agendamentos', {
        method: 'POST',
        body: JSON.stringify({
          itemId,
          destinoId: sel.value,
          quando: new Date(document.getElementById('agendar-quando').value).toISOString(),
        }),
      })
      tela = 'agenda'
      document.querySelectorAll('.aba').forEach((x) => x.classList.toggle('ativa', x.dataset.tela === 'agenda'))
      render()
    } catch (e) {
      alert(`Não deu para programar: ${e.message}`)
    }
  }
}

render()

// ─── Ações: os botões que fazem coisa ────────────────────────────

const estadoTarefa = document.getElementById('estado-tarefa')
const logTarefa = document.getElementById('log-tarefa')
const badgeErros = document.getElementById('badge-erros')
let vigiando = null

document.querySelectorAll('[data-acao-motor]').forEach((b) =>
  b.addEventListener('click', async () => {
    const nome = b.dataset.acaoMotor
    if (nome === 'publicar' && !confirm('Isso publica de verdade nos destinos liberados. Confirma?')) return
    try {
      const { tarefa } = await api(`/acoes/${nome}`, { method: 'POST' })
      mostrarTarefa(tarefa)
      vigiar()
    } catch (e) {
      estadoTarefa.className = 'estado-tarefa falhou'
      estadoTarefa.textContent = e.message
    }
  }),
)

function mostrarTarefa(t) {
  if (!t) {
    estadoTarefa.textContent = ''
    return
  }
  const rotulos = { rodando: 'rodando…', ok: 'concluído', falhou: 'falhou' }
  estadoTarefa.className = `estado-tarefa ${t.estado}`
  estadoTarefa.textContent = `${t.rotulo}: ${rotulos[t.estado] ?? t.estado}`
  logTarefa.classList.remove('oculto')
  logTarefa.textContent = t.linhas.join('\n')
  logTarefa.scrollTop = logTarefa.scrollHeight
}

function vigiar() {
  if (vigiando) return
  vigiando = setInterval(async () => {
    try {
      const { tarefa } = await api('/acoes/estado')
      mostrarTarefa(tarefa)
      if (!tarefa || tarefa.estado !== 'rodando') {
        clearInterval(vigiando)
        vigiando = null
        atualizarBadge()
        render() // a tela reflete o que a tarefa mudou
      }
    } catch {
      clearInterval(vigiando)
      vigiando = null
    }
  }, 1500)
}

async function atualizarBadge() {
  try {
    const { errosRecentes } = await api('/eventos')
    badgeErros.textContent = errosRecentes
    badgeErros.classList.toggle('oculto', errosRecentes === 0)
  } catch {
    /* badge é enfeite: se falhar, não atrapalha o resto */
  }
}

// ─── Filtros e copiar link ───────────────────────────────────────

conteudo.addEventListener('input', (ev) => {
  if (ev.target.id === 'busca') {
    filtro.busca = ev.target.value
    const foco = document.activeElement === ev.target
    render().then(() => {
      if (foco) {
        const campo = document.getElementById('busca')
        campo?.focus()
        campo?.setSelectionRange(campo.value.length, campo.value.length)
      }
    })
  }
})

conteudo.addEventListener('click', async (ev) => {
  const alvo = ev.target
  if (!(alvo instanceof HTMLElement)) return

  if (alvo.dataset.filtro) {
    filtro.so = alvo.dataset.filtro
    return render()
  }

  if (alvo.dataset.copiar) {
    try {
      await navigator.clipboard.writeText(alvo.dataset.copiar)
      const antes = alvo.textContent
      alvo.textContent = 'copiado'
      setTimeout(() => (alvo.textContent = antes), 1200)
    } catch {
      alvo.textContent = 'copie manualmente'
    }
  }
})

// Estado inicial das ações e do contador de erros
api('/acoes/estado')
  .then(({ tarefa }) => {
    if (tarefa) {
      mostrarTarefa(tarefa)
      if (tarefa.estado === 'rodando') vigiar()
    }
  })
  .catch(() => {})
atualizarBadge()
