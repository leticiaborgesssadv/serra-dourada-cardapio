import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, getEstabelecimentoId, formatarMoeda, formatarData, hojeISO } from "../lib/supabase.js";

const html = htm.bind(h);

function FormaFornecedor({ onSalvo }) {
  const [nome, setNome] = useState("");
  const [contato, setContato] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Preencha o nome do fornecedor."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("fornecedor").insert({
        estabelecimento_id,
        nome: nome.trim(),
        contato: contato.trim() || null,
        lead_time_dias: leadTime ? Number(leadTime) : null,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setContato(""); setLeadTime("");
      onSalvo();
    } catch (e) {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo fornecedor</h3>
      <label>Nome</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Distribuidora Central" />
      <div class="linha-campos">
        <div>
          <label>Contato (telefone/WhatsApp)</label>
          <input type="text" value=${contato} onInput=${(e) => setContato(e.target.value)} placeholder="Ex.: 62999998888" />
        </div>
        <div>
          <label>Prazo de entrega (dias)</label>
          <input type="number" min="0" step="1" value=${leadTime} onInput=${(e) => setLeadTime(e.target.value)} />
        </div>
      </div>
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar fornecedor"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelFornecedores() {
  const [fornecedores, setFornecedores] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("fornecedor").select("*").order("nome");
    setFornecedores(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando fornecedores…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div><${FormaFornecedor} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Fornecedores cadastrados</h3>
        ${!fornecedores.length && html`<p class="vazio">Nenhum fornecedor cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${fornecedores.map((f) => html`
            <div class="item-conta" key=${f.id}>
              <div class="item-conta-topo"><span class="item-conta-desc">${f.nome}</span></div>
              <div class="item-conta-meta">
                ${f.contato || "sem contato"}${f.lead_time_dias != null ? ` · prazo de ${f.lead_time_dias} dias` : ""}
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function FormaCotacao({ insumos, fornecedores, onSalvo }) {
  const [insumoId, setInsumoId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [preco, setPreco] = useState("");
  const [prazoDias, setPrazoDias] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!insumoId || !fornecedorId || !preco || Number(preco) <= 0) {
      setErro("Selecione o insumo, o fornecedor e informe o preço.");
      return;
    }
    setSalvando(true);
    const r = await sb.from("cotacao").insert({
      insumo_id: insumoId,
      fornecedor_id: fornecedorId,
      preco: Number(preco),
      prazo_dias: prazoDias ? Number(prazoDias) : null,
      data: hojeISO(),
    });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setPreco(""); setPrazoDias("");
    onSalvo();
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Registrar cotação</h3>
      <div class="linha-campos">
        <div>
          <label>Insumo</label>
          <select value=${insumoId} onChange=${(e) => setInsumoId(e.target.value)}>
            <option value="">Selecione…</option>
            ${insumos.map((i) => html`<option value=${i.id}>${i.nome}</option>`)}
          </select>
        </div>
        <div>
          <label>Fornecedor</label>
          <select value=${fornecedorId} onChange=${(e) => setFornecedorId(e.target.value)}>
            <option value="">Selecione…</option>
            ${fornecedores.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
          </select>
        </div>
      </div>
      <div class="linha-campos">
        <div>
          <label>Preço cotado (R$)</label>
          <input type="number" step="0.01" min="0.01" value=${preco} onInput=${(e) => setPreco(e.target.value)} />
        </div>
        <div>
          <label>Prazo de entrega (dias)</label>
          <input type="number" min="0" step="1" value=${prazoDias} onInput=${(e) => setPrazoDias(e.target.value)} />
        </div>
      </div>
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Registrar cotação"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function ComparativoCotacoes({ cotacoes, insumosPorId, fornecedoresPorId }) {
  const porInsumo = useMemo(() => {
    const grupos = {};
    cotacoes.forEach((c) => {
      if (!grupos[c.insumo_id]) grupos[c.insumo_id] = [];
      grupos[c.insumo_id].push(c);
    });
    return grupos;
  }, [cotacoes]);

  const insumoIds = Object.keys(porInsumo);
  if (!insumoIds.length) return html`<p class="vazio">Nenhuma cotação registrada ainda.</p>`;

  return html`
    <div>
      ${insumoIds.map((insumoId) => {
        const lista = [...porInsumo[insumoId]].sort((a, b) => a.preco - b.preco);
        const menor = lista[0];
        return html`
          <div class="card" key=${insumoId}>
            <h3>${insumosPorId[insumoId] || "Insumo"}</h3>
            <div class="lista-contas">
              ${lista.map((c) => html`
                <div class="item-conta" key=${c.id}>
                  <div class="item-conta-rodape">
                    <span>${fornecedoresPorId[c.fornecedor_id] || "?"} ${c.prazo_dias != null ? `· ${c.prazo_dias}d` : ""}</span>
                    <span class="item-conta-valor ${c.id === menor.id ? "valor-destaque" : ""}">${formatarMoeda(c.preco)}${c.id === menor.id ? " · melhor preço" : ""}</span>
                  </div>
                </div>
              `)}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

function PainelCotacoes({ insumos, fornecedores }) {
  const [cotacoes, setCotacoes] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("cotacao").select("*").order("data", { ascending: false });
    setCotacoes(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const insumosPorId = useMemo(() => Object.fromEntries(insumos.map((i) => [i.id, i.nome])), [insumos]);
  const fornecedoresPorId = useMemo(() => Object.fromEntries(fornecedores.map((f) => [f.id, f.nome])), [fornecedores]);

  if (carregando) return html`<p class="vazio">Carregando cotações…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div><${FormaCotacao} insumos=${insumos} fornecedores=${fornecedores} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Comparativo por insumo</h3>
        <${ComparativoCotacoes} cotacoes=${cotacoes} insumosPorId=${insumosPorId} fornecedoresPorId=${fornecedoresPorId} />
      </div>
    </div>
  `;
}

function FormaCompra({ insumos, fornecedores, onSalvo }) {
  const [insumoId, setInsumoId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [custoUnitario, setCustoUnitario] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!insumoId || !fornecedorId || !quantidade || Number(quantidade) <= 0 || !custoUnitario || Number(custoUnitario) <= 0) {
      setErro("Preencha insumo, fornecedor, quantidade e custo unitário.");
      return;
    }
    setSalvando(true);
    const r = await sb.from("compra").insert({
      insumo_id: insumoId,
      fornecedor_id: fornecedorId,
      quantidade: Number(quantidade),
      custo_unitario: Number(custoUnitario),
    });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setQuantidade(""); setCustoUnitario("");
    onSalvo();
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Registrar compra</h3>
      <p class="desc-form">Ao registrar, o estoque do insumo é somado e o custo unitário dele é atualizado para este valor — a ficha técnica e a margem dos produtos que o usam recalculam sozinhas.</p>
      <div class="linha-campos">
        <div>
          <label>Insumo</label>
          <select value=${insumoId} onChange=${(e) => setInsumoId(e.target.value)}>
            <option value="">Selecione…</option>
            ${insumos.map((i) => html`<option value=${i.id}>${i.nome}</option>`)}
          </select>
        </div>
        <div>
          <label>Fornecedor</label>
          <select value=${fornecedorId} onChange=${(e) => setFornecedorId(e.target.value)}>
            <option value="">Selecione…</option>
            ${fornecedores.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
          </select>
        </div>
      </div>
      <div class="linha-campos">
        <div>
          <label>Quantidade</label>
          <input type="number" step="0.001" min="0.001" value=${quantidade} onInput=${(e) => setQuantidade(e.target.value)} />
        </div>
        <div>
          <label>Custo unitário pago (R$)</label>
          <input type="number" step="0.01" min="0.01" value=${custoUnitario} onInput=${(e) => setCustoUnitario(e.target.value)} />
        </div>
      </div>
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Registrando…" : "Registrar compra"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelCompras({ insumos, fornecedores, onCompraRegistrada }) {
  const [compras, setCompras] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("compra").select("*").order("created_at", { ascending: false }).limit(30);
    setCompras(r.data || []);
    setCarregando(false);
    onCompraRegistrada();
  }
  useEffect(() => { carregar(); }, []);

  const insumosPorId = useMemo(() => Object.fromEntries(insumos.map((i) => [i.id, i])), [insumos]);
  const fornecedoresPorId = useMemo(() => Object.fromEntries(fornecedores.map((f) => [f.id, f.nome])), [fornecedores]);

  if (carregando) return html`<p class="vazio">Carregando compras…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div><${FormaCompra} insumos=${insumos} fornecedores=${fornecedores} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Últimas compras</h3>
        ${!compras.length && html`<p class="vazio">Nenhuma compra registrada ainda.</p>`}
        <div class="lista-contas">
          ${compras.map((c) => {
            const ins = insumosPorId[c.insumo_id];
            return html`
              <div class="item-conta" key=${c.id}>
                <div class="item-conta-topo">
                  <span class="item-conta-desc">${ins ? ins.nome : "?"}</span>
                  <span class="item-conta-valor">${formatarMoeda(c.quantidade * c.custo_unitario)}</span>
                </div>
                <div class="item-conta-meta">
                  ${c.quantidade} ${ins ? ins.unidade : ""} × ${formatarMoeda(c.custo_unitario)} · ${fornecedoresPorId[c.fornecedor_id] || "?"} · ${formatarData(c.created_at.slice(0, 10))}
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}

export default function Compras() {
  const [aba, setAba] = useState("fornecedores");
  const [insumos, setInsumos] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregarBase() {
    const [insumosRes, fornecedoresRes] = await Promise.all([
      sb.from("insumo").select("*").order("nome"),
      sb.from("fornecedor").select("*").order("nome"),
    ]);
    setInsumos(insumosRes.data || []);
    setFornecedores(fornecedoresRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregarBase(); }, []);

  return html`
    <div>
      <h2>Compras e fornecedores</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "fornecedores" ? " ativo" : "")} onClick=${() => setAba("fornecedores")}>Fornecedores</button>
        <button class=${"sub-tab" + (aba === "cotacoes" ? " ativo" : "")} onClick=${() => setAba("cotacoes")}>Cotações</button>
        <button class=${"sub-tab" + (aba === "compras" ? " ativo" : "")} onClick=${() => setAba("compras")}>Compras</button>
      </div>
      ${carregando
        ? html`<p class="vazio">Carregando…</p>`
        : aba === "fornecedores"
          ? html`<${PainelFornecedores} />`
          : aba === "cotacoes"
            ? html`<${PainelCotacoes} insumos=${insumos} fornecedores=${fornecedores} />`
            : html`<${PainelCompras} insumos=${insumos} fornecedores=${fornecedores} onCompraRegistrada=${carregarBase} />`}
    </div>
  `;
}
