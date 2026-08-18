// Painel de ofertas — JS de módulo nativo, sem build.
// O token fica no localStorage e vai em header; nunca na URL.

const CHAVE_TOKEN = 'painel_token'
const conteudo = document.getElementById('conteudo')
const dlgToken = document.getElementById('dlg-token')
const dlgAgendar = document.getElementById('dlg-agendar')

let tela = 'inicio'
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

async function telaInicio() {
  const { passos, metricas } = await api('/resumo')
  const feitos = passos.filter((p) => p.feito).length
  const hora = new Date().getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  const onboarding =
    feitos === passos.length
      ? ''
      : `<div class="onboarding">
      <div class="onboarding-topo">
        <h3>Configure em poucos minutos</h3>
        <span class="contagem">${feitos}/${passos.length} concluídos</span>
        <span class="restante">${passos.length - feitos} ${passos.length - feitos === 1 ? 'pendente' : 'pendentes'}</span>
      </div>
      <div class="trilho-progresso"><span style="width:${Math.round((feitos / passos.length) * 100)}%"></span></div>
      ${passos
        .map(
          (p) => `<div class="passo ${p.feito ? 'feito' : 'pendente'}">
            <span class="marca">${p.feito ? '✓' : ''}</span>
            <span class="texto">
              <span class="titulo-passo">${esc(p.titulo)}</span><br>
              <span class="detalhe-passo">${esc(p.detalhe)}</span>
            </span>
            ${!p.feito && p.acao ? `<button class="botao" data-acao-motor="${esc(p.acao)}">Fazer agora</button>` : ''}
          </div>`,
        )
        .join('')}
    </div>`

  return `
  <div class="cabecalho-tela">
    <h2>${saudacao}, Guilherme</h2>
    <p>Visão geral da sua operação de afiliado.</p>
  </div>

  ${onboarding}

  <div class="metricas">
    <div class="metrica destaque"><div class="rotulo">ofertas na base</div><div class="valor">${metricas.ofertas}</div></div>
    <div class="metrica"><div class="rotulo">publicadas hoje</div><div class="valor">${metricas.publicadasHoje}</div></div>
    <div class="metrica"><div class="rotulo">publicadas no total</div><div class="valor">${metricas.publicadasTotal}</div></div>
    <div class="metrica"><div class="rotulo">programadas</div><div class="valor">${metricas.agendamentosPendentes}</div></div>
    <div class="metrica ${metricas.erros24h > 0 ? 'alerta' : ''}"><div class="rotulo">erros em 24h</div><div class="valor">${metricas.erros24h}</div></div>
  </div>`
}

async function telaConfig() {
  const i = await api('/integracoes')
  const linha = (m) => `<tr>
    <td><b>${esc(m.nome)}</b><br><span style="color:var(--tenue);font-size:12px">${m.tipo === 'fonte' ? 'busca de ofertas' : 'geração de link'}</span></td>
    <td>${m.ok ? '<span class="selo selo-ok">conectado</span>' : '<span class="selo selo-nao">falta configurar</span>'}</td>
    <td style="color:var(--fraco);font-size:12px">${esc(m.motivo ?? '')}</td>
  </tr>`

  return `
  <div class="cabecalho-tela">
    <h2>Configurações</h2>
    <p>Suas conexões e integrações. As credenciais ficam no arquivo <code>.env</code>, nunca no navegador.</p>
  </div>

  <div class="aviso info">A Shopee tem API oficial de afiliado — geração de link sem navegador e sem captcha.
  O Mercado Livre não tem, e por isso depende de sessão de navegador. Peça o acesso em
  <b>affiliate.shopee.com.br</b>, aba Open API: a análise leva de 5 a 15 dias.</div>

  <table class="tabela" style="margin-bottom:22px">
    <thead><tr><th>Integração</th><th>Situação</th><th>Observação</th></tr></thead>
    <tbody>${i.marketplaces.map(linha).join('')}</tbody>
  </table>

  <table class="tabela">
    <thead><tr><th>Envio</th><th>Situação</th><th>Observação</th></tr></thead>
    <tbody>
      <tr>
        <td><b>Telegram</b><br><span style="color:var(--tenue);font-size:12px">bot de publicação</span></td>
        <td>${i.telegram.configurado ? '<span class="selo selo-ok">conectado</span>' : '<span class="selo selo-nao">falta configurar</span>'}</td>
        <td style="color:var(--fraco);font-size:12px">${i.telegram.configurado ? esc(i.telegram.canal ?? 'sem canal padrão') : 'defina TELEGRAM_BOT_TOKEN no .env'}</td>
      </tr>
      <tr>
        <td><b>Etiqueta de rastreamento</b><br><span style="color:var(--tenue);font-size:12px">atribuição no painel do ML</span></td>
        <td>${i.etiqueta ? '<span class="selo selo-ok">definida</span>' : '<span class="selo selo-nao">sem etiqueta</span>'}</td>
        <td style="color:var(--fraco);font-size:12px">${esc(i.etiqueta ?? 'defina ETIQUETA no .env')}</td>
      </tr>
    </tbody>
  </table>`
}

