import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, getEstabelecimentoId, formatarMoeda, formatarData, hojeISO, diasAte } from "../lib/supabase.js";

const html = htm.bind(h);

const CATEGORIAS_PAGAR = [
  "Fornecedores", "Folha", "Encargos", "Aluguel", "Energia", "Água", "Gás",
  "Sistemas", "Contabilidade", "Marketing", "Manutenção", "Limpeza",
  "Administrativo", "Taxas de cartão", "Delivery", "Impostos", "Outras despesas",
];

function StatusChip({ tipo, status, vencimento }) {
  let label = status;
  let cor = "neutro";
  if (status === "pago" || status === "recebido") { label = status === "pago" ? "Pago" : "Recebido"; cor = "ok"; }
  else if (status === "cancelado") { label = "Cancelado"; cor = "neutro"; }
  else {
    const dias = diasAte(vencimento);
    if (dias < 0) { label = "Vencido"; cor = "erro"; }
    else if (dias === 0) { label = "Vence hoje"; cor = "alerta"; }
    else if (dias <= 7) { label = `Vence em ${dias}d`; cor = "alerta"; }
    else { label = tipo === "pagar" ? "A vencer" : "A receber"; cor = "neutro"; }
  }
  return html`<span class="chip chip-${cor}">${label}</span>`;
}

function ResumoStats({ contasPagar, contasReceber }) {
  const abertas = contasPagar.filter((c) => c.status === "a_vencer");
  const vencidas = abertas.filter((c) => diasAte(c.vencimento) < 0);
  const proximos7 = abertas.filter((c) => { const d = diasAte(c.vencimento); return d >= 0 && d <= 7; });
  const proximos30 = abertas.filter((c) => { const d = diasAte(c.vencimento); return d >= 0 && d <= 30; });
  const aReceber = contasReceber.filter((c) => c.status === "a_receber");

  const soma = (lista) => lista.reduce((acc, c) => acc + Number(c.valor), 0);

  return html`
    <div class="stat-grid">
      <div class="stat-box stat-erro"><div class="stat-num">${formatarMoeda(soma(vencidas))}</div><div class="stat-lbl">Vencido</div></div>
      <div class="stat-box stat-alerta"><div class="stat-num">${formatarMoeda(soma(proximos7))}</div><div class="stat-lbl">Vence em 7 dias</div></div>
      <div class="stat-box"><div class="stat-num">${formatarMoeda(soma(proximos30))}</div><div class="stat-lbl">Vence em 30 dias</div></div>
      <div class="stat-box stat-ok"><div class="stat-num">${formatarMoeda(soma(aReceber))}</div><div class="stat-lbl">A receber</div></div>
    </div>
  `;
}

