import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, formatarMoeda, getEstabelecimentoId } from "../lib/supabase.js";

const html = htm.bind(h);

const CAMPOS = [
  { chave: "data_hora", rotulo: "Data/hora da venda", obrigatorio: true },
  { chave: "valor_bruto", rotulo: "Valor bruto (R$)", obrigatorio: true },
  { chave: "desconto", rotulo: "Desconto (R$)", obrigatorio: false },
  { chave: "taxa_servico", rotulo: "Taxa de serviço (R$)", obrigatorio: false },
  { chave: "mesa", rotulo: "Mesa", obrigatorio: false },
  { chave: "garcom_nome", rotulo: "Garçom", obrigatorio: false },
  { chave: "forma_pagamento", rotulo: "Forma de pagamento", obrigatorio: false },
  { chave: "cancelado", rotulo: "Cancelado (sim/não)", obrigatorio: false },
  { chave: "collibri_id", rotulo: "ID da venda no Colibri", obrigatorio: false },
];

function parseCSV(texto) {
  const linhas = texto.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  const sepVirgula = (linhas[0].match(/,/g) || []).length;
  const sepPontoVirgula = (linhas[0].match(/;/g) || []).length;
  const sep = sepPontoVirgula > sepVirgula ? ";" : ",";

  function parseLinha(linha) {
    const campos = [];
    let atual = "";
    let dentroAspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') { dentroAspas = !dentroAspas; continue; }
      if (c === sep && !dentroAspas) { campos.push(atual); atual = ""; continue; }
      atual += c;
    }
    campos.push(atual);
    return campos.map((c) => c.trim());
  }

  const cabecalho = parseLinha(linhas[0]);
  const linhasDados = linhas.slice(1).map(parseLinha);
  return { cabecalho, linhasDados };
}

