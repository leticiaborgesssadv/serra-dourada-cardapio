import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, agoraDatetimeLocal, formatarDataHora } from "./lib/supabase.js";
import {
  TAMANHOS, somarHoras, statusVencimento, ConteudoEtiqueta,
  registrarRastreabilidade, estiloImpressaoEtiqueta, CSS_ETIQUETA,
} from "./lib/etiquetas.js";
import WhatsApp from "./modules/whatsapp.js";

const html = htm.bind(h);

function TelaImprimir({ insumos, regras, nomeEstabelecimento, funcionario }) {
  const [insumoId, setInsumoId] = useState("");
  const [nome, setNome] = useState("");
  const [regraValidadeId, setRegraValidadeId] = useState("");
  const [dataManipulacao, setDataManipulacao] = useState(agoraDatetimeLocal());
  const [lote, setLote] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [tamanhoChave, setTamanhoChave] = useState(TAMANHOS[0].chave);
  const [confirmado, setConfirmado] = useState(false);

  const tamanho = TAMANHOS.find((t) => t.chave === tamanhoChave) || TAMANHOS[0];
  const regra = regras.find((r) => r.id === regraValidadeId);

  function selecionarInsumo(id) {
    setInsumoId(id);
    setConfirmado(false);
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
    responsavelNome: funcionario.nome, lote: lote.trim(),
  };

  const podeImprimir = nome.trim().length > 0 && !!regra && !!dataManipulacaoISO && Number(quantidade) > 0;
  const copias = Array.from({ length: Math.max(1, Math.min(200, Number(quantidade) || 1)) });

  function imprimir() {
    window.print();
    registrarRastreabilidade({
      tipo: "manipulacao", nome, insumo_id: insumoId || null,
      data_manipulacao: dataManipulacaoISO, data_validade: dataValidadeISO,
      responsavel_funcionario_id: funcionario.id, lote: dados.lote,
      quantidade_copias: Number(quantidade) || 1,
    });
    setConfirmado(true);
    setLote(""); setQuantidade("1"); setInsumoId(""); setNome(""); setRegraValidadeId("");
    setDataManipulacao(agoraDatetimeLocal());
  }

  return html`
    <div class="cozinha-form">
      <label class="cozinha-label">Insumo</label>
      <select class="cozinha-select" value=${insumoId} onChange=${(e) => selecionarInsumo(e.target.value)}>
        <option value="">Personalizado (digitar)</option>
        ${insumos.map((i) => html`<option value=${i.id}>${i.nome}</option>`)}
      </select>
      ${!insumoId && html`<input class="cozinha-input" type="text" value=${nome} onInput=${(e) => { setNome(e.target.value); setConfirmado(false); }} placeholder="Nome do preparo" />`}

      <label class="cozinha-label">Regra de validade</label>
      <select class="cozinha-select" value=${regraValidadeId} onChange=${(e) => { setRegraValidadeId(e.target.value); setConfirmado(false); }}>
        <option value="">Selecione…</option>
        ${regras.map((r) => html`<option value=${r.id}>${r.nome} (${r.horas_validade}h)</option>`)}
      </select>
      ${!regras.length && html`<p class="cozinha-aviso">Nenhuma regra de validade cadastrada ainda — peça pra gerência criar uma.</p>`}

      ${dataValidadeISO && html`<p class="cozinha-validade">Válido até ${formatarDataHora(dataValidadeISO)}</p>`}

      <div class="cozinha-linha-dupla">
        <div>
          <label class="cozinha-label">Lote (opcional)</label>
          <input class="cozinha-input" type="text" value=${lote} onInput=${(e) => setLote(e.target.value)} />
        </div>
        <div>
          <label class="cozinha-label">Quantidade</label>
          <input class="cozinha-input" type="number" min="1" max="200" value=${quantidade} onInput=${(e) => setQuantidade(e.target.value)} />
        </div>
      </div>

      <details class="cozinha-avancado">
        <summary>Ajustes (manipulado em, tamanho da etiqueta)</summary>
        <label class="cozinha-label">Manipulado em</label>
        <input class="cozinha-input" type="datetime-local" value=${dataManipulacao} onInput=${(e) => { setDataManipulacao(e.target.value); setConfirmado(false); }} />
        <label class="cozinha-label">Tamanho da etiqueta</label>
        <select class="cozinha-select" value=${tamanhoChave} onChange=${(e) => setTamanhoChave(e.target.value)}>
          ${TAMANHOS.map((t) => html`<option value=${t.chave}>${t.rotulo}</option>`)}
        </select>
      </details>

      <button class="cozinha-botao-imprimir" disabled=${!podeImprimir} onClick=${imprimir}>IMPRIMIR ETIQUETA</button>
      ${!podeImprimir && html`<p class="cozinha-aviso">Escolha o insumo (ou digite o nome) e a regra de validade.</p>`}
      ${confirmado && html`<p class="cozinha-sucesso">✓ Etiqueta enviada pra impressora.</p>`}

      <div class="cozinha-preview"><${ConteudoEtiqueta} dados=${dados} tamanho=${tamanho} /></div>

      <style>${estiloImpressaoEtiqueta(tamanho)}</style>
      <div id="area-impressao-etiquetas">
        ${copias.map((_, i) => html`<div class="etiqueta-pagina" key=${i}><${ConteudoEtiqueta} dados=${dados} tamanho=${tamanho} /></div>`)}
      </div>
    </div>
  `;
}

