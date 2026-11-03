// Pedidos do WhatsApp em tempo real: quadro por status, impressão, pagamento e alertas.
// Toda ação passa pela função pedido-acao (permissões conferidas no banco e registradas no histórico).
import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useRef } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, SUPABASE_URL, ANON_KEY, formatarMoeda, formatarDataHora } from "../lib/supabase.js";

const html = htm.bind(h);

const COLUNAS = [
  { status: "confirmado", titulo: "Novos", dica: "Confirmados pelo cliente. Comanda já enviada para impressão.", acao: "em_preparo", rotuloAcao: "Iniciar preparo" },
  { status: "em_preparo", titulo: "Em preparo", dica: "Na cozinha, churrasqueira ou bar.", acao: "pronto", rotuloAcao: "Marcar como pronto" },
  { status: "pronto", titulo: "Prontos", dica: "Cliente avisado no WhatsApp.", acao: "finalizado", rotuloAcao: "Entregue / finalizar" },
];
const PAGAMENTO = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };
const IMPRESSAO = { pendente: "na fila", imprimindo: "imprimindo", impresso: "impresso", erro: "ERRO", cancelado: "cancelado" };

// Dois bipes curtos quando chega pedido novo (o navegador só toca depois de algum clique na página).
function bip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.15);
    });
  } catch (_) { /* sem som disponível */ }
}

const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
const minutosDesde = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

async function acao(corpo) {
  const sess = await sb.auth.getSession();
  const r = await fetch(SUPABASE_URL + "/functions/v1/pedido-acao", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.data?.session?.access_token, apikey: ANON_KEY },
    body: JSON.stringify(corpo),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "Não foi possível concluir a ação.");
  return out;
}