function parseDataHora(valor) {
  if (!valor) return null;
  const m = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]?(\d{1,2})?:?(\d{2})?/);
  if (m) {
    const [, dia, mes, ano, hora, min] = m;
    const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T${(hora || "00").padStart(2, "0")}:${(min || "00").padStart(2, "0")}:00`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const d2 = new Date(valor);
  return isNaN(d2.getTime()) ? null : d2;
}

function parseNumero(valor) {
  if (valor == null || valor === "") return null;
  const limpo = String(valor).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(limpo);
  return isNaN(n) ? null : n;
}

function ImportadorCSV({ onImportado }) {
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [cabecalho, setCabecalho] = useState([]);
  const [linhasDados, setLinhasDados] = useState([]);
  const [mapeamento, setMapeamento] = useState({});
  const [validando, setValidando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState("");

  function aoSelecionarArquivo(ev) {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    setErro(""); setResultado(null);
    setNomeArquivo(arquivo.name);
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const { cabecalho, linhasDados } = parseCSV(String(leitor.result));
        setCabecalho(cabecalho);
        setLinhasDados(linhasDados);
        const mapaAuto = {};
        const PALAVRAS_CHAVE = {
          data_hora: ["data"],
          valor_bruto: ["valor", "total"],
          desconto: ["desconto"],
          taxa_servico: ["taxa"],
          mesa: ["mesa"],
          garcom_nome: ["garcom", "garçom", "atendente"],
          forma_pagamento: ["pagamento", "forma"],
          cancelado: ["cancelad"],
          collibri_id: ["colibri", "id venda", "idvenda"],
        };
        CAMPOS.forEach((campo) => {
          const palavras = PALAVRAS_CHAVE[campo.chave] || [campo.chave.split("_")[0]];
          const idx = cabecalho.findIndex((h) => {
            const hLower = h.toLowerCase();
            return palavras.some((p) => hLower.includes(p));
          });
          if (idx >= 0) mapaAuto[campo.chave] = idx;
        });
        setMapeamento(mapaAuto);
      } catch (e) {
        setErro("Não foi possível ler o arquivo. Confirme que é um CSV válido.");
      }
    };
    leitor.readAsText(arquivo, "utf-8");
  }

  const linhasProcessadas = useMemo(() => {
    if (!linhasDados.length) return [];
    return linhasDados.map((linha, idx) => {
      const pegar = (chave) => (mapeamento[chave] != null ? linha[mapeamento[chave]] : "");
      const dataHora = parseDataHora(pegar("data_hora"));
      const valorBruto = parseNumero(pegar("valor_bruto"));
      const desconto = parseNumero(pegar("desconto")) || 0;
      const taxaServico = parseNumero(pegar("taxa_servico")) || 0;
      const cancelText = (pegar("cancelado") || "").toLowerCase();
      const cancelado = ["sim", "s", "true", "1", "yes"].includes(cancelText);
      const erros = [];
      if (!dataHora) erros.push("data inválida");
      if (valorBruto == null || valorBruto <= 0) erros.push("valor bruto inválido");
      return {
        linhaOriginal: idx + 2,
        data_hora: dataHora,
        valor_bruto: valorBruto,
        desconto,
        taxa_servico: taxaServico,
        mesa: pegar("mesa") || null,
        garcom_nome: pegar("garcom_nome") || null,
        forma_pagamento: pegar("forma_pagamento") || null,
        cancelado,
        collibri_id: pegar("collibri_id") || null,
        valida: erros.length === 0,
        erros,
      };
    });
  }, [linhasDados, mapeamento]);

  const validas = linhasProcessadas.filter((l) => l.valida);
  const invalidas = linhasProcessadas.filter((l) => !l.valida);

  const resumo = useMemo(() => {
    if (!validas.length) return null;
    const total = validas.reduce((acc, l) => acc + (l.valor_bruto || 0), 0);
    const datas = validas.map((l) => l.data_hora).filter(Boolean).sort((a, b) => a - b);
    const inicio = datas[0], fim = datas[datas.length - 1];
    const periodo = inicio && fim
      ? (inicio.toLocaleDateString("pt-BR") === fim.toLocaleDateString("pt-BR")
          ? inicio.toLocaleDateString("pt-BR")
          : `${inicio.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}`)
      : "período não identificado";
    return { total, periodo };
  }, [validas]);

  function aoClicarImportar() {
    if (!resumo) return;
    const texto = `Vamos importar ${validas.length} venda(s), totalizando ${formatarMoeda(resumo.total)}, no período de ${resumo.periodo}.\n\nConfirma a importação?`;
    if (confirm(texto)) confirmarImportacao();
  }

  async function confirmarImportacao() {
    setValidando(true);
    setErro("");
    const inicioSync = new Date().toISOString();
    try {
      const estabelecimento_id = await getEstabelecimentoId();

      const idsColibri = validas.map((l) => l.collibri_id).filter(Boolean);
      let idsExistentes = new Set();
      if (idsColibri.length) {
        const existentes = await sb.from("venda").select("collibri_id").in("collibri_id", idsColibri);
        idsExistentes = new Set((existentes.data || []).map((v) => v.collibri_id));
      }

      const paraInserir = validas.filter((l) => !l.collibri_id || !idsExistentes.has(l.collibri_id));
      const duplicadas = validas.length - paraInserir.length;

      const linhas = paraInserir.map((l) => ({
        estabelecimento_id,
        origem: "collibri",
        collibri_id: l.collibri_id,
        data_hora: l.data_hora.toISOString(),
        mesa: l.mesa,
        garcom_nome: l.garcom_nome,
        forma_pagamento: l.forma_pagamento,
        valor_bruto: l.valor_bruto,
        desconto: l.desconto,
        taxa_servico: l.taxa_servico,
        cancelado: l.cancelado,
        valor_liquido: l.valor_bruto - l.desconto + l.taxa_servico,
      }));

      let inseridos = 0;
      let erroInsercao = null;
      if (linhas.length) {
        const r = await sb.from("venda").insert(linhas);
        if (r.error) erroInsercao = r.error.message;
        else inseridos = linhas.length;
      }

      const logResp = await sb.from("collibri_sync_log").insert({
        estabelecimento_id,
        tipo_entidade: "venda",
        iniciado_em: inicioSync,
        finalizado_em: new Date().toISOString(),
        registros_processados: inseridos,
        registros_com_erro: invalidas.length + (erroInsercao ? linhas.length : 0),
        status: erroInsercao ? "erro" : "concluido",
        erro_detalhe: erroInsercao || (invalidas.length || duplicadas ? `${invalidas.length} linha(s) inválida(s), ${duplicadas} duplicada(s) ignorada(s)` : null),
      });
      if (logResp.error) console.error("Falha ao registrar log de sincronização:", logResp.error.message);

      if (erroInsercao) { setErro("Falha ao importar: " + erroInsercao); return; }

      setResultado({ inseridos, invalidas: invalidas.length, duplicadas });
      setNomeArquivo(""); setCabecalho([]); setLinhasDados([]); setMapeamento({});
      onImportado();
    } catch (e) {
      setErro("Erro inesperado durante a importação.");
    } finally {
      setValidando(false);
    }
  }

  return html`
    <div class="card">
      <h3>Importar planilha do Colibri</h3>
      <p class="desc-form">Exporte o relatório de vendas do Colibri Cloud em CSV, envie aqui, confira o mapeamento das colunas e a prévia antes de confirmar.</p>
      <input type="file" accept=".csv,text/csv" onChange=${aoSelecionarArquivo} />
      ${erro && html`<div class="msg-erro">${erro}</div>`}
      ${resultado && html`
        <div class="alerta-banner" style="border-color: var(--sucesso); color: var(--sucesso); background: rgba(76,175,109,0.12);">
          Importação concluída: ${resultado.inseridos} venda(s) importada(s)${resultado.duplicadas ? `, ${resultado.duplicadas} já existiam (ignoradas)` : ""}${resultado.invalidas ? `, ${resultado.invalidas} linha(s) inválida(s) ignorada(s)` : ""}.
        </div>
      `}

      ${cabecalho.length > 0 && html`
        <div style="margin-top: 16px;">
          <h3>Mapear colunas — ${nomeArquivo}</h3>
          <div class="mapa-colunas">
            ${CAMPOS.map((campo) => html`
              <div>
                <label>${campo.rotulo}${campo.obrigatorio ? " *" : ""}</label>
                <select
                  value=${mapeamento[campo.chave] != null ? mapeamento[campo.chave] : ""}
                  onChange=${(e) => setMapeamento({ ...mapeamento, [campo.chave]: e.target.value === "" ? undefined : Number(e.target.value) })}
                >
                  <option value="">— não usar —</option>
                  ${cabecalho.map((h, i) => html`<option value=${i}>${h}</option>`)}
                </select>
              </div>
            `)}
          </div>

          <h3 style="margin-top: 18px;">Prévia (${linhasProcessadas.length} linhas · ${validas.length} válidas · ${invalidas.length} com erro)</h3>
          <div class="tabela-preview-wrap">
            <table class="tabela-preview">
              <thead><tr><th>Linha</th><th>Data/hora</th><th>Valor bruto</th><th>Mesa</th><th>Garçom</th><th>Status</th></tr></thead>
              <tbody>
                ${linhasProcessadas.slice(0, 8).map((l) => html`
                  <tr key=${l.linhaOriginal}>
                    <td>${l.linhaOriginal}</td>
                    <td>${l.data_hora ? l.data_hora.toLocaleString("pt-BR") : "—"}</td>
                    <td>${l.valor_bruto != null ? formatarMoeda(l.valor_bruto) : "—"}</td>
                    <td>${l.mesa || "—"}</td>
                    <td>${l.garcom_nome || "—"}</td>
                    <td>${l.valida ? html`<span class="chip chip-ok">OK</span>` : html`<span class="chip chip-erro">${l.erros.join(", ")}</span>`}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
          ${linhasProcessadas.length > 8 && html`<p class="desc-form">Mostrando as 8 primeiras de ${linhasProcessadas.length} linhas.</p>`}

          ${resumo && html`
            <div class="alerta-banner" style="margin-top: 12px;">
              Prévia: ${validas.length} venda(s) válida(s), totalizando ${formatarMoeda(resumo.total)}, no período de ${resumo.periodo}.
              ${invalidas.length > 0 ? ` ${invalidas.length} linha(s) inválida(s) serão ignoradas.` : ""}
            </div>
          `}

          <button class="botao" style="margin-top: 12px;" disabled=${validando || !validas.length} onClick=${aoClicarImportar}>
            ${validando ? "Importando…" : `Confirmar importação de ${validas.length} venda(s)`}
          </button>
        </div>
      `}
    </div>
  `;
}

function ListaVendas() {
  const [vendas, setVendas] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("venda").select("*").order("data_hora", { ascending: false }).limit(50);
    setVendas(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando vendas…</p>`;
  if (!vendas.length) return html`<p class="vazio">Nenhuma venda registrada ainda.</p>`;

  const totalLiquido = vendas.filter((v) => !v.cancelado).reduce((acc, v) => acc + Number(v.valor_liquido), 0);

  return html`
    <div>
      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="stat-box"><div class="stat-num">${vendas.length}</div><div class="stat-lbl">Vendas (últimas 50)</div></div>
        <div class="stat-box"><div class="stat-num">${formatarMoeda(totalLiquido)}</div><div class="stat-lbl">Total líquido</div></div>
        <div class="stat-box"><div class="stat-num">${formatarMoeda(vendas.length ? totalLiquido / vendas.filter((v) => !v.cancelado).length : 0)}</div><div class="stat-lbl">Ticket médio</div></div>
      </div>
      <div class="lista-contas">
        ${vendas.map((v) => html`
          <div class="item-conta" key=${v.id}>
            <div class="item-conta-topo">
              <span class="item-conta-desc">${v.mesa ? `Mesa ${v.mesa}` : "Venda"} ${v.garcom_nome ? `· ${v.garcom_nome}` : ""}</span>
              <span class="item-conta-valor">${formatarMoeda(v.valor_liquido)}</span>
            </div>
            <div class="item-conta-meta">
              ${new Date(v.data_hora).toLocaleString("pt-BR")} · ${v.forma_pagamento || "forma não informada"}
              ${v.cancelado ? html` · <span class="chip chip-erro">Cancelada</span>` : ""}
              · <span class="chip chip-neutro">${v.origem}</span>
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

function HistoricoSincronizacao() {
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    sb.from("collibri_sync_log").select("*").order("iniciado_em", { ascending: false }).limit(20)
      .then((r) => { setLogs(r.data || []); setCarregando(false); });
  }, []);

  if (carregando) return html`<p class="vazio">Carregando histórico…</p>`;
  if (!logs.length) return html`<p class="vazio">Nenhuma sincronização registrada ainda.</p>`;

  return html`
    <div class="lista-contas">
      ${logs.map((l) => html`
        <div class="item-conta" key=${l.id}>
          <div class="item-conta-topo">
            <span class="item-conta-desc">${l.tipo_entidade}</span>
            <span class="chip ${l.status === "concluido" ? "chip-ok" : l.status === "erro" ? "chip-erro" : "chip-alerta"}">${l.status}</span>
          </div>
          <div class="item-conta-meta">
            ${new Date(l.iniciado_em).toLocaleString("pt-BR")} · ${l.registros_processados} processado(s), ${l.registros_com_erro} com erro
            ${l.erro_detalhe ? html`<br />${l.erro_detalhe}` : ""}
          </div>
        </div>
      `)}
    </div>
  `;
}

function PainelSaudeIntegracao() {
  const [log, setLog] = useState(undefined);

  useEffect(() => {
    sb.from("collibri_sync_log").select("*").order("iniciado_em", { ascending: false }).limit(1)
      .then((r) => setLog((r.data && r.data[0]) || null));
  }, []);

  if (log === undefined) return null;
  if (!log) {
    return html`<div class="alerta-banner">Nenhuma importação do Colibri foi feita ainda.</div>`;
  }

  const dias = Math.floor((Date.now() - new Date(log.iniciado_em).getTime()) / 86400000);
  const atrasada = dias >= 3;

  return html`
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding: 12px 16px;">
      <div style="font-size: 0.86rem;">
        <strong>Última importação do Colibri:</strong> ${new Date(log.iniciado_em).toLocaleString("pt-BR")}
        <span class="chip ${log.status === "concluido" ? "chip-ok" : log.status === "erro" ? "chip-erro" : "chip-alerta"}" style="margin-left: 6px;">${log.status}</span>
        ${log.registros_com_erro > 0 ? html`<span class="chip chip-alerta" style="margin-left: 6px;">${log.registros_com_erro} com erro</span>` : ""}
      </div>
      ${atrasada && html`<span class="chip chip-alerta">Sem importação há ${dias} dia(s)</span>`}
    </div>
  `;
}

export default function Vendas() {
  const [aba, setAba] = useState("importar");
  const [chaveLista, setChaveLista] = useState(0);

  return html`
    <div>
      <h2>Vendas e Colibri</h2>
      <${PainelSaudeIntegracao} />
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "importar" ? " ativo" : "")} onClick=${() => setAba("importar")}>Importar planilha</button>
        <button class=${"sub-tab" + (aba === "vendas" ? " ativo" : "")} onClick=${() => setAba("vendas")}>Vendas registradas</button>
        <button class=${"sub-tab" + (aba === "historico" ? " ativo" : "")} onClick=${() => setAba("historico")}>Histórico de importação</button>
      </div>
      ${aba === "importar" && html`<${ImportadorCSV} onImportado=${() => setChaveLista((k) => k + 1)} />`}
      ${aba === "vendas" && html`<${ListaVendas} key=${chaveLista} />`}
      ${aba === "historico" && html`<${HistoricoSincronizacao} />`}
    </div>
  `;
}
