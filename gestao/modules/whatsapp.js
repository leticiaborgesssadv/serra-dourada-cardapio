import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useRef } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, SUPABASE_URL, ANON_KEY, formatarDataHora } from "../lib/supabase.js";

const html = htm.bind(h);

const INTERVALO_ATUALIZACAO_MS = 20000;

const ROTULO_INTENCAO = {
  cardapio: "Cardápio",
  horario: "Horário",
  horario_almoco: "Horário do almoço",
  endereco: "Endereço",
  happy_hour: "Happy hour",
  reserva: "Reserva",
  atendente: "Pediu atendente",
  elogio: "Elogio",
  avaliacao: "Avaliação",
  prato: "Consulta de prato",
  reclamacao: "Reclamação",
  gerente: "Pediu gerente",
  vagas: "Vaga de emprego",
  fornecedor: "Fornecedor",
  parceria: "Parceria/divulgação",
  nota_fiscal: "Nota fiscal",
  fallback: "Não identificado",
};

function formatarTelefone(t) {
  const d = (t || "").replace(/\D/g, "");
  if (d.length < 12) return t;
  const ddi = d.slice(0, 2), ddd = d.slice(2, 4), resto = d.slice(4);
  const meio = resto.length > 4 ? resto.slice(0, resto.length - 4) : resto;
  const fim = resto.length > 4 ? resto.slice(-4) : "";
  return `+${ddi} ${ddd} ${meio}${fim ? "-" + fim : ""}`;
}

function ListaConversas({ conversas, selecionadaId, onSelecionar }) {
  if (!conversas.length) return html`<p class="vazio">Nenhuma conversa ainda.</p>`;
  return html`
    <div class="lista-contas">
      ${conversas.map((c) => html`
        <div
          key=${c.id}
          class="item-conta"
          style=${"cursor:pointer;" + (c.id === selecionadaId ? "border-color:var(--dourado);" : "")}
          onClick=${() => onSelecionar(c.id)}
        >
          <div class="item-conta-topo"><span class="item-conta-desc">${formatarTelefone(c.telefone)}</span></div>
          <div class="item-conta-meta">Última atividade: ${formatarDataHora(c.atualizado_em)}</div>
          ${c.aguardando_humano_desde && html`<div style="font-size:0.75rem; color:var(--alerta); font-weight:700;">🙋 Pediu atendimento</div>`}
        </div>
      `)}
    </div>
  `;
}

// Robô x pessoa: quando a equipe assume, o robô fica em silêncio nessa conversa.
async function acaoConversa(acao, conversaId) {
  const sess = await sb.auth.getSession();
  const r = await fetch(SUPABASE_URL + "/functions/v1/pedido-acao", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.data?.session?.access_token, apikey: ANON_KEY },
    body: JSON.stringify({ acao, conversa: conversaId, minutos: 60 }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "Não foi possível concluir.");
}

function Thread({ conversaId, telefone, humanoAte, onMudou }) {
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const fimRef = useRef(null);
  const humanoAtivo = humanoAte && new Date(humanoAte).getTime() > Date.now();

  async function alternarRobo() {
    setErro("");
    try {
      await acaoConversa(humanoAtivo ? "devolver_conversa" : "assumir_conversa", conversaId);
      onMudou && onMudou();
    } catch (e) {
      setErro(e.message);
    }
  }

  async function carregar() {
    const r = await sb.from("whatsapp_mensagem").select("id,direcao,conteudo,intencao,criado_em").eq("conversa_id", conversaId).order("criado_em", { ascending: true });
    setMensagens(r.data || []);
  }

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(t);
  }, [conversaId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  async function enviar(ev) {
    ev.preventDefault();
    if (!texto.trim()) return;
    setErro("");
    setEnviando(true);
    try {
      const sess = await sb.auth.getSession();
      const token = sess.data?.session?.access_token;
      const resp = await fetch(SUPABASE_URL + "/functions/v1/whatsapp-enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: ANON_KEY },
        body: JSON.stringify({ conversa_id: conversaId, texto: texto.trim() }),
      });
      const out = await resp.json();
      if (!resp.ok) { setErro(out.error || "Não foi possível enviar."); return; }
      setTexto("");
      carregar();
    } catch (e) {
      setErro("Erro de conexão.");
    } finally {
      setEnviando(false);
    }
  }

  return html`
    <div class="card" style="display:flex; flex-direction:column; height:70vh;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <h3 style="margin:0;">${formatarTelefone(telefone)}</h3>
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="chip" style=${humanoAtivo ? "background:var(--alerta); color:#241608;" : "background:var(--fundo-input); color:var(--texto-suave);"}>
            ${humanoAtivo ? "Atendimento humano (robô em silêncio)" : "Robô respondendo"}
          </span>
          <button class="botao-secundario-pequeno" onClick=${alternarRobo}>${humanoAtivo ? "Devolver ao robô" : "Assumir conversa"}</button>
        </span>
      </div>
      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:4px 0;">
        ${mensagens.map((m) => html`
          <div key=${m.id} style=${"max-width:75%; padding:8px 12px; border-radius:10px;" + (m.direcao === "entrada" ? "align-self:flex-start; background:var(--marrom-claro,#3a2712); color:#f6ead0;" : "align-self:flex-end; background:var(--dourado,#c9a227); color:#241608;")}>
            <div style="white-space:pre-wrap;">${m.conteudo}</div>
            <div style="font-size:0.72rem; opacity:0.75; margin-top:4px;">
              ${formatarDataHora(m.criado_em)}${m.direcao === "entrada" && m.intencao ? " · " + (ROTULO_INTENCAO[m.intencao] || m.intencao) : ""}
            </div>
          </div>
        `)}
        <div ref=${fimRef}></div>
      </div>
      <form onSubmit=${enviar} style="display:flex; gap:8px; margin-top:10px;">
        <input type="text" value=${texto} onInput=${(e) => setTexto(e.target.value)} placeholder="Escrever mensagem…" style="flex:1;" />
        <button class="botao" type="submit" disabled=${enviando || !texto.trim()}>${enviando ? "Enviando…" : "Enviar"}</button>
      </form>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </div>
  `;
}

export default function WhatsApp() {
  const [conversas, setConversas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionadaId, setSelecionadaId] = useState(null);

  async function carregarConversas() {
    const r = await sb.from("whatsapp_conversa").select("id,telefone,atualizado_em,atendimento_humano_ate,aguardando_humano_desde").order("atualizado_em", { ascending: false });
    setConversas(r.data || []);
    setCarregando(false);
  }

  useEffect(() => {
    carregarConversas();
    const t = setInterval(carregarConversas, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(t);
  }, []);

  const selecionada = conversas.find((c) => c.id === selecionadaId) || null;

  return html`
    <div>
      <h2>WhatsApp</h2>
      <p class="desc">Conversas do agente automático. Responda direto por aqui — a mensagem sai pelo mesmo número do WhatsApp do restaurante.</p>
      <div class="colunas-financeiro">
        <div>
          <h3 class="titulo-lista">Conversas</h3>
          ${carregando ? html`<p class="vazio">Carregando…</p>` : html`<${ListaConversas} conversas=${conversas} selecionadaId=${selecionadaId} onSelecionar=${setSelecionadaId} />`}
        </div>
        <div>
          ${selecionada
            ? html`<${Thread} conversaId=${selecionada.id} telefone=${selecionada.telefone} humanoAte=${selecionada.atendimento_humano_ate} onMudou=${carregarConversas} key=${selecionada.id} />`
            : html`<p class="vazio">Selecione uma conversa à esquerda.</p>`}
        </div>
      </div>
    </div>
  `;
}
