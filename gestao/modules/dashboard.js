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

export default function Dashboard() {
  const [aba, setAba] = useState("visao-geral");
  return html`
    <div>
      <h2>Dashboard</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "visao-geral" ? " ativo" : "")} onClick=${() => setAba("visao-geral")}>Visão geral</button>
        <button class=${"sub-tab" + (aba === "garcons" ? " ativo" : "")} onClick=${() => setAba("garcons")}>Garçons e horários</button>
      </div>
      ${aba === "visao-geral" ? html`<${VisaoGeral} />` : html`<${PainelGarconsHorarios} />`}
    </div>
  `;
}