function TelaVencendo({ itens, carregando }) {
  if (carregando) return html`<p class="vazio">Carregando…</p>`;
  const comStatus = itens.map((it) => ({ ...it, status: statusVencimento(it.data_validade) })).filter((it) => it.status.chave !== "ok");
  if (!comStatus.length) return html`<p class="cozinha-aviso" style="text-align:center; padding:30px 0;">Nada vencendo agora — tudo em dia.</p>`;
  return html`
    <div class="cozinha-lista-vencendo">
      ${comStatus.map((item) => html`
        <div class="cozinha-item-vencendo" key=${item.id}>
          <div class="cozinha-item-topo">
            <span>${item.nome}</span>
            <span class="chip ${item.status.chip}">${item.status.rotulo}</span>
          </div>
          <div class="cozinha-item-meta">Validade: ${formatarDataHora(item.data_validade)}${item.lote ? ` · Lote ${item.lote}` : ""}</div>
        </div>
      `)}
    </div>
  `;
}

export default function Cozinha({ funcionario, onSair }) {
  const [aba, setAba] = useState("imprimir");
  const [carregando, setCarregando] = useState(true);
  const [insumos, setInsumos] = useState([]);
  const [regras, setRegras] = useState([]);
  const [nomeEstabelecimento, setNomeEstabelecimento] = useState("");
  const [vencendo, setVencendo] = useState([]);

  async function carregar() {
    const desde = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
    const [insRes, regrasRes, estRes, vencRes] = await Promise.all([
      sb.rpc("insumo_para_cozinha"),
      sb.from("regra_validade").select("*").eq("ativo", true).order("nome"),
      sb.from("estabelecimento").select("nome,nome_fantasia").limit(1).maybeSingle(),
      sb.from("etiqueta_impressa").select("*").eq("tipo", "manipulacao").gte("data_validade", desde).order("data_validade", { ascending: true }).limit(300),
    ]);
    setInsumos((insRes.data || []).slice().sort((a, b) => a.nome.localeCompare(b.nome)));
    setRegras(regrasRes.data || []);
    setNomeEstabelecimento(estRes.data ? (estRes.data.nome_fantasia || estRes.data.nome || "") : "");
    setVencendo(vencRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);
  useEffect(() => {
    if (aba !== "vencendo") return;
    carregar();
  }, [aba]);

  const contagemVencendo = useMemo(
    () => vencendo.filter((it) => statusVencimento(it.data_validade).chave !== "ok").length,
    [vencendo]
  );

  return html`
    <div class="cozinha-shell">
      <div class="cozinha-topo">
        <div class="cozinha-titulo">${nomeEstabelecimento || "Serra Dourada"}<span>Cozinha</span></div>
        <div class="cozinha-topo-direita">
          <span class="cozinha-usuario">${funcionario.nome}</span>
          <button class="botao-secundario-pequeno" onClick=${onSair}>Sair</button>
        </div>
      </div>

      <div class="cozinha-tabs">
        <button class=${"cozinha-tab" + (aba === "imprimir" ? " ativo" : "")} onClick=${() => setAba("imprimir")}>Imprimir etiqueta</button>
        <button class=${"cozinha-tab" + (aba === "vencendo" ? " ativo" : "")} onClick=${() => setAba("vencendo")}>
          Vencendo ${contagemVencendo > 0 ? html`<span class="cozinha-badge">${contagemVencendo}</span>` : ""}
        </button>
        <button class=${"cozinha-tab" + (aba === "whatsapp" ? " ativo" : "")} onClick=${() => setAba("whatsapp")}>WhatsApp</button>
      </div>

      <div class="cozinha-conteudo">
        ${aba === "whatsapp"
          ? html`<${WhatsApp} />`
          : carregando
            ? html`<p class="vazio">Carregando…</p>`
            : aba === "imprimir"
              ? html`<${TelaImprimir} insumos=${insumos} regras=${regras} nomeEstabelecimento=${nomeEstabelecimento} funcionario=${funcionario} />`
              : html`<${TelaVencendo} itens=${vencendo} carregando=${false} />`}
      </div>

      <style>${CSS_ETIQUETA}</style>
      <style>
        .cozinha-shell { min-height: 100vh; max-width: 560px; margin: 0 auto; padding: 0 0 40px; }
        .cozinha-topo { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px; border-bottom: 1px solid var(--borda); }
        .cozinha-titulo { font-size: 1.1rem; font-weight: 700; color: var(--dourado-claro); }
        .cozinha-titulo span { display: block; font-size: 0.72rem; font-weight: 400; color: var(--texto-suave); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
        .cozinha-topo-direita { display: flex; align-items: center; gap: 10px; }
        .cozinha-usuario { font-size: 0.86rem; color: var(--texto-suave); }
        .cozinha-tabs { display: flex; gap: 8px; padding: 14px 16px 0; }
        .cozinha-tab { flex: 1; background: var(--marrom-card); border: 1px solid var(--borda); color: var(--texto-suave); padding: 14px 10px; border-radius: 12px; font-size: 0.95rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .cozinha-tab.ativo { background: var(--dourado); color: var(--marrom); border-color: transparent; }
        .cozinha-badge { background: var(--erro); color: #fff; font-size: 0.7rem; font-weight: 800; min-width: 18px; height: 18px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; }
        .cozinha-conteudo { padding: 18px 16px; }
        .cozinha-form { display: flex; flex-direction: column; }
        .cozinha-label { font-size: 0.9rem; color: var(--texto-suave); margin-bottom: 6px; }
        .cozinha-select, .cozinha-input {
          width: 100%; padding: 16px 14px; border-radius: 12px; border: 1px solid var(--borda);
          background: var(--fundo-input); color: var(--texto); font-size: 1.05rem; margin-bottom: 14px; font-family: inherit;
        }
        .cozinha-linha-dupla { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .cozinha-avancado { margin-bottom: 14px; }
        .cozinha-avancado summary { font-size: 0.82rem; color: var(--texto-suave); cursor: pointer; margin-bottom: 10px; }
        .cozinha-validade { font-size: 1rem; font-weight: 700; color: var(--sucesso); margin: -6px 0 14px; }
        .cozinha-botao-imprimir {
          width: 100%; padding: 20px; border-radius: 14px; background: var(--dourado); color: var(--marrom);
          font-weight: 800; font-size: 1.15rem; letter-spacing: 0.03em; border: none; cursor: pointer;
        }
        .cozinha-botao-imprimir:disabled { opacity: 0.4; cursor: default; }
        .cozinha-aviso { font-size: 0.82rem; color: var(--texto-suave); margin-top: 10px; text-align: center; }
        .cozinha-sucesso { font-size: 0.9rem; color: var(--sucesso); margin-top: 10px; text-align: center; font-weight: 700; }
        .cozinha-preview { display: flex; justify-content: center; margin-top: 22px; }
        .cozinha-lista-vencendo { display: flex; flex-direction: column; gap: 10px; }
        .cozinha-item-vencendo { background: var(--marrom-card); border: 1px solid var(--borda); border-radius: 12px; padding: 14px; }
        .cozinha-item-topo { display: flex; justify-content: space-between; align-items: center; font-size: 1rem; font-weight: 700; margin-bottom: 4px; }
        .cozinha-item-meta { font-size: 0.8rem; color: var(--texto-suave); }
      </style>
    </div>
  `;
}
