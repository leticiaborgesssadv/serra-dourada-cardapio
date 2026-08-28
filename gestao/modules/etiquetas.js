import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import {
  sb, getEstabelecimentoId, formatarMoeda, formatarData, formatarDataHora,
  agoraDatetimeLocal, hojeISO,
} from "../lib/supabase.js";
import {
  TAMANHOS, somarHoras, statusVencimento, ConteudoEtiqueta,
  registrarRastreabilidade, estiloImpressaoEtiqueta, CSS_ETIQUETA,
} from "../lib/etiquetas.js";

const html = htm.bind(h);

function PainelPreco({ produtos, nomeEstabelecimento, tamanhoChave, setTamanhoChave }) {
  const [produtoId, setProdutoId] = useState("");
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("unidade");
  const [preco, setPreco] = useState("");
  const [precoPorKg, setPrecoPorKg] = useState("");
  const [pesoGramas, setPesoGramas] = useState("");
  const [validadeModo, setValidadeModo] = useState("nenhuma");
  const [dataFabricacao, setDataFabricacao] = useState(hojeISO());
  const [validadeDias, setValidadeDias] = useState("");
  const [validadeData, setValidadeData] = useState("");
  const [lote, setLote] = useState("");
  const [mostrarCodigoBarras, setMostrarCodigoBarras] = useState(false);
  const [codigoBarras, setCodigoBarras] = useState("");
  const [quantidade, setQuantidade] = useState("1");

  const tamanho = TAMANHOS.find((t) => t.chave === tamanhoChave) || TAMANHOS[0];

  function selecionarProduto(id) {
    setProdutoId(id);
    if (!id) return;
    const p = produtos.find((x) => x.id === id);
    if (!p) return;
    setNome(p.nome);
    if (tipo === "unidade") setPreco(String(p.preco_venda));
  }

  function somarDiasISO(dataISO, dias) {
    const d = new Date(dataISO + "T00:00:00");
    d.setDate(d.getDate() + Number(dias || 0));
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const dataValidade = useMemo(() => {
    if (validadeModo === "dias") return dataFabricacao && validadeDias !== "" ? somarDiasISO(dataFabricacao, validadeDias) : "";
    if (validadeModo === "data") return validadeData;
    return "";
  }, [validadeModo, dataFabricacao, validadeDias, validadeData]);

  const precoTotal = tipo === "peso" ? (Number(precoPorKg || 0) * Number(pesoGramas || 0)) / 1000 : Number(preco || 0);

  const dados = {
    tipo: "preco", pesado: tipo === "peso", nomeEstabelecimento,
    nome, preco: Number(preco || 0), precoPorKg: Number(precoPorKg || 0),
    pesoGramas: Number(pesoGramas || 0), precoTotal,
    dataFabricacao: validadeModo === "dias" ? dataFabricacao : "",
    dataValidade, lote: lote.trim(),
    mostrarCodigoBarras, codigoBarras: codigoBarras.trim(),
  };

  const podeImprimir = nome.trim().length > 0 && precoTotal > 0 && Number(quantidade) > 0;
  const copias = Array.from({ length: Math.max(1, Math.min(200, Number(quantidade) || 1)) });

  function imprimir() {
    window.print();
    registrarRastreabilidade({
      tipo: "preco", nome: dados.nome, produto_id: produtoId || null,
      preco_total: dados.precoTotal, preco_por_kg: tipo === "peso" ? dados.precoPorKg : null,
      peso_gramas: tipo === "peso" ? dados.pesoGramas : null,
      lote: dados.lote, codigo_barras: dados.codigoBarras, quantidade_copias: Number(quantidade) || 1,
    });
  }

  return html`
    <div class="colunas-financeiro">
      <div class="card">
        <h3>Dados da etiqueta</h3>

        <label>Preencher a partir de um produto do cardápio (opcional)</label>
        <select value=${produtoId} onChange=${(e) => selecionarProduto(e.target.value)}>
          <option value="">Personalizado (digitar manualmente)</option>
          ${produtos.map((p) => html`<option value=${p.id}>${p.nome}</option>`)}
        </select>

        <label>Nome na etiqueta</label>
        <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Feijoada" />

        <div class="toggle-linha" style="margin-bottom:11px;">
          <label style="margin:0;">Tipo de preço</label>
          <div class="sub-tabs" style="margin:0;">
            <button type="button" class=${"sub-tab" + (tipo === "unidade" ? " ativo" : "")} onClick=${() => setTipo("unidade")}>Preço fixo</button>
            <button type="button" class=${"sub-tab" + (tipo === "peso" ? " ativo" : "")} onClick=${() => setTipo("peso")}>Por peso (kg)</button>
          </div>
        </div>

        ${tipo === "unidade"
          ? html`<label>Preço (R$)</label><input type="number" step="0.01" min="0" value=${preco} onInput=${(e) => setPreco(e.target.value)} />`
          : html`
              <div class="linha-campos">
                <div><label>Valor por kg (R$)</label><input type="number" step="0.01" min="0" value=${precoPorKg} onInput=${(e) => setPrecoPorKg(e.target.value)} /></div>
                <div><label>Peso (g)</label><input type="number" step="1" min="0" value=${pesoGramas} onInput=${(e) => setPesoGramas(e.target.value)} /></div>
              </div>
              <p class="desc-form">Total calculado: <strong class="valor-destaque">${formatarMoeda(precoTotal)}</strong></p>
            `}

        <label>Validade</label>
        <select value=${validadeModo} onChange=${(e) => setValidadeModo(e.target.value)}>
          <option value="nenhuma">Sem validade</option>
          <option value="dias">Fabricação + dias de validade</option>
          <option value="data">Data de validade fixa</option>
        </select>
        ${validadeModo === "dias" && html`
          <div class="linha-campos">
            <div><label>Data de fabricação</label><input type="date" value=${dataFabricacao} onInput=${(e) => setDataFabricacao(e.target.value)} /></div>
            <div><label>Dias de validade</label><input type="number" min="0" value=${validadeDias} onInput=${(e) => setValidadeDias(e.target.value)} /></div>
          </div>
          ${dataValidade && html`<p class="desc-form">Vence em: <strong>${formatarData(dataValidade)}</strong></p>`}
        `}
        ${validadeModo === "data" && html`<label>Data de validade</label><input type="date" value=${validadeData} onInput=${(e) => setValidadeData(e.target.value)} />`}

        <label>Lote (opcional)</label>
        <input type="text" value=${lote} onInput=${(e) => setLote(e.target.value)} />

        <div class="toggle-linha">
          <label style="margin:0;">Código de barras</label>
          <input type="checkbox" checked=${mostrarCodigoBarras} onChange=${(e) => setMostrarCodigoBarras(e.target.checked)} />
        </div>
        ${mostrarCodigoBarras && html`<input type="text" value=${codigoBarras} onInput=${(e) => setCodigoBarras(e.target.value)} placeholder="Código (EAN, SKU...)" style="margin-top:8px;" />`}

        <label style="margin-top:6px;">Tamanho da etiqueta</label>
        <select value=${tamanhoChave} onChange=${(e) => setTamanhoChave(e.target.value)}>
          ${TAMANHOS.map((t) => html`<option value=${t.chave}>${t.rotulo}</option>`)}
        </select>

        <label>Quantidade de etiquetas</label>
        <input type="number" min="1" max="200" value=${quantidade} onInput=${(e) => setQuantidade(e.target.value)} />

        <button class="botao" disabled=${!podeImprimir} onClick=${imprimir}>Imprimir ${quantidade || 1} etiqueta(s)</button>
        ${!podeImprimir && html`<p class="desc-form" style="margin-top:8px;">Preencha nome e preço para habilitar a impressão.</p>`}
      </div>

      <div>
        <h3 class="titulo-lista">Pré-visualização</h3>
        <div class="etiqueta-preview-wrap"><${ConteudoEtiqueta} dados=${dados} tamanho=${tamanho} /></div>
      </div>

      <style>${estiloImpressaoEtiqueta(tamanho)}</style>
      <div id="area-impressao-etiquetas">
        ${copias.map((_, i) => html`<div class="etiqueta-pagina" key=${i}><${ConteudoEtiqueta} dados=${dados} tamanho=${tamanho} /></div>`)}
      </div>
    </div>
  `;
}

function PainelManipulacao({ insumos, regras, funcionarios, nomeEstabelecimento, tamanhoChave, setTamanhoChave }) {
  const [insumoId, setInsumoId] = useState("");
  const [nome, setNome] = useState("");
  const [regraValidadeId, setRegraValidadeId] = useState("");
  const [dataManipulacao, setDataManipulacao] = useState(agoraDatetimeLocal());
  const [responsavelId, setResponsavelId] = useState("");
  const [lote, setLote] = useState("");
  const [quantidade, setQuantidade] = useState("1");

  const tamanho = TAMANHOS.find((t) => t.chave === tamanhoChave) || TAMANHOS[0];
  const regra = regras.find((r) => r.id === regraValidadeId);
  const responsavel = funcionarios.find((f) => f.id === responsavelId);

  function selecionarInsumo(id) {
    setInsumoId(id);
    if (!id) return;
    const ins = insumos.find((x) => x.id === id);
    if (!ins) return;
    setNome(ins.nome);
    setRegraValidadeId(ins.regra_validade_id || "");
  }

  const dataValidadeObj = regra ? somarHoras(dataManipulacao, regra.horas_validade) : null;
  const dataValidadeISO = dataValidadeObj ? dataValidadeObj.toISOString() : "";
  const dataManipulacaoISO = useMemo(() => {
    const d = new Date(dataManipulacao);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }, [dataManipulacao]);

  const dados = {
    tipo: "manipulacao", nome, nomeEstabelecimento,
    dataManipulacao: dataManipulacaoISO, dataValidade: dataValidadeISO,
    responsavelNome: responsavel ? responsavel.nome : "", lote: lote.trim(),
  };

  const podeImprimir = nome.trim().length > 0 && !!regra && !!dataManipulacaoISO && Number(quantidade) > 0;
  const copias = Array.from({ length: Math.max(1, Math.min(200, Number(quantidade) || 1)) });

  function imprimir() {
    window.print();
    registrarRastreabilidade({
      tipo: "manipulacao", nome, insumo_id: insumoId || null,
      data_manipulacao: dataManipulacaoISO, data_validade: dataValidadeISO,
      responsavel_funcionario_id: responsavelId || null, lote: dados.lote,
      quantidade_copias: Number(quantidade) || 1,
    });
  }

  return html`
    <div class="colunas-financeiro">
      <div class="card">
        <h3>Etiqueta de manipulação</h3>
        <p class="desc-form">Identifica um insumo/preparo manipulado na cozinha, com validade calculada automaticamente e responsável — para conformidade com a vigilância sanitária.</p>

        <label>Insumo</label>
        <select value=${insumoId} onChange=${(e) => selecionarInsumo(e.target.value)}>
          <option value="">Personalizado (digitar manualmente)</option>
          ${insumos.map((i) => html`<option value=${i.id}>${i.nome}</option>`)}
        </select>
        ${!insumoId && html`<input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Nome do preparo" style="margin-top:-3px;" />`}

        <label>Regra de validade</label>
        <select value=${regraValidadeId} onChange=${(e) => setRegraValidadeId(e.target.value)}>
          <option value="">Selecione…</option>
          ${regras.map((r) => html`<option value=${r.id}>${r.nome} (${r.horas_validade}h)</option>`)}
        </select>
        ${!regras.length && html`<p class="desc-form">Nenhuma regra cadastrada — crie uma na aba "Regras de validade".</p>`}

        <label>Manipulado em</label>
        <input type="datetime-local" value=${dataManipulacao} onInput=${(e) => setDataManipulacao(e.target.value)} />
        ${dataValidadeISO && html`<p class="desc-form">Válido até: <strong class="valor-destaque">${formatarDataHora(dataValidadeISO)}</strong></p>`}

        <label>Responsável</label>
        <select value=${responsavelId} onChange=${(e) => setResponsavelId(e.target.value)}>
          <option value="">—</option>
          ${funcionarios.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
        </select>

        <label>Lote (opcional)</label>
        <input type="text" value=${lote} onInput=${(e) => setLote(e.target.value)} />

        <label style="margin-top:6px;">Tamanho da etiqueta</label>
        <select value=${tamanhoChave} onChange=${(e) => setTamanhoChave(e.target.value)}>
          ${TAMANHOS.map((t) => html`<option value=${t.chave}>${t.rotulo}</option>`)}
        </select>

        <label>Quantidade de etiquetas</label>
        <input type="number" min="1" max="200" value=${quantidade} onInput=${(e) => setQuantidade(e.target.value)} />

        <button class="botao" disabled=${!podeImprimir} onClick=${imprimir}>Imprimir ${quantidade || 1} etiqueta(s)</button>
        ${!podeImprimir && html`<p class="desc-form" style="margin-top:8px;">Preencha o nome e escolha uma regra de validade.</p>`}
      </div>

      <div>
        <h3 class="titulo-lista">Pré-visualização</h3>
        <div class="etiqueta-preview-wrap"><${ConteudoEtiqueta} dados=${dados} tamanho=${tamanho} /></div>
      </div>

      <style>${estiloImpressaoEtiqueta(tamanho)}</style>
      <div id="area-impressao-etiquetas">
        ${copias.map((_, i) => html`<div class="etiqueta-pagina" key=${i}><${ConteudoEtiqueta} dados=${dados} tamanho=${tamanho} /></div>`)}
      </div>
    </div>
  `;
}

function LinhaVencimento({ item, insumosPorId, onRegistrarPerda }) {
  const [expandido, setExpandido] = useState(false);
  const [quantidadePerda, setQuantidadePerda] = useState("");
  const status = statusVencimento(item.data_validade);
  const ins = insumosPorId[item.insumo_id];

  async function confirmar() {
    if (!quantidadePerda || Number(quantidadePerda) <= 0) return;
    await onRegistrarPerda(item, Number(quantidadePerda));
    setExpandido(false);
    setQuantidadePerda("");
  }

  return html`
    <div class="item-conta">
      <div class="item-conta-topo">
        <span class="item-conta-desc">${item.nome}</span>
        <span class="chip ${status.chip}">${status.rotulo}</span>
      </div>
      <div class="item-conta-meta">
        Manipulado: ${formatarDataHora(item.data_manipulacao)} · Validade: ${formatarDataHora(item.data_validade)}
      </div>
      ${(status.chave === "vencido" || status.chave === "vence_hoje") && ins && html`
        ${!expandido
          ? html`<button class="botao-secundario-pequeno" onClick=${() => setExpandido(true)}>Registrar perda</button>`
          : html`
              <div class="linha-campos" style="margin-top:6px;">
                <div><label>Quantidade perdida (${ins.unidade})</label><input type="number" step="0.001" min="0.001" value=${quantidadePerda} onInput=${(e) => setQuantidadePerda(e.target.value)} /></div>
                <div style="display:flex; align-items:flex-end; gap:6px; padding-bottom:11px;">
                  <button class="botao-pequeno" onClick=${confirmar}>Confirmar</button>
                  <button class="botao-secundario-pequeno" onClick=${() => setExpandido(false)}>Cancelar</button>
                </div>
              </div>
            `}
      `}
    </div>
  `;
}

function PainelVencimentos({ insumos }) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("ativos");

  async function carregar() {
    // Só traz etiquetas com validade dos últimos 3 dias pra frente — presume-se
    // que algo vencido há mais tempo já foi usado/descartado e não é mais relevante.
    const desde = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
    const r = await sb.from("etiqueta_impressa").select("*").eq("tipo", "manipulacao").gte("data_validade", desde).order("data_validade", { ascending: true }).limit(300);
    setItens(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const insumosPorId = useMemo(() => Object.fromEntries(insumos.map((i) => [i.id, i])), [insumos]);

  async function registrarPerda(item, quantidade) {
    const ins = insumosPorId[item.insumo_id];
    if (!ins) return;
    const estabelecimento_id = await getEstabelecimentoId();
    await sb.from("perda_desperdicio").insert({
      estabelecimento_id, insumo_id: ins.id, quantidade,
      valor: quantidade * Number(ins.custo_unitario || 0),
      motivo: "vencido", data: hojeISO(),
      observacao: item.lote ? `Etiqueta de manipulação, lote ${item.lote}` : "Etiqueta de manipulação vencida",
    });
    setItens((atual) => atual.filter((i) => i.id !== item.id));
    carregar();
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const comStatus = itens.map((it) => ({ ...it, status: statusVencimento(it.data_validade) }));
  const contagem = {
    vencido: comStatus.filter((i) => i.status.chave === "vencido").length,
    vence_hoje: comStatus.filter((i) => i.status.chave === "vence_hoje").length,
    vence_breve: comStatus.filter((i) => i.status.chave === "vence_breve").length,
  };
  const visiveis = filtro === "ativos"
    ? comStatus.filter((i) => i.status.chave !== "ok")
    : comStatus;

  return html`
    <div>
      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="stat-box stat-erro"><div class="stat-num">${contagem.vencido}</div><div class="stat-lbl">Vencidos</div></div>
        <div class="stat-box stat-alerta"><div class="stat-num">${contagem.vence_hoje}</div><div class="stat-lbl">Vencem hoje</div></div>
        <div class="stat-box"><div class="stat-num">${contagem.vence_breve}</div><div class="stat-lbl">Vencem em até 72h</div></div>
      </div>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (filtro === "ativos" ? " ativo" : "")} onClick=${() => setFiltro("ativos")}>Precisam de atenção</button>
        <button class=${"sub-tab" + (filtro === "todos" ? " ativo" : "")} onClick=${() => setFiltro("todos")}>Todas as etiquetas</button>
      </div>
      ${!visiveis.length && html`<p class="vazio">Nada por aqui — tudo em dia.</p>`}
      <div class="lista-contas">
        ${visiveis.map((item) => html`<${LinhaVencimento} key=${item.id} item=${item} insumosPorId=${insumosPorId} onRegistrarPerda=${registrarPerda} />`)}
      </div>
    </div>
  `;
}

function PainelRegras({ regras, onMudou }) {
  const [nome, setNome] = useState("");
  const [horas, setHoras] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim() || !horas || Number(horas) <= 0) { setErro("Preencha nome e horas de validade."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("regra_validade").insert({ estabelecimento_id, nome: nome.trim(), horas_validade: Number(horas) });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setHoras("");
      onMudou();
    } catch (e) {
      setErro("Erro de conexão.");
    } finally {
      setSalvando(false);
    }
  }

  async function desativar(id) {
    if (!confirm("Desativar esta regra de validade?")) return;
    await sb.from("regra_validade").update({ ativo: false }).eq("id", id);
    onMudou();
  }

  return html`
    <div class="colunas-financeiro">
      <form class="card" onSubmit=${salvar}>
        <h3>Nova regra de validade</h3>
        <label>Nome (categoria)</label>
        <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Resfriado cru" />
        <label>Horas de validade após manipulação</label>
        <input type="number" min="1" value=${horas} onInput=${(e) => setHoras(e.target.value)} placeholder="Ex.: 24" />
        <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar regra"}</button>
        ${erro && html`<div class="msg-erro">${erro}</div>`}
      </form>
      <div>
        <h3 class="titulo-lista">Regras cadastradas</h3>
        ${!regras.length && html`<p class="vazio">Nenhuma regra cadastrada ainda.</p>`}
        <div class="lista-contas">
          ${regras.map((r) => html`
            <div class="item-conta" key=${r.id}>
              <div class="item-conta-rodape">
                <span>${r.nome} — ${r.horas_validade}h</span>
                <button class="botao-secundario-pequeno" onClick=${() => desativar(r.id)}>Desativar</button>
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

export default function Etiquetas() {
  const [aba, setAba] = useState("preco");
  const [carregando, setCarregando] = useState(true);
  const [produtos, setProdutos] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [regras, setRegras] = useState([]);
  const [nomeEstabelecimento, setNomeEstabelecimento] = useState("");
  const [tamanhoChave, setTamanhoChave] = useState(TAMANHOS[0].chave);

  async function carregarTudo() {
    const [prodRes, insRes, funcRes, regrasRes, estRes] = await Promise.all([
      sb.from("produto").select("id,nome,preco_venda").eq("ativo", true).order("nome"),
      sb.from("insumo").select("id,nome,unidade,custo_unitario,regra_validade_id").order("nome"),
      sb.from("funcionario").select("id,nome").eq("ativo", true).order("nome"),
      sb.from("regra_validade").select("*").eq("ativo", true).order("nome"),
      sb.from("estabelecimento").select("nome,nome_fantasia").limit(1).maybeSingle(),
    ]);
    setProdutos(prodRes.data || []);
    setInsumos(insRes.data || []);
    setFuncionarios(funcRes.data || []);
    setRegras(regrasRes.data || []);
    setNomeEstabelecimento(estRes.data ? (estRes.data.nome_fantasia || estRes.data.nome || "") : "");
    setCarregando(false);
  }
  useEffect(() => { carregarTudo(); }, []);

  return html`
    <div>
      <h2>Etiquetas</h2>
      <p class="desc-form">
        Preço, manipulação/validade e rastreabilidade — para impressão numa impressora térmica (ex.: Elgin L42) via
        driver do Windows.
      </p>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "preco" ? " ativo" : "")} onClick=${() => setAba("preco")}>Preço</button>
        <button class=${"sub-tab" + (aba === "manipulacao" ? " ativo" : "")} onClick=${() => setAba("manipulacao")}>Manipulação</button>
        <button class=${"sub-tab" + (aba === "vencimentos" ? " ativo" : "")} onClick=${() => setAba("vencimentos")}>Vencimentos</button>
        <button class=${"sub-tab" + (aba === "regras" ? " ativo" : "")} onClick=${() => setAba("regras")}>Regras de validade</button>
      </div>

      ${carregando
        ? html`<p class="vazio">Carregando…</p>`
        : aba === "preco"
          ? html`<${PainelPreco} produtos=${produtos} nomeEstabelecimento=${nomeEstabelecimento} tamanhoChave=${tamanhoChave} setTamanhoChave=${setTamanhoChave} />`
          : aba === "manipulacao"
            ? html`<${PainelManipulacao} insumos=${insumos} regras=${regras} funcionarios=${funcionarios} nomeEstabelecimento=${nomeEstabelecimento} tamanhoChave=${tamanhoChave} setTamanhoChave=${setTamanhoChave} />`
            : aba === "vencimentos"
              ? html`<${PainelVencimentos} insumos=${insumos} />`
              : html`<${PainelRegras} regras=${regras} onMudou=${carregarTudo} />`}

      <style>${CSS_ETIQUETA}</style>
    </div>
  `;
}