function FormaPagar({ centrosCusto, fornecedores, onSalvo }) {
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS_PAGAR[0]);
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [recorrencia, setRecorrencia] = useState("nenhuma");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!descricao.trim() || !valor || Number(valor) <= 0 || !vencimento) {
      setErro("Preencha descrição, valor e vencimento.");
      return;
    }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("conta_pagar").insert({
        estabelecimento_id,
        descricao: descricao.trim(),
        categoria,
        valor: Number(valor),
        emissao: hojeISO(),
        vencimento,
        centro_custo_id: centroCustoId || null,
        fornecedor_id: fornecedorId || null,
        recorrencia,
        status: "a_vencer",
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setDescricao(""); setValor(""); setVencimento(""); setCentroCustoId(""); setFornecedorId(""); setRecorrencia("nenhuma");
      onSalvo();
    } catch (e) {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Nova conta a pagar</h3>
      <label>Descrição</label>
      <input type="text" value=${descricao} onInput=${(e) => setDescricao(e.target.value)} placeholder="Ex.: Conta de energia" />
      <div class="linha-campos">
        <div>
          <label>Categoria</label>
          <select value=${categoria} onChange=${(e) => setCategoria(e.target.value)}>
            ${CATEGORIAS_PAGAR.map((c) => html`<option value=${c}>${c}</option>`)}
          </select>
        </div>
        <div>
          <label>Valor (R$)</label>
          <input type="number" step="0.01" min="0.01" value=${valor} onInput=${(e) => setValor(e.target.value)} />
        </div>
      </div>
      <div class="linha-campos">
        <div>
          <label>Vencimento</label>
          <input type="date" value=${vencimento} onInput=${(e) => setVencimento(e.target.value)} />
        </div>
        <div>
          <label>Recorrência</label>
          <select value=${recorrencia} onChange=${(e) => setRecorrencia(e.target.value)}>
            <option value="nenhuma">Nenhuma</option>
            <option value="mensal">Mensal</option>
            <option value="anual">Anual</option>
          </select>
        </div>
      </div>
      <div class="linha-campos">
        <div>
          <label>Centro de custo</label>
          <select value=${centroCustoId} onChange=${(e) => setCentroCustoId(e.target.value)}>
            <option value="">—</option>
            ${centrosCusto.map((c) => html`<option value=${c.id}>${c.nome}</option>`)}
          </select>
        </div>
        <div>
          <label>Fornecedor</label>
          <select value=${fornecedorId} onChange=${(e) => setFornecedorId(e.target.value)}>
            <option value="">—</option>
            ${fornecedores.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
          </select>
        </div>
      </div>
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar conta"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function FormaReceber({ onSalvo }) {
  const [descricao, setDescricao] = useState("");
  const [origem, setOrigem] = useState("outro");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!descricao.trim() || !valor || Number(valor) <= 0 || !vencimento) {
      setErro("Preencha descrição, valor e vencimento.");
      return;
    }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("conta_receber").insert({
        estabelecimento_id,
        descricao: descricao.trim(),
        origem,
        valor: Number(valor),
        emissao: hojeISO(),
        vencimento,
        status: "a_receber",
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setDescricao(""); setValor(""); setVencimento("");
      onSalvo();
    } catch (e) {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Nova conta a receber</h3>
      <label>Descrição</label>
      <input type="text" value=${descricao} onInput=${(e) => setDescricao(e.target.value)} placeholder="Ex.: Sinal de evento de aniversário" />
      <div class="linha-campos">
        <div>
          <label>Origem</label>
          <select value=${origem} onChange=${(e) => setOrigem(e.target.value)}>
            <option value="evento">Evento</option>
            <option value="reserva">Reserva</option>
            <option value="contrato">Contrato</option>
            <option value="outro">Outro</option>
          </select>
        </div>
        <div>
          <label>Valor (R$)</label>
          <input type="number" step="0.01" min="0.01" value=${valor} onInput=${(e) => setValor(e.target.value)} />
        </div>
      </div>
      <label>Vencimento</label>
      <input type="date" value=${vencimento} onInput=${(e) => setVencimento(e.target.value)} />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar conta"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function ListaContas({ tipo, contas, fornecedoresPorId, centrosPorId, onMudou }) {
  const [processando, setProcessando] = useState(null);

  const ordenadas = useMemo(() => {
    return [...contas]
      .filter((c) => c.status !== "cancelado")
      .sort((a, b) => {
        const pesoStatusA = a.status === "a_vencer" || a.status === "a_receber" ? 0 : 1;
        const pesoStatusB = b.status === "a_vencer" || b.status === "a_receber" ? 0 : 1;
        if (pesoStatusA !== pesoStatusB) return pesoStatusA - pesoStatusB;
        return a.vencimento.localeCompare(b.vencimento);
      });
  }, [contas]);

  async function marcarComoFeito(conta) {
    setProcessando(conta.id);
    const tabela = tipo === "pagar" ? "conta_pagar" : "conta_receber";
    const campoData = tipo === "pagar" ? "pago_em" : "recebido_em";
    const novoStatus = tipo === "pagar" ? "pago" : "recebido";
    await sb.from(tabela).update({ status: novoStatus, [campoData]: hojeISO() }).eq("id", conta.id);
    setProcessando(null);
    onMudou();
  }

  if (!ordenadas.length) return html`<p class="vazio">Nenhuma conta cadastrada ainda.</p>`;

  return html`
    <div class="lista-contas">
      ${ordenadas.map((c) => html`
        <div class="item-conta" key=${c.id}>
          <div class="item-conta-topo">
            <span class="item-conta-desc">${c.descricao}</span>
            <${StatusChip} tipo=${tipo} status=${c.status} vencimento=${c.vencimento} />
          </div>
          <div class="item-conta-meta">
            ${tipo === "pagar" ? c.categoria : c.origem} · vence ${formatarData(c.vencimento)}
            ${tipo === "pagar" && c.fornecedor_id && fornecedoresPorId[c.fornecedor_id] ? ` · ${fornecedoresPorId[c.fornecedor_id]}` : ""}
            ${tipo === "pagar" && c.centro_custo_id && centrosPorId[c.centro_custo_id] ? ` · ${centrosPorId[c.centro_custo_id]}` : ""}
          </div>
          <div class="item-conta-rodape">
            <span class="item-conta-valor">${formatarMoeda(c.valor)}</span>
            ${(c.status === "a_vencer" || c.status === "a_receber") && html`
              <button class="botao-pequeno" disabled=${processando === c.id} onClick=${() => marcarComoFeito(c)}>
                ${processando === c.id ? "…" : (tipo === "pagar" ? "Marcar como pago" : "Marcar como recebido")}
              </button>
            `}
          </div>
        </div>
      `)}
    </div>
  `;
}

export default function Financeiro() {
  const [contasPagar, setContasPagar] = useState([]);
  const [contasReceber, setContasReceber] = useState([]);
  const [centrosCusto, setCentrosCusto] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState("");

  async function carregarTudo() {
    setErroCarga("");
    const [pagarRes, receberRes, centrosRes, fornecedoresRes] = await Promise.all([
      sb.from("conta_pagar").select("*").order("vencimento", { ascending: true }),
      sb.from("conta_receber").select("*").order("vencimento", { ascending: true }),
      sb.from("centro_custo").select("id,nome").order("nome"),
      sb.from("fornecedor").select("id,nome").order("nome"),
    ]);
    if (pagarRes.error || receberRes.error) {
      setErroCarga("Não foi possível carregar as contas. Recarregue a página.");
    }
    setContasPagar(pagarRes.data || []);
    setContasReceber(receberRes.data || []);
    setCentrosCusto(centrosRes.data || []);
    setFornecedores(fornecedoresRes.data || []);
    setCarregando(false);
  }

  useEffect(() => { carregarTudo(); }, []);

  const fornecedoresPorId = useMemo(() => Object.fromEntries(fornecedores.map((f) => [f.id, f.nome])), [fornecedores]);
  const centrosPorId = useMemo(() => Object.fromEntries(centrosCusto.map((c) => [c.id, c.nome])), [centrosCusto]);

  if (carregando) return html`<p class="vazio">Carregando financeiro…</p>`;

  return html`
    <div>
      <h2>Financeiro</h2>
      ${erroCarga && html`<div class="msg-erro">${erroCarga}</div>`}
      <${ResumoStats} contasPagar=${contasPagar} contasReceber=${contasReceber} />

      <div class="colunas-financeiro">
        <div>
          <${FormaPagar} centrosCusto=${centrosCusto} fornecedores=${fornecedores} onSalvo=${carregarTudo} />
          <h3 class="titulo-lista">Contas a pagar</h3>
          <${ListaContas} tipo="pagar" contas=${contasPagar} fornecedoresPorId=${fornecedoresPorId} centrosPorId=${centrosPorId} onMudou=${carregarTudo} />
        </div>
        <div>
          <${FormaReceber} onSalvo=${carregarTudo} />
          <h3 class="titulo-lista">Contas a receber</h3>
          <${ListaContas} tipo="receber" contas=${contasReceber} fornecedoresPorId=${{}} centrosPorId=${{}} onMudou=${carregarTudo} />
        </div>
      </div>
    </div>
  `;
}
