import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, formatarMoeda, formatarData, diasAte } from "../lib/supabase.js";

const html = htm.bind(h);

function inicioDoDiaISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function inicioDoMesISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function Secao({ titulo, children }) {
  return html`<div class="card"><h3 style="margin-bottom: 14px;">${titulo}</h3>${children}</div>`;
}

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function PainelGarconsHorarios() {
  const [carregando, setCarregando] = useState(true);
  const [vendas, setVendas] = useState([]);

  useEffect(() => {
    sb.from("venda").select("garcom_nome, data_hora, valor_liquido, cancelado").then((r) => {
      setVendas((r.data || []).filter((v) => !v.cancelado));
      setCarregando(false);
    });
  }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  if (!vendas.length) {
    return html`
      <div class="card">
        <h3>Garçons e horários</h3>
        <p class="desc-form">
          Esta análise usa o nome do garçom e o horário de cada venda (vindos do Colibri) para mostrar quem mais
          vende e quais dias/horários têm mais movimento — útil para montar a escala.
        </p>
        <p class="vazio">Ainda não há vendas importadas do Colibri para gerar esta análise.</p>
      </div>
    `;
  }

  const porGarcom = {};
  vendas.forEach((v) => {
    const nome = (v.garcom_nome || "").trim() || "Não informado";
    if (!porGarcom[nome]) porGarcom[nome] = { faturamento: 0, qtd: 0 };
    porGarcom[nome].faturamento += Number(v.valor_liquido);
    porGarcom[nome].qtd += 1;
  });
  const ranking = Object.entries(porGarcom)
    .map(([nome, r]) => ({ nome, ...r, ticketMedio: r.qtd ? r.faturamento / r.qtd : 0 }))
    .sort((a, b) => b.faturamento - a.faturamento);

  const porHora = Array.from({ length: 24 }, () => 0);
  const porDiaSemana = Array.from({ length: 7 }, () => 0);
  vendas.forEach((v) => {
    const d = new Date(v.data_hora);
    porHora[d.getHours()] += Number(v.valor_liquido);
    porDiaSemana[d.getDay()] += Number(v.valor_liquido);
  });
  const maxHora = Math.max(1, ...porHora);
  const maxDia = Math.max(1, ...porDiaSemana);

  return html`
    <div class="colunas-financeiro">
      <div>
        <h3 class="titulo-lista">Ranking de garçons</h3>
        <div class="lista-contas">
          ${ranking.map((r, idx) => html`
            <div class="item-conta" key=${r.nome}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${idx + 1}º — ${r.nome}</span>
                <span class="item-conta-valor">${formatarMoeda(r.faturamento)}</span>
              </div>
              <div class="item-conta-meta">${r.qtd} venda(s) · ticket médio ${formatarMoeda(r.ticketMedio)}</div>
            </div>
          `)}
        </div>
      </div>
      <div>
        <h3 class="titulo-lista">Faturamento por dia da semana</h3>
        <div class="card" style="margin-bottom: 16px;">
          ${DIAS_SEMANA.map((dia, i) => html`
            <div class="barra-linha" key=${dia}>
              <span class="rotulo">${dia}</span>
              <div class="barra"><div class="barra-preenchida" style="width: ${(porDiaSemana[i] / maxDia) * 100}%"></div></div>
              <span class="valor">${formatarMoeda(porDiaSemana[i])}</span>
            </div>
          `)}
        </div>
        <h3 class="titulo-lista">Faturamento por horário</h3>
        <div class="card">
          ${porHora.map((valor, hora) => valor > 0 && html`
            <div class="barra-linha" key=${hora}>
              <span class="rotulo">${String(hora).padStart(2, "0")}h</span>
              <div class="barra"><div class="barra-preenchida" style="width: ${(valor / maxHora) * 100}%"></div></div>
              <span class="valor">${formatarMoeda(valor)}</span>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function VisaoGeral() {
  const [carregando, setCarregando] = useState(true);
  const [dados, setDados] = useState(null);

  useEffect(() => {
    async function carregar() {
      const [vendasHojeRes, vendasMesRes, comprasRes, contasPagarRes, insumosRes] = await Promise.all([
        sb.from("venda").select("valor_liquido, cancelado, forma_pagamento").gte("data_hora", inicioDoDiaISO()),
        sb.from("venda").select("valor_liquido, cancelado").gte("data_hora", inicioDoMesISO()),
        sb.from("compra").select("quantidade, custo_unitario").gte("created_at", inicioDoMesISO()),
        sb.from("conta_pagar").select("valor, status, vencimento, pago_em"),
        sb.from("insumo").select("nome, estoque_atual, ponto_reposicao"),
      ]);

      const vendasHoje = (vendasHojeRes.data || []).filter((v) => !v.cancelado);
      const canceladasHoje = (vendasHojeRes.data || []).filter((v) => v.cancelado);
      const faturamentoHoje = vendasHoje.reduce((acc, v) => acc + Number(v.valor_liquido), 0);
      const ticketMedioHoje = vendasHoje.length ? faturamentoHoje / vendasHoje.length : 0;

      const porFormaPagamento = {};
      vendasHoje.forEach((v) => {
        const chave = v.forma_pagamento || "não informado";
        porFormaPagamento[chave] = (porFormaPagamento[chave] || 0) + Number(v.valor_liquido);
      });

      const vendasMes = (vendasMesRes.data || []).filter((v) => !v.cancelado);
      const faturamentoMes = vendasMes.reduce((acc, v) => acc + Number(v.valor_liquido), 0);

      const comprasMes = (comprasRes.data || []).reduce((acc, c) => acc + Number(c.quantidade) * Number(c.custo_unitario), 0);

      const contas = contasPagarRes.data || [];
      const hoje = new Date().toISOString().slice(0, 10);
      const inicioMes = inicioDoMesISO().slice(0, 10);
      const despesasPagasMes = contas
        .filter((c) => c.status === "pago" && c.pago_em && c.pago_em >= inicioMes)
        .reduce((acc, c) => acc + Number(c.valor), 0);
      const abertas = contas.filter((c) => c.status === "a_vencer");
      const vencidas = abertas.filter((c) => diasAte(c.vencimento) < 0);
      const vencendo7 = abertas.filter((c) => { const d = diasAte(c.vencimento); return d >= 0 && d <= 7; });

      const resultadoEstimadoMes = faturamentoMes - despesasPagasMes - comprasMes;

      const insumosBaixos = (insumosRes.data || []).filter((i) => Number(i.estoque_atual) <= Number(i.ponto_reposicao));

      setDados({
        faturamentoHoje, ticketMedioHoje, pedidosHoje: vendasHoje.length,
        canceladasHoje: canceladasHoje.length, valorCanceladoHoje: canceladasHoje.reduce((acc, v) => acc + Number(v.valor_liquido), 0),
        porFormaPagamento,
        faturamentoMes, comprasMes, despesasPagasMes, resultadoEstimadoMes,
        vencidas, vencendo7,
        insumosBaixos,
      });
      setCarregando(false);
    }
    carregar();
  }, []);

  if (carregando) return html`<p class="vazio">Carregando dashboard…</p>`;
  const d = dados;
  const maxFormaPagamento = Math.max(1, ...Object.values(d.porFormaPagamento));

  return html`
    <div>
      <${Secao} titulo="Hoje">
        <div class="stat-grid">
          <div class="stat-box"><div class="stat-num">${formatarMoeda(d.faturamentoHoje)}</div><div class="stat-lbl">Faturamento</div></div>
          <div class="stat-box"><div class="stat-num">${d.pedidosHoje}</div><div class="stat-lbl">Vendas</div></div>
          <div class="stat-box"><div class="stat-num">${formatarMoeda(d.ticketMedioHoje)}</div><div class="stat-lbl">Ticket médio</div></div>
          <div class="stat-box ${d.canceladasHoje ? "stat-alerta" : ""}"><div class="stat-num">${d.canceladasHoje}</div><div class="stat-lbl">Cancelamentos${d.canceladasHoje ? ` (${formatarMoeda(d.valorCanceladoHoje)})` : ""}</div></div>
        </div>
        ${Object.keys(d.porFormaPagamento).length > 0 && html`
          <div style="margin-top: 4px;">
            ${Object.entries(d.porFormaPagamento).sort((a, b) => b[1] - a[1]).map(([forma, valor]) => html`
              <div class="barra-linha" key=${forma}>
                <span class="rotulo">${forma}</span>
                <div class="barra"><div class="barra-preenchida" style="width: ${(valor / maxFormaPagamento) * 100}%"></div></div>
                <span class="valor">${formatarMoeda(valor)}</span>
              </div>
            `)}
          </div>
        `}
      </${Secao}>

      <${Secao} titulo="Este mês">
        <div class="stat-grid">
          <div class="stat-box"><div class="stat-num">${formatarMoeda(d.faturamentoMes)}</div><div class="stat-lbl">Faturamento</div></div>
          <div class="stat-box"><div class="stat-num">${formatarMoeda(d.comprasMes)}</div><div class="stat-lbl">Compras</div></div>
          <div class="stat-box"><div class="stat-num">${formatarMoeda(d.despesasPagasMes)}</div><div class="stat-lbl">Despesas pagas</div></div>
          <div class="stat-box ${d.resultadoEstimadoMes < 0 ? "stat-erro" : "stat-ok"}"><div class="stat-num">${formatarMoeda(d.resultadoEstimadoMes)}</div><div class="stat-lbl">Resultado estimado</div></div>
        </div>
        <p class="desc-form">Resultado estimado = faturamento − despesas pagas − compras do mês. Não inclui folha, impostos e outras despesas ainda não lançadas como conta a pagar.</p>
      </${Secao}>

      <${Secao} titulo="Precisa de atenção">
        ${!d.vencidas.length && !d.vencendo7.length && !d.insumosBaixos.length && html`<p class="vazio">Nada pendente no momento.</p>`}
        ${d.vencidas.length > 0 && html`<div class="alerta-banner" style="border-color: var(--erro); color: var(--erro); background: rgba(229,72,77,0.1);">${d.vencidas.length} conta(s) vencida(s): ${formatarMoeda(d.vencidas.reduce((a, c) => a + Number(c.valor), 0))}</div>`}
        ${d.vencendo7.length > 0 && html`<div class="alerta-banner">${d.vencendo7.length} conta(s) vencendo nos próximos 7 dias: ${formatarMoeda(d.vencendo7.reduce((a, c) => a + Number(c.valor), 0))}</div>`}
        ${d.insumosBaixos.length > 0 && html`<div class="alerta-banner">${d.insumosBaixos.length} insumo(s) com estoque baixo: ${d.insumosBaixos.map((i) => i.nome).join(", ")}</div>`}
      </${Secao}>
    </div>
  `;
}

function inicioDaSemanaISO() {
  const d = new Date();
  const diaSemana = d.getDay();
  d.setDate(d.getDate() - diaSemana);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function coletarAlertas() {
  const [contasRes, insumosRes, docsRes, contratosRes, lembretesRes, feriasRes, equipRes, funcDocsRes, funcRes] = await Promise.all([
    sb.from("conta_pagar").select("descricao, valor, vencimento, status").eq("status", "a_vencer"),
    sb.from("insumo").select("nome, estoque_atual, ponto_reposicao"),
    sb.from("documento_empresa").select("nome, validade").not("validade", "is", null),
    sb.from("contrato").select("contraparte, termino").not("termino", "is", null),
    sb.from("lembrete").select("titulo, data_vencimento, status").eq("status", "pendente"),
    sb.from("funcionario_ferias").select("funcionario_id, limite_para_gozo, status").neq("status", "gozada"),
    sb.from("equipamento").select("nome, proxima_revisao").not("proxima_revisao", "is", null),
    sb.from("funcionario_documento").select("funcionario_id, nome, validade").not("validade", "is", null),
    sb.from("funcionario").select("id, nome"),
  ]);

  const nomesPorId = Object.fromEntries((funcRes.data || []).map((f) => [f.id, f.nome]));
  const itens = [];

  (contasRes.data || []).forEach((c) => {
    const dias = diasAte(c.vencimento);
    if (dias <= 7) itens.push({ categoria: "Contas a pagar", texto: `${c.descricao} — ${formatarMoeda(c.valor)}`, dias });
  });
  (insumosRes.data || []).filter((i) => Number(i.estoque_atual) <= Number(i.ponto_reposicao)).forEach((i) => {
    itens.push({ categoria: "Estoque baixo", texto: i.nome, dias: -1 });
  });
  (docsRes.data || []).forEach((d) => {
    const dias = diasAte(d.validade);
    if (dias <= 30) itens.push({ categoria: "Documento da empresa", texto: d.nome, dias });
  });
  (contratosRes.data || []).forEach((c) => {
    const dias = diasAte(c.termino);
    if (dias <= 30) itens.push({ categoria: "Contrato", texto: c.contraparte, dias });
  });
  (lembretesRes.data || []).forEach((l) => {
    const dias = diasAte(l.data_vencimento);
    if (dias <= 30) itens.push({ categoria: "Lembrete", texto: l.titulo, dias });
  });
  (feriasRes.data || []).forEach((f) => {
    const dias = diasAte(f.limite_para_gozo);
    if (dias <= 60) itens.push({ categoria: "Férias", texto: `${nomesPorId[f.funcionario_id] || "?"} — prazo de gozo`, dias });
  });
  (equipRes.data || []).forEach((e) => {
    const dias = diasAte(e.proxima_revisao);
    if (dias <= 30) itens.push({ categoria: "Manutenção de equipamento", texto: e.nome, dias });
  });
  (funcDocsRes.data || []).forEach((d) => {
    const dias = diasAte(d.validade);
    if (dias <= 30) itens.push({ categoria: "Documento de funcionário", texto: `${nomesPorId[d.funcionario_id] || "?"} — ${d.nome}`, dias });
  });

  return itens.sort((a, b) => a.dias - b.dias);
}

function PainelAlertas() {
  const [carregando, setCarregando] = useState(true);
  const [alertas, setAlertas] = useState([]);

  useEffect(() => { coletarAlertas().then((a) => { setAlertas(a); setCarregando(false); }); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;
  if (!alertas.length) return html`<div class="card"><p class="vazio">Nada precisando de atenção no momento.</p></div>`;

  const vencidos = alertas.filter((a) => a.dias < 0);
  const proximos = alertas.filter((a) => a.dias >= 0);

  return html`
    <div>
      ${vencidos.length > 0 && html`
        <div class="alerta-banner" style="border-color: var(--erro); color: var(--erro); background: rgba(229,72,77,0.1); margin-bottom: 20px;">
          <strong>${vencidos.length} item(ns) vencido(s) ou já no limite.</strong>
        </div>
      `}
      <div class="lista-contas">
        ${alertas.map((a, idx) => html`
          <div class="item-conta" key=${idx}>
            <div class="item-conta-topo">
              <span class="item-conta-desc">${a.texto}</span>
              <span class="chip ${a.dias < 0 ? "chip-erro" : a.dias <= 7 ? "chip-alerta" : "chip-neutro"}">
                ${a.dias < 0 ? `Vencido há ${Math.abs(a.dias)}d` : a.dias === 0 ? "Vence hoje" : `Vence em ${a.dias}d`}
              </span>
            </div>
            <div class="item-conta-meta">${a.categoria}</div>
          </div>
        `)}
      </div>
    </div>
  `;
}

async function gerarRelatorio(periodo) {
  const agora = new Date();
  let inicio;
  let rotuloPeriodo;
  if (periodo === "hoje") { inicio = inicioDoDiaISO(); rotuloPeriodo = "hoje"; }
  else if (periodo === "semana") { inicio = inicioDaSemanaISO(); rotuloPeriodo = "esta semana"; }
  else { inicio = inicioDoMesISO(); rotuloPeriodo = "este mês"; }

  const [vendasRes, contasRes, alertas] = await Promise.all([
    sb.from("venda").select("valor_liquido, cancelado").gte("data_hora", inicio),
    sb.from("conta_pagar").select("valor, status, pago_em").gte("emissao", inicio.slice(0, 10)),
    coletarAlertas(),
  ]);

  const vendas = (vendasRes.data || []).filter((v) => !v.cancelado);
  const faturamento = vendas.reduce((acc, v) => acc + Number(v.valor_liquido), 0);
  const ticketMedio = vendas.length ? faturamento / vendas.length : 0;
  const despesasPagas = (contasRes.data || []).filter((c) => c.status === "pago").reduce((acc, c) => acc + Number(c.valor), 0);
  const vencidos = alertas.filter((a) => a.dias < 0);

  const linhas = [
    `Relatório — Serra Dourada (${rotuloPeriodo})`,
    ``,
    `Faturamento: ${formatarMoeda(faturamento)}`,
    `Vendas: ${vendas.length}`,
    `Ticket médio: ${formatarMoeda(ticketMedio)}`,
    `Despesas pagas no período: ${formatarMoeda(despesasPagas)}`,
    ``,
    vencidos.length ? `Atenção: ${vencidos.length} item(ns) vencido(s) — veja a aba Alertas.` : `Sem pendências vencidas no momento.`,
  ];
  return linhas.join("\n");
}

function PainelRelatorios() {
  const [periodo, setPeriodo] = useState("hoje");
  const [texto, setTexto] = useState("");
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function gerar() {
    setGerando(true);
    setCopiado(false);
    const r = await gerarRelatorio(periodo);
    setTexto(r);
    setGerando(false);
  }
  useEffect(() => { gerar(); }, [periodo]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch (e) {}
  }

  return html`
    <div class="card">
      <h3>Relatório automático</h3>
      <div class="sub-tabs" style="margin-top: 4px;">
        <button class=${"sub-tab" + (periodo === "hoje" ? " ativo" : "")} onClick=${() => setPeriodo("hoje")}>Hoje</button>
        <button class=${"sub-tab" + (periodo === "semana" ? " ativo" : "")} onClick=${() => setPeriodo("semana")}>Esta semana</button>
        <button class=${"sub-tab" + (periodo === "mes" ? " ativo" : "")} onClick=${() => setPeriodo("mes")}>Este mês</button>
      </div>
      ${gerando
        ? html`<p class="vazio">Gerando…</p>`
        : html`
          <pre style="white-space: pre-wrap; font-family: inherit; background: var(--fundo-input); border: 1px solid var(--borda); border-radius: 9px; padding: 14px; font-size: 0.86rem; line-height: 1.5;">${texto}</pre>
          <button class="botao-secundario" onClick=${copiar}>${copiado ? "Copiado!" : "Copiar texto"}</button>
        `}
    </div>
  `;
}

function normalizarTexto(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

async function responderFaturamentoHoje() {
  const r = await sb.from("venda").select("valor_liquido, cancelado").gte("data_hora", inicioDoDiaISO());
  const vendas = (r.data || []).filter((v) => !v.cancelado);
  const total = vendas.reduce((acc, v) => acc + Number(v.valor_liquido), 0);
  return `O faturamento de hoje é ${formatarMoeda(total)}, em ${vendas.length} venda(s).`;
}

async function responderFaturamentoMes() {
  const r = await sb.from("venda").select("valor_liquido, cancelado").gte("data_hora", inicioDoMesISO());
  const vendas = (r.data || []).filter((v) => !v.cancelado);
  const total = vendas.reduce((acc, v) => acc + Number(v.valor_liquido), 0);
  return `O faturamento deste mês é ${formatarMoeda(total)}, em ${vendas.length} venda(s).`;
}

async function responderTicketMedio() {
  const r = await sb.from("venda").select("valor_liquido, cancelado").gte("data_hora", inicioDoDiaISO());
  const vendas = (r.data || []).filter((v) => !v.cancelado);
  if (!vendas.length) return "Ainda não há vendas hoje para calcular o ticket médio.";
  const total = vendas.reduce((acc, v) => acc + Number(v.valor_liquido), 0);
  return `O ticket médio de hoje é ${formatarMoeda(total / vendas.length)}.`;
}

async function responderContas() {
  const r = await sb.from("conta_pagar").select("descricao, valor, vencimento").eq("status", "a_vencer");
  const contas = (r.data || []).map((c) => ({ ...c, dias: diasAte(c.vencimento) })).sort((a, b) => a.dias - b.dias);
  const vencidas = contas.filter((c) => c.dias < 0);
  const proximos7 = contas.filter((c) => c.dias >= 0 && c.dias <= 7);
  if (!vencidas.length && !proximos7.length) return "Não há contas a pagar vencidas ou vencendo nos próximos 7 dias.";
  const partes = [];
  if (vencidas.length) partes.push(`${vencidas.length} conta(s) vencida(s): ${vencidas.map((c) => c.descricao).join(", ")}.`);
  if (proximos7.length) partes.push(`${proximos7.length} conta(s) vencendo em até 7 dias: ${proximos7.map((c) => c.descricao).join(", ")}.`);
  return partes.join(" ");
}

async function responderEstoque() {
  const r = await sb.from("insumo").select("nome, estoque_atual, ponto_reposicao");
  const baixos = (r.data || []).filter((i) => Number(i.estoque_atual) <= Number(i.ponto_reposicao));
  if (!baixos.length) return "Nenhum insumo está no ou abaixo do ponto de reposição.";
  return `${baixos.length} insumo(s) com estoque baixo: ${baixos.map((i) => i.nome).join(", ")}.`;
}

async function responderGarcom() {
  const r = await sb.from("venda").select("garcom_nome, valor_liquido, cancelado").gte("data_hora", inicioDoMesISO());
  const vendas = (r.data || []).filter((v) => !v.cancelado && v.garcom_nome);
  if (!vendas.length) return "Ainda não há vendas com garçom identificado este mês.";
  const porGarcom = {};
  vendas.forEach((v) => { porGarcom[v.garcom_nome] = (porGarcom[v.garcom_nome] || 0) + Number(v.valor_liquido); });
  const [nome, valor] = Object.entries(porGarcom).sort((a, b) => b[1] - a[1])[0];
  return `O garçom com mais faturamento este mês é ${nome}, com ${formatarMoeda(valor)}.`;
}

async function responderProdutoMaisVendido() {
  const r = await sb.from("venda_item").select("produto_nome, quantidade");
  if (!(r.data || []).length) return "Ainda não há vendas por item importadas do Colibri.";
  const porProduto = {};
  r.data.forEach((it) => { porProduto[it.produto_nome] = (porProduto[it.produto_nome] || 0) + Number(it.quantidade); });
  const [nome, qtd] = Object.entries(porProduto).sort((a, b) => b[1] - a[1])[0];
  return `O produto mais vendido (total) é ${nome}, com ${qtd} unidade(s).`;
}

async function responderFerias() {
  const [feriasRes, funcRes] = await Promise.all([
    sb.from("funcionario_ferias").select("funcionario_id, limite_para_gozo").neq("status", "gozada"),
    sb.from("funcionario").select("id, nome"),
  ]);
  const nomesPorId = Object.fromEntries((funcRes.data || []).map((f) => [f.id, f.nome]));
  const proximas = (feriasRes.data || [])
    .map((f) => ({ nome: nomesPorId[f.funcionario_id] || "?", dias: diasAte(f.limite_para_gozo) }))
    .filter((f) => f.dias <= 60)
    .sort((a, b) => a.dias - b.dias);
  if (!proximas.length) return "Nenhum funcionário com prazo de férias vencendo nos próximos 60 dias.";
  return proximas.map((f) => `${f.nome} (${f.dias < 0 ? `vencido há ${Math.abs(f.dias)}d` : `${f.dias}d`})`).join(", ") + ".";
}

const INTENCOES = [
  { chaves: ["faturamento hoje", "vendemos hoje", "vendeu hoje"], responder: responderFaturamentoHoje },
  { chaves: ["faturamento", "vendemos", "vendas do mes", "vendas no mes"], responder: responderFaturamentoMes },
  { chaves: ["ticket medio"], responder: responderTicketMedio },
  { chaves: ["conta", "pagar", "vencendo", "vencimento"], responder: responderContas },
  { chaves: ["estoque", "insumo", "acabando", "reposicao"], responder: responderEstoque },
  { chaves: ["garcom", "garcons", "quem vende", "melhor vendedor"], responder: responderGarcom },
  { chaves: ["produto mais vendido", "prato mais vendido", "mais vendido"], responder: responderProdutoMaisVendido },
  { chaves: ["ferias"], responder: responderFerias },
];

async function responderPergunta(pergunta) {
  const normalizada = normalizarTexto(pergunta);
  const intencao = INTENCOES.find((i) => i.chaves.some((c) => normalizada.includes(c)));
  if (!intencao) {
    return "Não entendi a pergunta. Tente perguntar sobre: faturamento, ticket médio, contas a pagar, estoque, garçons, produto mais vendido ou férias.";
  }
  return intencao.responder();
}

function PainelPergunte() {
  const [pergunta, setPergunta] = useState("");
  const [historico, setHistorico] = useState([]);
  const [perguntando, setPerguntando] = useState(false);

  async function perguntar(ev) {
    ev.preventDefault();
    if (!pergunta.trim()) return;
    const p = pergunta.trim();
    setPergunta("");
    setPerguntando(true);
    const resposta = await responderPergunta(p);
    setHistorico((h) => [...h, { pergunta: p, resposta }]);
    setPerguntando(false);
  }

  const SUGESTOES = ["Qual o faturamento hoje?", "Tem conta vencendo?", "Como está o estoque?", "Quem vende mais?", "Tem férias vencendo?"];

  return html`
    <div class="card">
      <h3>Pergunte ao Serra Dourada</h3>
      <p class="desc-form">Respostas calculadas na hora, direto dos seus dados — sem inventar números. Pergunte sobre faturamento, contas, estoque, garçons, produtos ou férias.</p>
      <div class="lista-contas" style="margin-bottom: 14px; max-height: 340px; overflow-y: auto;">
        ${historico.map((h, idx) => html`
          <div key=${idx}>
            <div class="item-conta" style="background: transparent; border-style: dashed;"><strong>${h.pergunta}</strong></div>
            <div class="item-conta">${h.resposta}</div>
          </div>
        `)}
        ${!historico.length && html`<p class="vazio">Nenhuma pergunta ainda. Experimente uma das sugestões abaixo.</p>`}
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom: 14px;">
        ${SUGESTOES.map((s) => html`<button class="botao-secundario-pequeno" onClick=${() => setPergunta(s)}>${s}</button>`)}
      </div>
      <form onSubmit=${perguntar} style="display:flex; gap:8px;">
        <input type="text" style="margin-bottom:0;" value=${pergunta} onInput=${(e) => setPergunta(e.target.value)} placeholder="Digite sua pergunta…" />
        <button class="botao" type="submit" disabled=${perguntando} style="width:auto; white-space:nowrap;">${perguntando ? "…" : "Perguntar"}</button>
      </form>
    </div>
  `;
}

export default function Dashboard() {
  const [aba, setAba] = useState("visao-geral");
  return html`
    <div>
      <h2>Dashboard</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "visao-geral" ? " ativo" : "")} onClick=${() => setAba("visao-geral")}>Visão geral</button>
        <button class=${"sub-tab" + (aba === "garcons" ? " ativo" : "")} onClick=${() => setAba("garcons")}>Garçons e horários</button>
        <button class=${"sub-tab" + (aba === "alertas" ? " ativo" : "")} onClick=${() => setAba("alertas")}>Alertas</button>
        <button class=${"sub-tab" + (aba === "relatorios" ? " ativo" : "")} onClick=${() => setAba("relatorios")}>Relatórios</button>
        <button class=${"sub-tab" + (aba === "pergunte" ? " ativo" : "")} onClick=${() => setAba("pergunte")}>Pergunte ao Serra Dourada</button>
      </div>
      ${aba === "visao-geral" && html`<${VisaoGeral} />`}
      ${aba === "garcons" && html`<${PainelGarconsHorarios} />`}
      ${aba === "alertas" && html`<${PainelAlertas} />`}
      ${aba === "relatorios" && html`<${PainelRelatorios} />`}
      ${aba === "pergunte" && html`<${PainelPergunte} />`}
    </div>
  `;
}