async function telaCupons() {
  const { cupons } = await api('/cupons')

  const form = `
  <div class="cartao-form">
    <h3 style="margin-bottom:4px">Novo cupom</h3>
    <p class="ajuda" style="margin-bottom:14px">As regras são conferidas produto a produto. Quando nenhuma bate, a mensagem sai sem cupom — nunca com código inválido.</p>
    <div class="grade-form">
      <label>Código <input id="c-codigo" placeholder="BL26R20"></label>
      <label>Desconto % <input id="c-pct" type="number" placeholder="20" min="0" max="100"></label>
      <label>ou valor fixo (R$) <input id="c-fixo" type="number" placeholder="25" min="0"></label>
      <label>Compra mínima (R$) <input id="c-min" type="number" placeholder="sem mínimo" min="0"></label>
      <label>Teto do desconto (R$) <input id="c-teto" type="number" placeholder="sem teto" min="0"></label>
      <label>Vale para (palavras) <input id="c-cat" placeholder="fone, cafeteira"></label>
      <label>Válido até <input id="c-ate" type="date"></label>
    </div>
    <div class="acoes-form"><button class="botao" id="salvar-cupom">Adicionar cupom</button></div>
  </div>`

  const lista =
    cupons.length === 0
      ? '<p class="vazio">Nenhum cupom cadastrado.</p>'
      : `<table class="tabela">
      <thead><tr><th>Código</th><th>Desconto</th><th>Regras</th><th>Validade</th><th></th></tr></thead>
      <tbody>${cupons
        .map((c) => {
          const regras = [
            c.compraMinima ? `mín. ${brl(c.compraMinima)}` : '',
            c.tetoDesconto ? `teto ${brl(c.tetoDesconto)}` : '',
            (c.categorias ?? []).length ? `vale em: ${c.categorias.join(', ')}` : 'vale em tudo',
          ].filter(Boolean)
          return `<tr>
            <td><b>${esc(c.codigo)}</b></td>
            <td>${c.percentual ? c.percentual + '%' : brl(c.valorFixo ?? 0)}</td>
            <td style="font-size:12px;color:var(--fraco)">${regras.join(' · ')}</td>
            <td style="font-size:12px">${c.validoAte ? dataHora(c.validoAte) : 'sem prazo'}</td>
            <td class="num">
              <button class="botao-mini" data-previa-cupom="${esc(c.codigo)}">prévia</button>
              <button class="botao-perigo" data-apagar-cupom="${esc(c.codigo)}">remover</button>
            </td>
          </tr>`
        })
        .join('')}</tbody></table>
      <div id="previa-cupom"></div>`

  return `<div class="cabecalho-tela"><h2>Cupons</h2>
    <p>Cadastre o cupom uma vez. A cada envio o sistema confere as regras dele e, quando o produto se encaixa, calcula o preço final e manda o código junto.</p></div>` + form + lista
}

