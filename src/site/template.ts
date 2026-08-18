import { urlImagem, type OfertaPontuada } from '../tipos.ts'

export interface FaixaPreco {
  min: number
  max: number
  amostras: number
}

export interface ItemSite {
  item: OfertaPontuada
  link: string
  faixa?: FaixaPreco
}

/** Veredito do preço de hoje contra tudo que já observamos daquele item. */
export type Veredito = 'menor-ja-visto' | 'perto-do-menor' | 'ja-esteve-menor' | 'primeira-leitura'

export function avaliarPreco(precoAtual: number, faixa?: FaixaPreco): Veredito {
  if (!faixa || faixa.amostras < 2) return 'primeira-leitura'
  if (precoAtual <= faixa.min) return 'menor-ja-visto'
  const amplitude = faixa.max - faixa.min
  if (amplitude <= 0) return 'perto-do-menor'
  return (precoAtual - faixa.min) / amplitude <= 0.15 ? 'perto-do-menor' : 'ja-esteve-menor'
}

const ROTULO: Record<Veredito, string> = {
  'menor-ja-visto': 'Menor preço que já vimos',
  'perto-do-menor': 'Perto do menor que já vimos',
  'ja-esteve-menor': 'Já esteve mais barato',
  'primeira-leitura': 'Primeira leitura deste preço',
}

/** Posição de 0 a 100 do preço de hoje dentro da faixa observada. */
export function posicaoNaRegua(precoAtual: number, faixa?: FaixaPreco): number | undefined {
  if (!faixa || faixa.amostras < 2 || faixa.max <= faixa.min) return undefined
  const p = ((precoAtual - faixa.min) / (faixa.max - faixa.min)) * 100
  return Math.max(0, Math.min(100, Math.round(p)))
}

export function gerarHtml(itens: ItemSite[], geradoEm: Date): string {
  const auditadas = itens.filter((i) => (i.faixa?.amostras ?? 0) >= 2).length
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ofertas conferidas</title>
<meta name="description" content="Ofertas do Mercado Livre com o preço conferido contra o histórico registrado a cada coleta.">
<meta name="robots" content="noindex">
<style>${CSS}</style>
</head>
<body>
<header class="barra">
  <div class="barra-interna">
    <p class="marca">Ofertas conferidas</p>
    <p class="resumo">${itens.length} ofertas · ${auditadas} com histórico de preço · ${fmtData(geradoEm)}</p>
  </div>
</header>

<main class="grade">
${itens.map(cartao).join('\n')}
</main>

<footer>
  <p><b>Site independente.</b> Não é o Mercado Livre e não tem relação oficial com a empresa.</p>
  <p>Os links levam ao Mercado Livre e são de afiliado: se você comprar, eles pagam uma comissão
  a quem publicou, sem custo extra pra você.</p>
  <p>Preço muda a toda hora — o valor que vale é o que aparece lá na hora da compra.</p>
</footer>
</body>
</html>`
}

function cartao(i: ItemSite): string {
  const o = i.item.oferta
  const veredito = avaliarPreco(o.precoAtual, i.faixa)
  const pos = posicaoNaRegua(o.precoAtual, i.faixa)
  const desconto =
    o.precoAnterior && o.precoAnterior > o.precoAtual
      ? Math.floor((1 - o.precoAtual / o.precoAnterior) * 100)
      : undefined
  const foto = urlImagem(o.imagemId, o.imagemUrl)
  const href = escapar(i.link)

  return `<article class="cartao">
  <a class="foto" href="${href}" rel="nofollow sponsored noopener" target="_blank" tabindex="-1" aria-hidden="true">
    ${foto ? `<img src="${escapar(foto)}" alt="" loading="lazy" width="300" height="300">` : '<span class="semfoto"></span>'}
  </a>

  <div class="conteudo">
    <h2><a href="${href}" rel="nofollow sponsored noopener" target="_blank">${escapar(o.titulo)}</a></h2>

    ${o.precoAnterior ? `<p class="antes">R$ ${valor(o.precoAnterior)}</p>` : '<p class="antes">&nbsp;</p>'}
    <p class="agora">
      <span class="valor">R$ ${valor(o.precoAtual)}</span>
      ${desconto ? `<span class="off">${desconto}% OFF</span>` : ''}
    </p>

    <p class="social">
      ${o.rating ? `<span class="nota">${String(o.rating).replace('.', ',')}</span>` : ''}
      ${o.vendas ? `<span>${o.vendas.toLocaleString('pt-BR')} vendidos</span>` : ''}
    </p>

    <div class="conferido" data-veredito="${veredito}">
      <p class="parecer">${ROTULO[veredito]}</p>
      ${
        pos === undefined
          ? ''
          : `<div class="trilho" role="img" aria-label="Hoje R$ ${valor(o.precoAtual)}. Menor observado R$ ${valor(i.faixa!.min)}, maior R$ ${valor(i.faixa!.max)}, em ${i.faixa!.amostras} leituras.">
               <span class="marca-preco" style="left:${pos}%"></span>
             </div>
             <p class="extremos"><span>R$ ${valor(i.faixa!.min)}</span><span>R$ ${valor(i.faixa!.max)}</span></p>`
      }
    </div>

    <a class="botao" href="${href}" rel="nofollow sponsored noopener" target="_blank">Ver no Mercado Livre</a>
  </div>
</article>`
}

/** 8399 → "8.399,00" — sem o ponto de milhar o preço fica ilegível. */
const valor = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtData = (d: Date) =>
  d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Feed JSON para consumir a curadoria em outro lugar. */
export function gerarFeed(itens: ItemSite[], geradoEm: Date): string {
  return JSON.stringify(
    {
      gerado_em: geradoEm.toISOString(),
      ofertas: itens.map((i) => ({
        id: i.item.oferta.itemId,
        titulo: i.item.oferta.titulo,
        preco: i.item.oferta.precoAtual,
        preco_anterior: i.item.oferta.precoAnterior ?? null,
        imagem: urlImagem(i.item.oferta.imagemId, i.item.oferta.imagemUrl) ?? null,
        veredito: avaliarPreco(i.item.oferta.precoAtual, i.faixa),
        menor_observado: i.faixa?.min ?? null,
        maior_observado: i.faixa?.max ?? null,
        leituras: i.faixa?.amostras ?? 1,
        link: i.link,
      })),
    },
    null,
    2,
  )
}

/*
 * Identidade visual do Mercado Livre, sem imitar a marca:
 * amarelo #FFE600 na barra, azul #3483FA na ação, verde #00A650 no desconto,
 * fundo #EBEBEB, cards brancos com sombra fina e raio 6px. Sem logo, sem nome
 * como se fosse oficial — o rodapé diz que é site independente.
 */
const CSS = `
:root {
  --amarelo: #FFE600;
  --azul: #3483FA;
  --azul-escuro: #2968C8;
  --verde: #00A650;
  --fundo: #EBEBEB;
  --branco: #FFFFFF;
  --texto: #333333;
  --texto-fraco: rgba(0,0,0,.55);
  --texto-tenue: rgba(0,0,0,.35);
  --sombra: 0 1px 2px rgba(0,0,0,.12);
  --sombra-alta: 0 4px 12px rgba(0,0,0,.16);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fundo);
  color: var(--texto);
  font: 400 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}

