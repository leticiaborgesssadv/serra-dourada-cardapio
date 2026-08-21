import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, getEstabelecimentoId, formatarMoeda, formatarData } from "../lib/supabase.js";

const html = htm.bind(h);

const UNIDADES = ["kg", "g", "l", "ml", "un", "cx", "pct", "dz"];

function AlertaEstoqueBaixo({ insumos }) {
  const baixos = insumos.filter((i) => Number(i.estoque_atual) <= Number(i.ponto_reposicao));
  if (!baixos.length) return null;
  return html`
    <div class="alerta-banner">
      <strong>${baixos.length} insumo(s) no ou abaixo do ponto de reposição:</strong>
      ${baixos.map((i) => i.nome).join(", ")}
    </div>
  `;
}

function FormaInsumo({ fornecedores, onSalvo }) {
  const [nome, setNome] = useState("");
  const [unidade, setUnidade] = useState(UNIDADES[0]);
  const [custoUnitario, setCustoUnitario] = useState("");
  const [estoqueAtual, setEstoqueAtual] = useState("");
  const [pontoReposicao, setPontoReposicao] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim() || !custoUnitario || Number(custoUnitario) <= 0) {
      setErro("Preencha nome e custo unitário.");
      return;
    }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("insumo").insert({
        estabelecimento_id,
        nome: nome.trim(),
        unidade,
        custo_unitario: Number(custoUnitario),
        estoque_atual: Number(estoqueAtual || 0),
        ponto_reposicao: Number(pontoReposicao || 0),
        fornecedor_id: fornecedorId || null,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setCustoUnitario(""); setEstoqueAtual(""); setPontoReposicao(""); setFornecedorId("");
      onSalvo();
    } catch (e) {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo insumo</h3>
      <label>Nome</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Limão" />
      <div class="linha-campos">
        <div>
          <label>Unidade</label>
          <select value=${unidade} onChange=${(e) => setUnidade(e.target.value)}>
            ${UNIDADES.map((u) => html`<option value=${u}>${u}</option>`)}
          </select>
        </div>
        <div>
          <label>Custo unitário (R$)</label>
          <input type="number" step="0.01" min="0.01" value=${custoUnitario} onInput=${(e) => setCustoUnitario(e.target.value)} />
        </div>
      </div>
      <div class="linha-campos">
        <div>
          <label>Estoque atual</label>
          <input type="number" step="0.01" min="0" value=${estoqueAtual} onInput=${(e) => setEstoqueAtual(e.target.value)} />
        </div>
        <div>
          <label>Ponto de reposição</label>
          <input type="number" step="0.01" min="0" value=${pontoReposicao} onInput=${(e) => setPontoReposicao(e.target.value)} />
        </div>
      </div>
      <label>Fornecedor</label>
      <select value=${fornecedorId} onChange=${(e) => setFornecedorId(e.target.value)}>
        <option value="">—</option>
        ${fornecedores.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
      </select>
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar insumo"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function ListaInsumos({ insumos, fornecedoresPorId }) {
  if (!insumos.length) return html`<p class="vazio">Nenhum insumo cadastrado ainda.</p>`;
  return html`
    <div class="lista-contas">
      ${insumos.map((i) => {
        const baixo = Number(i.estoque_atual) <= Number(i.ponto_reposicao);
        return html`
          <div class="item-conta" key=${i.id}>
            <div class="item-conta-topo">
              <span class="item-conta-desc">${i.nome}</span>
              ${baixo ? html`<span class="chip chip-erro">Estoque baixo</span>` : html`<span class="chip chip-ok">OK</span>`}
            </div>
            <div class="item-conta-meta">
              ${formatarMoeda(i.custo_unitario)}/${i.unidade} · estoque ${i.estoque_atual} ${i.unidade} (mín. ${i.ponto_reposicao})
              ${i.fornecedor_id && fornecedoresPorId[i.fornecedor_id] ? ` · ${fornecedoresPorId[i.fornecedor_id]}` : ""}
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

function PainelInsumos({ fornecedores }) {
  const [insumos, setInsumos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("insumo").select("*").order("nome");
    setInsumos(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const fornecedoresPorId = useMemo(() => Object.fromEntries(fornecedores.map((f) => [f.id, f.nome])), [fornecedores]);

  if (carregando) return html`<p class="vazio">Carregando insumos…</p>`;

  return html`
    <div>
      <${AlertaEstoqueBaixo} insumos=${insumos} />
      <div class="colunas-financeiro">
        <div><${FormaInsumo} fornecedores=${fornecedores} onSalvo=${carregar} /></div>
        <div>
          <h3 class="titulo-lista">Insumos cadastrados</h3>
          <${ListaInsumos} insumos=${insumos} fornecedoresPorId=${fornecedoresPorId} />
        </div>
      </div>
    </div>
  `;
}

function FormaProduto({ onSalvo }) {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [precoVenda, setPrecoVenda] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim() || !precoVenda || Number(precoVenda) <= 0) {
      setErro("Preencha nome e preço de venda.");
      return;
    }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("produto").insert({
        estabelecimento_id,
        nome: nome.trim(),
        categoria: categoria.trim() || null,
        preco_venda: Number(precoVenda),
        ativo: true,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setCategoria(""); setPrecoVenda("");
      onSalvo();
    } catch (e) {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo produto</h3>
      <label>Nome</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Caipirinha" />
      <div class="linha-campos">
        <div>
          <label>Categoria</label>
          <input type="text" value=${categoria} onInput=${(e) => setCategoria(e.target.value)} placeholder="Ex.: Drinks" />
        </div>
        <div>
          <label>Preço de venda (R$)</label>
          <input type="number" step="0.01" min="0.01" value=${precoVenda} onInput=${(e) => setPrecoVenda(e.target.value)} />
        </div>
      </div>
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar produto"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function FichaTecnica({ produto, insumos, itens, onMudou }) {
  const [insumoId, setInsumoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const insumosPorId = useMemo(() => Object.fromEntries(insumos.map((i) => [i.id, i])), [insumos]);
  const itensDoProduto = itens.filter((it) => it.produto_id === produto.id);

  const custo = itensDoProduto.reduce((acc, it) => {
    const ins = insumosPorId[it.insumo_id];
    return acc + (ins ? Number(it.quantidade) * Number(ins.custo_unitario) : 0);
  }, 0);
  const margem = produto.preco_venda > 0 ? ((produto.preco_venda - custo) / produto.preco_venda) * 100 : 0;
  const markup = custo > 0 ? produto.preco_venda / custo : 0;

  async function adicionarItem(ev) {
    ev.preventDefault();
    setErro("");
    if (!insumoId || !quantidade || Number(quantidade) <= 0) {
      setErro("Selecione o insumo e a quantidade.");
      return;
    }
    setSalvando(true);
    const r = await sb.from("ficha_tecnica_item").insert({ produto_id: produto.id, insumo_id: insumoId, quantidade: Number(quantidade) });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível adicionar: " + r.error.message); return; }
    setInsumoId(""); setQuantidade("");
    onMudou();
  }

  async function removerItem(id) {
    await sb.from("ficha_tecnica_item").delete().eq("id", id);
    onMudou();
  }

  return html`
    <div class="card ficha-tecnica">
      <h3>Ficha técnica — ${produto.nome}</h3>
      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 16px;">
        <div class="stat-box"><div class="stat-num">${formatarMoeda(custo)}</div><div class="stat-lbl">Custo da receita</div></div>
        <div class="stat-box ${margem < 50 ? "stat-alerta" : "stat-ok"}"><div class="stat-num">${margem.toFixed(0)}%</div><div class="stat-lbl">Margem</div></div>
        <div class="stat-box"><div class="stat-num">${markup.toFixed(2)}x</div><div class="stat-lbl">Markup</div></div>
      </div>

      ${itensDoProduto.length > 0 && html`
        <div class="lista-contas" style="margin-bottom: 14px;">
          ${itensDoProduto.map((it) => {
            const ins = insumosPorId[it.insumo_id];
            return html`
              <div class="item-conta" key=${it.id}>
                <div class="item-conta-rodape">
                  <span>${ins ? ins.nome : "?"} — ${it.quantidade} ${ins ? ins.unidade : ""}</span>
                  <button class="botao-secundario-pequeno" onClick=${() => removerItem(it.id)}>Remover</button>
                </div>
              </div>
            `;
          })}
        </div>
      `}

      <form onSubmit=${adicionarItem}>
        <div class="linha-campos">
          <div>
            <label>Insumo</label>
            <select value=${insumoId} onChange=${(e) => setInsumoId(e.target.value)}>
              <option value="">Selecione…</option>
              ${insumos.map((i) => html`<option value=${i.id}>${i.nome}</option>`)}
            </select>
          </div>
          <div>
            <label>Quantidade usada</label>
            <input type="number" step="0.001" min="0.001" value=${quantidade} onInput=${(e) => setQuantidade(e.target.value)} />
          </div>
        </div>
        <button class="botao-secundario" type="submit" disabled=${salvando} style="width: 100%;">${salvando ? "Adicionando…" : "Adicionar ingrediente"}</button>
        ${erro && html`<div class="msg-erro">${erro}</div>`}
      </form>
    </div>
  `;
}

function PainelProdutos({ insumos }) {
  const [produtos, setProdutos] = useState([]);
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionadoId, setSelecionadoId] = useState(null);

  async function carregar() {
    const [prodRes, itensRes] = await Promise.all([
      sb.from("produto").select("*").order("nome"),
      sb.from("ficha_tecnica_item").select("*"),
    ]);
    setProdutos(prodRes.data || []);
    setItens(itensRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const insumosPorId = useMemo(() => Object.fromEntries(insumos.map((i) => [i.id, i])), [insumos]);
  const selecionado = produtos.find((p) => p.id === selecionadoId) || null;

  if (carregando) return html`<p class="vazio">Carregando produtos…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div>
        <${FormaProduto} onSalvo=${carregar} />
        <h3 class="titulo-lista">Produtos cadastrados</h3>
        ${!produtos.length && html`<p class="vazio">Nenhum produto cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${produtos.map((p) => {
            const itensDoProduto = itens.filter((it) => it.produto_id === p.id);
            const custo = itensDoProduto.reduce((acc, it) => {
              const ins = insumosPorId[it.insumo_id];
              return acc + (ins ? Number(it.quantidade) * Number(ins.custo_unitario) : 0);
            }, 0);
            const margem = p.preco_venda > 0 ? ((p.preco_venda - custo) / p.preco_venda) * 100 : 0;
            return html`
              <div class="item-conta item-clicavel ${selecionadoId === p.id ? "selecionado" : ""}" key=${p.id} onClick=${() => setSelecionadoId(p.id)}>
                <div class="item-conta-topo">
                  <span class="item-conta-desc">${p.nome}</span>
                  <span class="item-conta-valor">${formatarMoeda(p.preco_venda)}</span>
                </div>
                <div class="item-conta-meta">
                  ${p.categoria || "sem categoria"} · ${itensDoProduto.length ? `margem ${margem.toFixed(0)}%` : "sem ficha técnica"}
                </div>
              </div>
            `;
          })}
        </div>
      </div>
      <div>
        ${selecionado
          ? html`<${FichaTecnica} produto=${selecionado} insumos=${insumos} itens=${itens} onMudou=${carregar} />`
          : html`<p class="vazio">Clique em um produto à esquerda para editar a ficha técnica.</p>`}
      </div>
    </div>
  `;
}

const MOTIVOS_PERDA = [
  { valor: "queimado", rotulo: "Queimado" },
  { valor: "vencido", rotulo: "Vencido" },
  { valor: "erro_cozinha", rotulo: "Erro de cozinha" },
  { valor: "devolucao", rotulo: "Devolução" },
  { valor: "quebra", rotulo: "Quebra" },
  { valor: "erro_pedido", rotulo: "Erro de pedido" },
  { valor: "consumo_interno", rotulo: "Consumo interno" },
  { valor: "cortesia", rotulo: "Cortesia" },
  { valor: "perda_preparo", rotulo: "Perda no preparo" },
  { valor: "sobra", rotulo: "Sobra" },
  { valor: "descarte", rotulo: "Descarte" },
  { valor: "outro", rotulo: "Outro" },
];

function hojeISOLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function PainelInventario({ insumos }) {
  const [contagem, setContagem] = useState(null);
  const [itens, setItens] = useState([]);
  const [valores, setValores] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function carregar() {
    const r = await sb.from("inventario_contagem").select("*").eq("status", "aberto").order("created_at", { ascending: false }).limit(1).maybeSingle();
    setContagem(r.data || null);
    if (r.data) {
      const itensRes = await sb.from("inventario_contagem_item").select("*").eq("inventario_contagem_id", r.data.id);
      setItens(itensRes.data || []);
      const mapaValores = {};
      (itensRes.data || []).forEach((it) => { mapaValores[it.insumo_id] = it.estoque_fisico ?? ""; });
      setValores(mapaValores);
    } else {
      setItens([]);
      setValores({});
    }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function abrirContagem() {
    setSalvando(true);
    setErro("");
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("inventario_contagem").insert({ estabelecimento_id, data: hojeISOLocal(), status: "aberto" }).select().single();
      if (r.error) { setErro("Não foi possível abrir a contagem: " + r.error.message); return; }
      const linhas = insumos.map((i) => ({ inventario_contagem_id: r.data.id, insumo_id: i.id, estoque_teorico: i.estoque_atual }));
      if (linhas.length) await sb.from("inventario_contagem_item").insert(linhas);
      carregar();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  async function salvarContagemFisica(insumoId, valor) {
    setValores({ ...valores, [insumoId]: valor });
    const item = itens.find((it) => it.insumo_id === insumoId);
    if (!item) return;
    await sb.from("inventario_contagem_item").update({ estoque_fisico: valor === "" ? null : Number(valor) }).eq("id", item.id);
  }

  async function fecharContagem() {
    setSalvando(true);
    try {
      for (const item of itens) {
        const fisico = valores[item.insumo_id];
        if (fisico !== "" && fisico != null) {
          await sb.from("insumo").update({ estoque_atual: Number(fisico) }).eq("id", item.insumo_id);
        }
      }
      await sb.from("inventario_contagem").update({ status: "fechado" }).eq("id", contagem.id);
      carregar();
    } catch (e) { setErro("Erro ao fechar a contagem."); }
    finally { setSalvando(false); }
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const insumosPorId = Object.fromEntries(insumos.map((i) => [i.id, i]));

  if (!contagem) {
    return html`
      <div class="card">
        <h3>Inventário</h3>
        <p class="desc-form">Abre uma contagem com o estoque teórico atual de todos os insumos, para você conferir o físico item a item.</p>
        <button class="botao" disabled=${salvando} onClick=${abrirContagem}>${salvando ? "Abrindo…" : "Abrir nova contagem"}</button>
        ${erro && html`<div class="msg-erro">${erro}</div>`}
      </div>
    `;
  }

  return html`
    <div class="card">
      <h3>Contagem aberta em ${formatarData(contagem.data)}</h3>
      <p class="desc-form">Preencha o estoque físico contado de cada insumo. Ao fechar, o estoque do sistema é ajustado para bater com o físico.</p>
      <div class="lista-contas">
        ${itens.map((it) => {
          const ins = insumosPorId[it.insumo_id];
          const fisico = valores[it.insumo_id];
          const divergencia = fisico !== "" && fisico != null ? Number(fisico) - Number(it.estoque_teorico) : null;
          return html`
            <div class="item-conta" key=${it.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${ins ? ins.nome : "?"}</span>
                <span class="chip ${divergencia == null ? "chip-neutro" : divergencia === 0 ? "chip-ok" : "chip-alerta"}">
                  teórico ${it.estoque_teorico} ${ins ? ins.unidade : ""}
                </span>
              </div>
              <div class="linha-campos" style="margin-top:6px;">
                <div>
                  <label>Estoque físico contado</label>
                  <input type="number" step="0.01" value=${fisico} onInput=${(e) => salvarContagemFisica(it.insumo_id, e.target.value)} />
                </div>
                <div style="display:flex; align-items:flex-end; padding-bottom: 11px;">
                  ${divergencia != null && html`<span class="desc-form" style="margin:0;">Diferença: ${divergencia > 0 ? "+" : ""}${divergencia.toFixed(2)} ${ins ? ins.unidade : ""}</span>`}
                </div>
              </div>
            </div>
          `;
        })}
      </div>
      <button class="botao" style="margin-top: 14px;" disabled=${salvando} onClick=${fecharContagem}>${salvando ? "Fechando…" : "Fechar contagem e ajustar estoque"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </div>
  `;
}

function FormaPerda({ insumos, onSalvo }) {
  const [insumoId, setInsumoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState(MOTIVOS_PERDA[0].valor);
  const [setor, setSetor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const insumoSelecionado = insumos.find((i) => i.id === insumoId);
  const valorCalculado = insumoSelecionado && quantidade ? Number(quantidade) * Number(insumoSelecionado.custo_unitario) : 0;

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!insumoId || !quantidade || Number(quantidade) <= 0) { setErro("Selecione o insumo e a quantidade perdida."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("perda_desperdicio").insert({
        estabelecimento_id, insumo_id: insumoId, quantidade: Number(quantidade), valor: valorCalculado,
        motivo, setor: setor.trim() || null, data: hojeISOLocal(), observacao: observacao.trim() || null,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setQuantidade(""); setSetor(""); setObservacao("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Registrar desperdício</h3>
      <label>Insumo</label>
      <select value=${insumoId} onChange=${(e) => setInsumoId(e.target.value)}>
        <option value="">Selecione…</option>
        ${insumos.map((i) => html`<option value=${i.id}>${i.nome}</option>`)}
      </select>
      <div class="linha-campos">
        <div><label>Quantidade</label><input type="number" step="0.001" min="0.001" value=${quantidade} onInput=${(e) => setQuantidade(e.target.value)} /></div>
        <div><label>Motivo</label><select value=${motivo} onChange=${(e) => setMotivo(e.target.value)}>${MOTIVOS_PERDA.map((m) => html`<option value=${m.valor}>${m.rotulo}</option>`)}</select></div>
      </div>
      ${insumoSelecionado && quantidade && html`<p class="desc-form">Valor estimado da perda: <strong style="color:var(--erro)">${formatarMoeda(valorCalculado)}</strong></p>`}
      <label>Setor (opcional)</label>
      <input type="text" value=${setor} onInput=${(e) => setSetor(e.target.value)} placeholder="Ex.: Cozinha" />
      <label>Observação</label>
      <input type="text" value=${observacao} onInput=${(e) => setObservacao(e.target.value)} />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Registrar perda"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelDesperdicio({ insumos }) {
  const [perdas, setPerdas] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("perda_desperdicio").select("*").order("data", { ascending: false }).limit(50);
    setPerdas(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const insumosPorId = Object.fromEntries(insumos.map((i) => [i.id, i]));
  const totalMes = perdas
    .filter((p) => p.data.slice(0, 7) === hojeISOLocal().slice(0, 7))
    .reduce((acc, p) => acc + Number(p.valor), 0);

  const porMotivo = {};
  perdas.forEach((p) => { porMotivo[p.motivo] = (porMotivo[p.motivo] || 0) + Number(p.valor); });
  const maiorMotivo = Object.entries(porMotivo).sort((a, b) => b[1] - a[1])[0];

  return html`
    <div class="colunas-financeiro">
      <div><${FormaPerda} insumos=${insumos} onSalvo=${carregar} /></div>
      <div>
        <div class="stat-grid" style="grid-template-columns: repeat(2, 1fr); margin-bottom: 14px;">
          <div class="stat-box stat-erro"><div class="stat-num">${formatarMoeda(totalMes)}</div><div class="stat-lbl">Perdido este mês</div></div>
          <div class="stat-box"><div class="stat-num">${maiorMotivo ? MOTIVOS_PERDA.find((m) => m.valor === maiorMotivo[0])?.rotulo : "—"}</div><div class="stat-lbl">Maior motivo</div></div>
        </div>
        <h3 class="titulo-lista">Últimas perdas</h3>
        ${!perdas.length && html`<p class="vazio">Nenhuma perda registrada ainda.</p>`}
        <div class="lista-contas">
          ${perdas.map((p) => html`
            <div class="item-conta" key=${p.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${p.insumo_id && insumosPorId[p.insumo_id] ? insumosPorId[p.insumo_id].nome : "Insumo removido"}</span>
                <span class="item-conta-valor">${formatarMoeda(p.valor)}</span>
              </div>
              <div class="item-conta-meta">
                ${MOTIVOS_PERDA.find((m) => m.valor === p.motivo)?.rotulo || p.motivo} · ${formatarData(p.data)}${p.setor ? ` · ${p.setor}` : ""}
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

export default function Estoque() {
  const [aba, setAba] = useState("insumos");
  const [insumos, setInsumos] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    Promise.all([
      sb.from("insumo").select("*").order("nome"),
      sb.from("fornecedor").select("id,nome").order("nome"),
    ]).then(([insumosRes, fornecedoresRes]) => {
      setInsumos(insumosRes.data || []);
      setFornecedores(fornecedoresRes.data || []);
      setCarregando(false);
    });
  }, [aba]);

  return html`
    <div>
      <h2>Estoque e CMV</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "insumos" ? " ativo" : "")} onClick=${() => setAba("insumos")}>Insumos</button>
        <button class=${"sub-tab" + (aba === "produtos" ? " ativo" : "")} onClick=${() => setAba("produtos")}>Produtos e ficha técnica</button>
        <button class=${"sub-tab" + (aba === "inventario" ? " ativo" : "")} onClick=${() => setAba("inventario")}>Inventário</button>
        <button class=${"sub-tab" + (aba === "desperdicio" ? " ativo" : "")} onClick=${() => setAba("desperdicio")}>Desperdício</button>
      </div>
      ${carregando
        ? html`<p class="vazio">Carregando…</p>`
        : aba === "insumos"
          ? html`<${PainelInsumos} fornecedores=${fornecedores} />`
          : aba === "produtos"
            ? html`<${PainelProdutos} insumos=${insumos} />`
            : aba === "inventario"
              ? html`<${PainelInventario} insumos=${insumos} />`
              : html`<${PainelDesperdicio} insumos=${insumos} />`}
    </div>
  `;
}