function CartaoPedido({ p, coluna, onAcao, ocupado }) {
  const atrasado = p.status !== "pronto" && minutosDesde(p.criado_em) >= 40;
  const jobs = p.impressao_job || [];
  const comErro = jobs.some((j) => j.status === "erro");
  return html`
    <div class="item-conta" style=${"display:flex; flex-direction:column; gap:8px;" + (atrasado ? "border-color:var(--alerta);" : "")}>
      <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
        <strong style="font-size:1.35rem; color:var(--dourado-claro);">#${String(p.numero).padStart(3, "0")}</strong>
        <span style="font-size:0.8rem; color:var(--texto-suave);">${hora(p.criado_em)} · ${p.modalidade === "entrega" ? "Entrega" : "Retirada"}${atrasado ? html` · <span style="color:var(--alerta); font-weight:700;">${minutosDesde(p.criado_em)} min</span>` : ""}</span>
      </div>
      <div style="font-weight:700;">${p.cliente_nome}</div>
      ${p.modalidade === "entrega" && html`<div style="font-size:0.82rem; color:var(--texto-suave);">📍 ${p.endereco}</div>`}
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${(p.pedido_item || []).map((i) => html`
          <div style="font-size:0.9rem;">
            <span style="font-weight:700;">${i.quantidade}x ${i.nome}</span>
            <span style="font-size:0.72rem; color:var(--texto-suave);"> · ${i.setor}</span>
            ${i.detalhe && html`<div style="font-size:0.8rem; color:var(--dourado-claro); margin-left:10px;">› ${i.detalhe}</div>`}
          </div>`)}
      </div>
      ${p.observacao && html`<div style="font-size:0.82rem; color:var(--alerta);">Obs.: ${p.observacao}</div>`}
      <div style="display:flex; justify-content:space-between; font-size:0.86rem; border-top:1px dashed var(--borda); padding-top:6px;">
        <span>${PAGAMENTO[p.pagamento]}${p.troco_para ? ` · troco p/ ${formatarMoeda(p.troco_para)}` : ""}
          ${p.pagamento === "pix" && html` · <span style=${"font-weight:700; color:" + (p.pagamento_status === "conferido" ? "var(--sucesso)" : "var(--alerta)")}>${p.pagamento_status === "conferido" ? "Pix conferido" : "Pix a conferir"}</span>`}
        </span>
        <strong>${formatarMoeda(p.total)}</strong>
      </div>
      <div style=${"font-size:0.75rem; color:" + (comErro ? "var(--erro)" : "var(--texto-suave)")}>
        🖨️ ${jobs.length ? jobs.map((j) => `${j.tipo === "comanda" ? "" : j.tipo + " "}${IMPRESSAO[j.status]}`).join(" · ") : "sem comanda"}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${coluna.acao && html`<button class="botao" style="flex:1 1 100%; padding:12px; font-size:0.95rem;" disabled=${ocupado} onClick=${() => onAcao({ acao: "status", pedido: p.id, para: coluna.acao })}>${coluna.rotuloAcao}</button>`}
        ${p.pagamento === "pix" && p.pagamento_status !== "conferido" && html`<button class="botao-secundario-pequeno" disabled=${ocupado} onClick=${() => confirm(`Confirma que o Pix de ${formatarMoeda(p.total)} do pedido #${p.numero} caiu na conta?`) && onAcao({ acao: "pagamento", pedido: p.id, status: "conferido" })}>Pix conferido</button>`}
        <button class="botao-secundario-pequeno" disabled=${ocupado} onClick=${() => onAcao({ acao: "reimprimir", pedido: p.id })}>Reimprimir</button>
        <button class="botao-secundario-pequeno" style="color:var(--erro); border-color:var(--erro);" disabled=${ocupado} onClick=${() => {
          const motivo = prompt(`Motivo do cancelamento do pedido #${p.numero}:`);
          if (motivo && motivo.trim() && confirm(`Cancelar o pedido #${p.numero}? O cliente será avisado e a cozinha recebe uma comanda de cancelamento.`)) onAcao({ acao: "cancelar", pedido: p.id, motivo: motivo.trim() });
        }}>Cancelar</button>
      </div>
    </div>
  `;
}

function Alertas({ impressoras, jobsErro, aguardando, onDevolver }) {
  const itens = [];
  const agora = Date.now();
  impressoras.filter((i) => i.ativo).forEach((i) => {
    if (!i.ultimo_contato || agora - new Date(i.ultimo_contato).getTime() > 90000)
      itens.push({ cor: "var(--erro)", texto: `Agente de impressão sem sinal (${i.nome}). Confira se o PC do caixa está ligado e o programa aberto.` });
    else if (i.ultimo_erro) itens.push({ cor: "var(--alerta)", texto: `Impressora ${i.nome}: ${i.ultimo_erro}. As comandas ficam na fila até ela voltar.` });
  });
  if (jobsErro.length) itens.push({ cor: "var(--erro)", texto: `${jobsErro.length} comanda(s) não impressa(s): ${[...new Set(jobsErro.map((j) => j.erro || "erro"))].join("; ")}` });
  if (!itens.length && !aguardando.length) return null;
  return html`
    <div class="card" style="display:flex; flex-direction:column; gap:8px;">
      ${itens.map((a) => html`<div style=${"font-size:0.88rem; color:" + a.cor}>⚠️ ${a.texto}</div>`)}
      ${aguardando.map((c) => html`
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:0.88rem;">
          <span style="color:var(--dourado-claro);">🙋 Cliente ${c.telefone} pediu atendimento há ${minutosDesde(c.aguardando_humano_desde)} min (o robô está em silêncio nessa conversa).</span>
          <span style="display:flex; gap:6px;">
            <a class="botao-secundario-pequeno" href="#/whatsapp">Abrir conversa</a>
            <button class="botao-secundario-pequeno" onClick=${() => onDevolver(c.id)}>Devolver ao robô</button>
          </span>
        </div>`)}
    </div>
  `;
}

export default function Pedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [encerrados, setEncerrados] = useState({ finalizado: 0, cancelado: 0 });
  const [impressoras, setImpressoras] = useState([]);
  const [jobsErro, setJobsErro] = useState([]);
  const [aguardando, setAguardando] = useState([]);
  const [config, setConfig] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const tocou = useRef(new Set());

  async function carregar() {
    const desde = new Date(Date.now() - 18 * 3600000).toISOString();
    const [pRes, eRes, iRes, jRes, cRes, cfgRes] = await Promise.all([
      sb.from("pedido").select("*, pedido_item(nome, quantidade, setor, detalhe), impressao_job(tipo, status, erro)").in("status", ["confirmado", "em_preparo", "pronto"]).gte("criado_em", desde).order("criado_em"),
      sb.from("pedido").select("status").in("status", ["finalizado", "cancelado"]).gte("criado_em", desde),
      sb.from("impressora").select("*").order("nome"),
      sb.from("impressao_job").select("id, erro, pedido_id").eq("status", "erro").gte("criado_em", desde),
      sb.from("whatsapp_conversa").select("id, telefone, aguardando_humano_desde").not("aguardando_humano_desde", "is", null).order("aguardando_humano_desde"),
      sb.from("pedido_config").select("aceitando_pedidos").maybeSingle(),
    ]);
    if (pRes.error) setErro("Não foi possível carregar os pedidos: " + pRes.error.message);
    const lista = pRes.data || [];
    // aviso sonoro para pedido novo
    const novos = lista.filter((p) => p.status === "confirmado" && !tocou.current.has(p.id));
    if (novos.length && tocou.current.size) bip(); // não toca na primeira carga da tela
    novos.forEach((p) => tocou.current.add(p.id));
    if (!tocou.current.size) tocou.current.add("carregou");
    setPedidos(lista);
    const enc = { finalizado: 0, cancelado: 0 };
    (eRes.data || []).forEach((r) => (enc[r.status] += 1));
    setEncerrados(enc);
    setImpressoras(iRes.data || []);
    setJobsErro(jRes.data || []);
    setAguardando(cRes.data || []);
    setConfig(cfgRes.data);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // tempo real: qualquer mudança em pedido ou impressão atualiza a tela; e um "seguro" a cada 20 s
    const canal = sb.channel("painel-pedidos")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido" }, () => carregar())
      .on("postgres_changes", { event: "*", schema: "public", table: "impressao_job" }, () => carregar())
      .subscribe();
    const t = setInterval(carregar, 20000);
    return () => { clearInterval(t); sb.removeChannel(canal); };
  }, []);

  async function executar(corpo) {
    setErro(""); setAviso(""); setOcupado(true);
    try {
      const out = await acao(corpo);
      if (corpo.acao === "reimprimir") setAviso("Reimpressão enviada para a fila.");
      if (out.aviso_cliente === "enviado") setAviso("Cliente avisado no WhatsApp.");
      if (out.aviso_cliente === "falhou") setErro("Status salvo, mas o aviso ao cliente falhou. Avise manualmente.");
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return html`
    <div>
      <h2>Pedidos do WhatsApp</h2>
      <p class="desc">
        ${config?.aceitando_pedidos ? html`<span class="chip" style="background:var(--sucesso); color:#08200f;">Recebendo pedidos</span>` : html`<span class="chip" style="background:var(--erro); color:#fff;">Pedidos desligados</span>`}
        ${" "}Hoje: ${encerrados.finalizado} finalizado(s), ${encerrados.cancelado} cancelado(s). Valores são pedidos registrados — não pagamentos recebidos.
      </p>
      ${erro && html`<div class="msg-erro" style="font-size:0.9rem; margin-bottom:10px;">${erro}</div>`}
      ${aviso && html`<div style="color:var(--sucesso); font-size:0.9rem; margin-bottom:10px;">${aviso}</div>`}
      <${Alertas} impressoras=${impressoras} jobsErro=${jobsErro} aguardando=${aguardando} onDevolver=${(id) => executar({ acao: "devolver_conversa", conversa: id })} />
      ${carregando
        ? html`<p class="vazio">Carregando…</p>`
        : html`
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px; align-items:start;">
            ${COLUNAS.map((c) => {
              const daColuna = pedidos.filter((p) => p.status === c.status);
              return html`
                <div class="card" style="display:flex; flex-direction:column; gap:10px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0;">${c.titulo}</h3>
                    <span class="chip" style="background:var(--fundo-input); color:var(--texto);">${daColuna.length}</span>
                  </div>
                  <div class="vazio" style="font-size:0.78rem;">${c.dica}</div>
                  ${daColuna.length ? daColuna.map((p) => html`<${CartaoPedido} key=${p.id} p=${p} coluna=${c} onAcao=${executar} ocupado=${ocupado} />`) : html`<p class="vazio">Nenhum pedido aqui.</p>`}
                </div>`;
            })}
          </div>`}
    </div>
  `;
}