.barra { background: var(--amarelo); }
.barra-interna {
  max-width: 1200px; margin: 0 auto; padding: 16px 16px 18px;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px;
}
.marca { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.resumo { margin: 0; font-size: 13px; color: rgba(0,0,0,.62); }

.grade {
  max-width: 1200px; margin: 0 auto; padding: 20px 16px 40px;
  display: grid; gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
}

.cartao {
  background: var(--branco); border-radius: 6px; box-shadow: var(--sombra);
  overflow: hidden; display: flex; flex-direction: column;
}
.foto {
  display: grid; place-items: center; aspect-ratio: 1;
  background: var(--branco); padding: 14px; min-height: 0;
}
/* max-* em vez de width/height 100%: com height:100% a imagem impõe a própria
   altura ao pai e o aspect-ratio é ignorado, desalinhando a grade inteira. */
.foto img { max-width: 100%; max-height: 100%; object-fit: contain; }
.semfoto { display: block; width: 100%; height: 100%; background: #f5f5f5; border-radius: 4px; }

.conteudo { padding: 0 16px 16px; display: flex; flex-direction: column; flex: 1; }
h2 { margin: 0 0 10px; font-size: 14px; font-weight: 400; line-height: 1.3; }
h2 a { color: var(--texto); text-decoration: none; }
h2 a:hover { color: var(--azul); }

.antes { margin: 0; font-size: 12px; color: var(--texto-tenue); text-decoration: line-through; min-height: 16px; }
.agora { margin: 2px 0 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.valor { font-size: 24px; font-weight: 400; letter-spacing: -.02em; }
.off { font-size: 13px; font-weight: 600; color: var(--verde); }

.social { margin: 8px 0 0; font-size: 12px; color: var(--texto-fraco); display: flex; gap: 10px; }
.nota::after { content: " ★"; color: var(--azul); }

/* A conferência de preço: o que este site tem e uma vitrine comum não tem. */
.conferido { margin: 12px 0 14px; padding: 10px 0 0; border-top: 1px solid #ededed; }
.parecer { margin: 0; font-size: 12px; font-weight: 600; color: var(--texto-fraco); }
[data-veredito="menor-ja-visto"] .parecer { color: var(--verde); }
[data-veredito="ja-esteve-menor"] .parecer { color: #C75000; }
.trilho {
  position: relative; height: 4px; margin: 8px 0 0; border-radius: 2px;
  background: linear-gradient(90deg, var(--verde), #E0E0E0);
}
.marca-preco {
  position: absolute; top: -3px; width: 2px; height: 10px;
  background: var(--texto); border-radius: 1px; transform: translateX(-1px);
}
.extremos {
  display: flex; justify-content: space-between;
  margin: 5px 0 0; font-size: 11px; color: var(--texto-tenue);
}

.botao {
  display: block; margin-top: auto; padding: 10px 12px;
  background: var(--azul); color: #fff;
  border-radius: 6px; font-size: 14px; font-weight: 600;
  text-align: center; text-decoration: none;
}
.botao:hover { background: var(--azul-escuro); }
.cartao:hover { box-shadow: var(--sombra-alta); }
.botao:focus-visible, h2 a:focus-visible {
  outline: 2px solid var(--azul); outline-offset: 2px;
}

footer {
  max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px;
  color: var(--texto-fraco); font-size: 12px; line-height: 1.6;
}
footer p { margin: 0 0 6px; max-width: 70ch; }
footer b { color: var(--texto); }

@media (prefers-reduced-motion: no-preference) {
  .cartao, .botao { transition: box-shadow .15s ease, background .15s ease; }
}
@media (max-width: 420px) {
  .grade { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
  .conteudo { padding: 0 12px 12px; }
  .valor { font-size: 20px; }
}
`
