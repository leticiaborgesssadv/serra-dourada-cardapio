import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, getEstabelecimentoId, formatarMoeda } from "../lib/supabase.js";

const html = htm.bind(h);

const CATEGORIAS = [
  "Fornecedores", "Folha", "Encargos", "Aluguel", "Energia", "Água", "Gás",
  "Sistemas", "Contabilidade", "Marketing", "Manutenção", "Limpeza",
  "Administrativo", "Taxas de cartão", "Delivery", "Impostos", "Outras despesas",
];

function primeiroDiaMesISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}
function diasNoMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function diaAtualDoMes() {
  return new Date().getDate();
}
function nomeMesAtual() {
  return new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function PainelMeta() {
  const [meta, setMeta] = useState(null);
  const [faturamentoAtual, setFaturamentoAtual] = useState(0);
  const [valorMeta, setValorMeta] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function carregar() {
    const mes = primeiroDiaMesISO();
    const [metaRes, vendasRes] = await Promise.all([
      sb.from("meta_faturamento").select("*").eq("mes", mes).maybeSingle(),
      sb.from("venda").select("valor_liquido, cancelado").gte("data_hora", new Date(mes + "T00:00:00").toISOString()),
    ]);
    setMeta(metaRes.data || null);
    setValorMeta(metaRes.data ? metaRes.data.valor_meta : "");
    const total = (vendasRes.data || []).filter((v) => !v.cancelado).reduce((acc, v) => acc + Number(v.valor_liquido), 0);
    setFaturamentoAtual(total);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!valorMeta || Number(valorMeta) <= 0) { setErro("Informe um valor de meta maior que zero."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("meta_faturamento").upsert(
        { estabelecimento_id, mes: primeiroDiaMesISO(), valor_meta: Number(valorMeta) },
        { onConflict: "estabelecimento_id,mes" }
      );
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      carregar();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const metaValor = meta ? Number(meta.valor_meta) : 0;
  const percentual = metaValor > 0 ? Math.min(100, (faturamentoAtual / metaValor) * 100) : 0;
  const dias = diasNoMes();
  const diaAtual = diaAtualDoMes();
  const projecao = diaAtual > 0 ? (faturamentoAtual / diaAtual) * dias : 0;

  return html`
    <div class="colunas-financeiro">
      <div>
        <form class="card" onSubmit=${salvar}>
          <h3>Meta de faturamento — ${nomeMesAtual()}</h3>
          <label>Valor da meta (R$)</label>
          <input type="number" step="0.01" min="0.01" value=${valorMeta} onInput=${(e) => setValorMeta(e.target.value)} />
          <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : meta ? "Atualizar meta" : "Definir meta"}</button>
          ${erro && html`<div class="msg-erro">${erro}</div>`}
        </form>
      </div>
      <div>
        <div class="card">
          <h3>Progresso do mês</h3>
          ${!meta
            ? html`<p class="vazio">Defina uma meta ao lado para acompanhar o progresso.</p>`
            : html`
              <div class="stat-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 14px;">
                <div class="stat-box"><div class="stat-num">${formatarMoeda(faturamentoAtual)}</div><div class="stat-lbl">Atual</div></div>
                <div class="stat-box"><div class="stat-num">${formatarMoeda(metaValor)}</div><div class="stat-lbl">Meta</div></div>
              </div>
              <div class="barra-linha">
                <span class="rotulo">${percentual.toFixed(0)}%</span>
                <div class="barra"><div class="barra-preenchida" style="width: ${percentual}%"></div></div>
                <span class="valor">${formatarMoeda(faturamentoAtual)}</span>
              </div>
              <p class="desc-form" style="margin-top: 14px;">
                Projeção de fechamento do mês (com base no ritmo atual): <strong style="color: var(--dourado-claro)">${formatarMoeda(projecao)}</strong>
                ${projecao >= metaValor ? " — no ritmo de bater a meta." : " — abaixo do ritmo necessário para bater a meta."}
              </p>
            `}
        </div>
      </div>
    </div>
  `;
}

function PainelOrcamento() {
  const [orcamentos, setOrcamentos] = useState([]);
  const [realizado, setRealizado] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [valorOrcado, setValorOrcado] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function carregar() {
    const mes = primeiroDiaMesISO();
    const [orcRes, contasRes] = await Promise.all([
      sb.from("orcamento_categoria").select("*").eq("mes", mes),
      sb.from("conta_pagar").select("categoria, valor, status, pago_em").gte("emissao", mes),
    ]);
    setOrcamentos(orcRes.data || []);
    const porCategoria = {};
    (contasRes.data || []).forEach((c) => {
      porCategoria[c.categoria] = (porCategoria[c.categoria] || 0) + Number(c.valor);
    });
    setRealizado(porCategoria);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!valorOrcado || Number(valorOrcado) < 0) { setErro("Informe um valor de orçamento."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("orcamento_categoria").upsert(
        { estabelecimento_id, mes: primeiroDiaMesISO(), categoria, valor_orcado: Number(valorOrcado) },
        { onConflict: "estabelecimento_id,mes,categoria" }
      );
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setValorOrcado("");
      carregar();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const orcadoPorCategoria = useMemo(() => Object.fromEntries(orcamentos.map((o) => [o.categoria, Number(o.valor_orcado)])), [orcamentos]);
  const categoriasComDado = Array.from(new Set([...Object.keys(orcadoPorCategoria), ...Object.keys(realizado)]));

  return html`
    <div class="colunas-financeiro">
      <div>
        <form class="card" onSubmit=${salvar}>
          <h3>Orçar categoria — ${nomeMesAtual()}</h3>
          <label>Categoria</label>
          <select value=${categoria} onChange=${(e) => setCategoria(e.target.value)}>${CATEGORIAS.map((c) => html`<option value=${c}>${c}</option>`)}</select>
          <label>Valor orçado (R$)</label>
          <input type="number" step="0.01" min="0" value=${valorOrcado} onInput=${(e) => setValorOrcado(e.target.value)} />
          <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Salvar orçamento"}</button>
          ${erro && html`<div class="msg-erro">${erro}</div>`}
        </form>
      </div>
      <div>
        <h3 class="titulo-lista">Orçado × Realizado</h3>
        ${!categoriasComDado.length && html`<p class="vazio">Nenhum orçamento definido ainda.</p>`}
        ${categoriasComDado.map((cat) => {
          const orcado = orcadoPorCategoria[cat] || 0;
          const gasto = realizado[cat] || 0;
          const pct = orcado > 0 ? Math.min(100, (gasto / orcado) * 100) : (gasto > 0 ? 100 : 0);
          const estourou = orcado > 0 && gasto > orcado;
          return html`
            <div class="card" key=${cat} style="padding: 12px 16px;">
              <div class="item-conta-topo">
                <span class="item-conta-desc">${cat}</span>
                <span class="${estourou ? "chip chip-erro" : "chip chip-neutro"}">${formatarMoeda(gasto)} / ${orcado > 0 ? formatarMoeda(orcado) : "sem orçamento"}</span>
              </div>
              ${orcado > 0 && html`
                <div class="barra-linha" style="margin-top: 8px;">
                  <span class="rotulo"></span>
                  <div class="barra"><div class="barra-preenchida" style="width: ${pct}%; ${estourou ? "background: var(--erro);" : ""}"></div></div>
                  <span class="valor">${pct.toFixed(0)}%</span>
                </div>
              `}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

export default function Metas() {
  const [aba, setAba] = useState("meta");
  return html`
    <div>
      <h2>Metas e orçamento</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "meta" ? " ativo" : "")} onClick=${() => setAba("meta")}>Meta do mês</button>
        <button class=${"sub-tab" + (aba === "orcamento" ? " ativo" : "")} onClick=${() => setAba("orcamento")}>Orçamento</button>
      </div>
      ${aba === "meta" ? html`<${PainelMeta} />` : html`<${PainelOrcamento} />`}
    </div>
  `;
}