async function telaListas() {
  const { listas } = await api('/listas')

  const form = `
  <div class="cartao-form">
    <h3 style="margin-bottom:4px">Nova lista</h3>
    <p class="ajuda" style="margin-bottom:14px">Listas expiram sozinhas: oferta velha em lista antiga é a forma mais fácil de publicar preço errado.</p>
    <div class="grade-form">
      <label>Identificador <input id="l-id" placeholder="black-friday"></label>
      <label>Nome <input id="l-nome" placeholder="Black Friday"></label>
      <label>Expira em (horas) <input id="l-horas" type="number" value="48" min="1"></label>
    </div>
    <div class="acoes-form"><button class="botao" id="salvar-lista">Criar lista</button></div>
  </div>`

  const lista =
    listas.length === 0
      ? '<p class="vazio">Nenhuma lista. Crie uma para juntar ofertas escolhidas a dedo.</p>'
      : `<table class="tabela">
      <thead><tr><th>Lista</th><th class="num">Itens</th><th>Expira</th><th></th></tr></thead>
      <tbody>${listas
        .map(
          (l) => `<tr>
          <td><b>${esc(l.nome)}</b><br><span style="color:var(--tenue);font-size:12px">${esc(l.id)}</span></td>
          <td class="num">${l.itens.length}</td>
          <td>${l.expiraEm ? (l.expirada ? '<span class="selo selo-erro">expirada</span>' : dataHora(l.expiraEm)) : 'sem prazo'}</td>
          <td class="num"><button class="botao-perigo" data-apagar-lista="${esc(l.id)}">remover</button></td>
        </tr>`,
        )
        .join('')}</tbody></table>`

  return `<div class="cabecalho-tela"><h2>Listas</h2>
    <p>Coleções curadas à mão, com expiração automática.</p></div>` + form + lista
}

async function telaBuscas() {
  const { buscas } = await api('/buscas')

  const form = `
  <div class="cartao-form">
    <h3 style="margin-bottom:4px">Nova busca</h3>
    <p class="ajuda" style="margin-bottom:14px">Buscas salvas alimentam a base a cada coleta. Na Shopee a busca por termo é oficial; no Mercado Livre o feed do hub não aceita termo, então a palavra-chave filtra o que já foi coletado.</p>
    <div class="grade-form">
      <label>Identificador <input id="b-id" placeholder="fones"></label>
      <label>Termo <input id="b-termo" placeholder="fone bluetooth"></label>
      <label>Marketplace
        <select id="b-marketplace">
          <option value="shopee">Shopee</option>
          <option value="ml">Mercado Livre</option>
        </select>
      </label>
    </div>
    <div class="acoes-form"><button class="botao" id="salvar-busca">Criar busca</button></div>
  </div>`

  const lista =
    buscas.length === 0
      ? '<p class="vazio">Nenhuma busca salva.</p>'
      : `<table class="tabela">
      <thead><tr><th>Busca</th><th>Termo</th><th>Marketplace</th><th></th></tr></thead>
      <tbody>${buscas
        .map(
          (b) => `<tr>
          <td><b>${esc(b.id)}</b></td>
          <td>${esc(b.termo)}</td>
          <td>${b.marketplace === 'shopee' ? 'Shopee' : 'Mercado Livre'}</td>
          <td class="num"><button class="botao-perigo" data-apagar-busca="${esc(b.id)}">remover</button></td>
        </tr>`,
        )
        .join('')}</tbody></table>`

  return `<div class="cabecalho-tela"><h2>Palavras-chave</h2>
    <p>Buscas que capturam produtos automaticamente a cada coleta.</p></div>` + form + lista
}

async function telaAutomacoes() {
  const { automacoes } = await api('/automacoes')
  destinosCache = (await api('/destinos')).destinos

  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

  const form = `
  <div class="cartao-form">
    <h2 class="titulo-secao">Nova automação</h2>
    <p class="sub">Uma automação decide <b>quando</b> enviar e <b>o que</b> enviar. O destino continua com o teto próprio dele.</p>
    <div class="grade-form">
      <label>Identificador <input id="a-id" placeholder="eletronicos-manha"></label>
      <label>Nome <input id="a-nome" placeholder="Eletrônicos de manhã"></label>
      <label>Janelas <input id="a-janelas" placeholder="09:00-12:00, 18:00-21:00"></label>
      <label>Intervalo (min) <input id="a-intervalo" type="number" value="60" min="0"></label>
      <label>Limite diário <input id="a-limite" type="number" value="6" min="1"></label>
      <label>Ganho mínimo (R$) <input id="a-ganho" type="number" value="20" min="0" step="1"></label>
      <label>Nota mínima <input id="a-nota" type="number" value="4" min="0" max="5" step="0.1"></label>
      <label>Vendas mínimas <input id="a-vendas" type="number" value="100" min="0"></label>
      <label>Preço de <input id="a-precomin" type="number" placeholder="sem mínimo" min="0"></label>
      <label>Preço até <input id="a-precomax" type="number" placeholder="sem máximo" min="0"></label>
      <label>Só com estas palavras <input id="a-incluir" placeholder="fone, cafeteira"></label>
      <label>Nunca com estas <input id="a-excluir" placeholder="capinha, adesivo"></label>
      <label>Dias da semana
        <span style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
          ${DIAS.map((d, i) => `<button type="button" class="chip" data-dia="${i}">${d}</button>`).join('')}
        </span>
      </label>
      <label>Destinos
        <span style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
          ${destinosCache.map((d) => `<button type="button" class="chip" data-dest="${esc(d.id)}">${esc(d.nome)}</button>`).join('') || '<span style="color:var(--fraco);font-size:12px">cadastre um destino primeiro</span>'}
        </span>
      </label>
      <label>Só comissão extra
        <span style="display:block;margin-top:6px"><button type="button" class="chip" data-extra="1">somente EXTRA</button></span>
      </label>
    </div>
    <div class="acoes-dialogo"><button class="botao" id="salvar-automacao">Criar automação</button></div>
  </div>`

  const lista =
    automacoes.length === 0
      ? '<p class="vazio">Nenhuma automação. Crie uma acima para o motor começar a publicar sozinho.</p>'
      : `<table class="tabela">
        <thead><tr><th>Automação</th><th>Quando</th><th>Filtro</th><th class="num">Hoje</th><th>Situação</th><th></th></tr></thead>
        <tbody>${automacoes
          .map((a) => {
            const f = a.filtro ?? {}
            const filtros = [
              f.ganhoMinimo ? `ganho ≥ ${brl(f.ganhoMinimo)}` : '',
              f.notaMinima ? `nota ≥ ${f.notaMinima}` : '',
              f.vendasMinimas ? `${f.vendasMinimas}+ vendas` : '',
              f.precoMinimo || f.precoMaximo ? `${brl(f.precoMinimo ?? 0)}–${f.precoMaximo ? brl(f.precoMaximo) : '∞'}` : '',
              f.somenteComissaoExtra ? 'só EXTRA' : '',
              (f.palavrasIncluir ?? []).length ? `com: ${f.palavrasIncluir.join(', ')}` : '',
              (f.palavrasExcluir ?? []).length ? `sem: ${f.palavrasExcluir.join(', ')}` : '',
            ].filter(Boolean)
            return `<tr>
              <td><b>${esc(a.nome)}</b><br><span style="color:var(--tenue);font-size:12px">${a.destinos.length} destino(s) · ${a.candidatas} ofertas servem</span></td>
              <td>${a.janelas.join('<br>') || 'dia todo'}<br><span style="color:var(--tenue);font-size:12px">${a.diasSemana.length ? a.diasSemana.map((d) => DIAS[d]).join(' ') : 'todos os dias'} · a cada ${a.intervaloMinutos} min</span></td>
              <td style="font-size:12px;color:var(--fraco)">${filtros.join('<br>') || 'sem filtro'}</td>
              <td class="num">${a.enviadosHoje}/${a.limiteDiario}</td>
              <td>${a.situacao ? `<span class="selo selo-nao">${esc(a.situacao)}</span>` : '<span class="selo selo-ok">pronta para publicar</span>'}</td>
              <td class="num">
                <button class="botao-fraco" data-pausar="${esc(a.id)}">${a.ativa ? 'pausar' : 'ativar'}</button>
                <button class="botao-perigo" data-apagar-auto="${esc(a.id)}">remover</button>
              </td>
            </tr>`
          })
          .join('')}</tbody></table>`

  return form + lista
}

const TELAS = {
  inicio: telaInicio,
  config: telaConfig,
  cupons: telaCupons,
  listas: telaListas,
  buscas: telaBuscas,
  fila: telaFila,
  automacoes: telaAutomacoes,
  agenda: telaAgenda,
  destinos: telaDestinos,
  motor: telaMotor,
  eventos: telaEventos,
}

async function render() {
  if (!token()) return pedirToken()
  conteudo.innerHTML = '<p class="carregando">Carregando…</p>'
  try {
    conteudo.innerHTML = await TELAS[tela]()
  } catch (e) {
    conteudo.innerHTML = `<div class="aviso erro">Falhou: ${esc(e.message)}</div>`
  }
}

document.querySelectorAll('.item').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.item').forEach((x) => x.classList.remove('ativa'))
    b.classList.add('ativa')
    tela = b.dataset.tela
    document.getElementById('trilha-atual').textContent = b.textContent.trim().replace(/\d+$/, '')
    render()
  }),
)

conteudo.addEventListener('click', async (ev) => {
  const alvo = ev.target
  if (!(alvo instanceof HTMLElement)) return

  const acao = alvo.closest('[data-acao]')?.dataset.acao
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
      document.querySelectorAll('.item').forEach((x) => x.classList.toggle('ativa', x.dataset.tela === 'agenda'))
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

// ─── Automações: seleção por chips e criação ─────────────────────

conteudo.addEventListener('click', async (ev) => {
  const alvo = ev.target
  if (!(alvo instanceof HTMLElement)) return

  // chips de dia, destino e "só extra" alternam sozinhos
  if (alvo.dataset.dia !== undefined || alvo.dataset.dest !== undefined || alvo.dataset.extra !== undefined) {
    alvo.classList.toggle('ativo')
    return
  }

  if (alvo.dataset.pausar) {
    const { automacoes } = await api('/automacoes')
    const a = automacoes.find((x) => x.id === alvo.dataset.pausar)
    if (a) {
      await api('/automacoes', { method: 'POST', body: JSON.stringify({ ...a, ativa: !a.ativa }) })
      render()
    }
    return
  }

  if (alvo.dataset.apagarAuto) {
    if (!confirm('Remover esta automação?')) return
    await api(`/automacoes/${encodeURIComponent(alvo.dataset.apagarAuto)}`, { method: 'DELETE' })
    return render()
  }

  if (alvo.id === 'salvar-automacao') {
    const num = (id) => {
      const v = document.getElementById(id).value.trim()
      return v === '' ? undefined : Number(v)
    }
    const lista = (id) =>
      document.getElementById(id).value.split(',').map((s) => s.trim()).filter(Boolean)

    const corpo = {
      id: document.getElementById('a-id').value.trim(),
      nome: document.getElementById('a-nome').value.trim(),
      ativa: true,
      janelas: lista('a-janelas'),
      intervaloMinutos: num('a-intervalo') ?? 60,
      limiteDiario: num('a-limite') ?? 6,
      diasSemana: [...document.querySelectorAll('[data-dia].ativo')].map((b) => Number(b.dataset.dia)),
      destinos: [...document.querySelectorAll('[data-dest].ativo')].map((b) => b.dataset.dest),
      filtro: {
        ganhoMinimo: num('a-ganho') ?? 0,
        notaMinima: num('a-nota'),
        vendasMinimas: num('a-vendas'),
        precoMinimo: num('a-precomin'),
        precoMaximo: num('a-precomax'),
        palavrasIncluir: lista('a-incluir'),
        palavrasExcluir: lista('a-excluir'),
        somenteComissaoExtra: Boolean(document.querySelector('[data-extra].ativo')),
        exigirDescontoConfirmado: false,
      },
    }

    if (!corpo.id || !corpo.nome) return alert('Identificador e nome são obrigatórios.')
    if (corpo.destinos.length === 0) return alert('Escolha ao menos um destino.')

    try {
      await api('/automacoes', { method: 'POST', body: JSON.stringify(corpo) })
      render()
    } catch (e) {
      alert(`Não deu para criar: ${e.message}`)
    }
  }
})

// ─── Cupons, listas e buscas: criação e remoção ──────────────────

conteudo.addEventListener('click', async (ev) => {
  const alvo = ev.target
  if (!(alvo instanceof HTMLElement)) return

  const num = (id) => {
    const v = document.getElementById(id)?.value.trim()
    return !v ? undefined : Number(v)
  }
  const txt = (id) => document.getElementById(id)?.value.trim() ?? ''
  const listaDe = (id) => txt(id).split(',').map((s) => s.trim()).filter(Boolean)

  if (alvo.id === 'salvar-cupom') {
    const corpo = {
      codigo: txt('c-codigo'),
      percentual: num('c-pct'),
      valorFixo: num('c-fixo'),
      compraMinima: num('c-min'),
      tetoDesconto: num('c-teto'),
      categorias: listaDe('c-cat'),
      validoAte: txt('c-ate') ? new Date(txt('c-ate') + 'T23:59:59').toISOString() : undefined,
      ativo: true,
    }
    try {
      await api('/cupons', { method: 'POST', body: JSON.stringify(corpo) })
      render()
    } catch (e) {
      alert(`Não deu para salvar: ${e.message}`)
    }
    return
  }

  if (alvo.dataset.previaCupom) {
    const p = await api(`/cupons/${encodeURIComponent(alvo.dataset.previaCupom)}/previa`)
    const caixa = document.getElementById('previa-cupom')
    caixa.innerHTML = `<div class="aviso info" style="margin-top:14px">
      Este cupom alcança <b>${p.alcanca}</b> das ${p.total} ofertas da base.
      ${
        p.exemplos.length
          ? '<br>' +
            p.exemplos
              .map((e) => `${esc(e.titulo.slice(0, 46))}: ${brl(e.preco)} → <b>${brl(e.precoFinal)}</b> (economia ${brl(e.economia)})`)
              .join('<br>')
          : ''
      }</div>`
    return
  }

  if (alvo.dataset.apagarCupom) {
    await api(`/cupons/${encodeURIComponent(alvo.dataset.apagarCupom)}`, { method: 'DELETE' })
    return render()
  }

  if (alvo.id === 'salvar-lista') {
    try {
      await api('/listas', {
        method: 'POST',
        body: JSON.stringify({ id: txt('l-id'), nome: txt('l-nome'), horasValidade: num('l-horas') }),
      })
      render()
    } catch (e) {
      alert(`Não deu para criar: ${e.message}`)
    }
    return
  }

  if (alvo.dataset.apagarLista) {
    await api(`/listas/${encodeURIComponent(alvo.dataset.apagarLista)}`, { method: 'DELETE' })
    return render()
  }

  if (alvo.id === 'salvar-busca') {
    try {
      await api('/buscas', {
        method: 'POST',
        body: JSON.stringify({
          id: txt('b-id'),
          termo: txt('b-termo'),
          marketplace: document.getElementById('b-marketplace').value,
          ativa: true,
        }),
      })
      render()
    } catch (e) {
      alert(`Não deu para criar: ${e.message}`)
    }
    return
  }

  if (alvo.dataset.apagarBusca) {
    await api(`/buscas/${encodeURIComponent(alvo.dataset.apagarBusca)}`, { method: 'DELETE' })
    return render()
  }
})
