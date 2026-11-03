// Triagem da gestão (só gerência): fornecedores, currículos, artistas, parcerias, reclamações,
// reservas especiais. Cada assunto tem protocolo, prioridade, responsável e histórico.
// O aviso ao WhatsApp da gestão leva só protocolo, assunto e prioridade — nunca dados do cliente.
import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useRef } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, SUPABASE_URL, ANON_KEY, getEstabelecimentoId, formatarDataHora } from "../lib/supabase.js";

const html = htm.bind(h);

const campo = "width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--borda); background:var(--fundo-input); color:var(--texto); font-size:0.95rem; font-family:inherit;";
const rotulo = "display:block; font-size:0.8rem; color:var(--texto-suave); margin:10px 0 4px;";

const CATEGORIA = {
  reclamacao: "Reclamação", gerente: "Falar com a gerência", curriculo: "Currículo", fornecedor: "Fornecedor",
  artista: "Artista / música", parceria: "Parceria / divulgação", nota_fiscal: "Nota fiscal", reserva_especial: "Reserva especial", outro: "Outro assunto",
};
const PRIORIDADE = {
  urgente: { txt: "URGENTE", cor: "var(--erro)", ordem: 0 },
  alta: { txt: "Alta", cor: "var(--alerta)", ordem: 1 },
  normal: { txt: "Normal", cor: "var(--texto)", ordem: 2 },
  baixa: { txt: "Baixa", cor: "var(--texto-suave)", ordem: 3 },
};
const STATUS = { novo: "Novo", em_andamento: "Em andamento", aguardando_cliente: "Aguardando cliente", resolvido: "Resolvido", arquivado: "Arquivado" };
const ABERTOS = ["novo", "em_andamento", "aguardando_cliente"];
const AVISO = { pendente: "aviso à gestão pendente", enviado: "gestão avisada ✓", falhou: "aviso à gestão FALHOU", nao_configurado: "aviso automático não configurado", nao_necessario: "" };

// o banco guarda as respostas sem ordem; aqui elas voltam na ordem em que o robô pergunta
const ORDEM_CAMPOS = ["O que aconteceu", "Quando", "Assunto", "Nome", "Função desejada", "Experiência", "Empresa", "Produtos ou serviços", "Contato",
  "Artista e estilo", "Link / material", "Formação e cachê", "Empresa ou perfil", "Proposta", "Compra", "Dados para a nota", "Reserva", "Ocasião"];
const ordenarCampos = (dados) => Object.entries(dados || {}).sort(([a], [b]) => {
  const ia = ORDEM_CAMPOS.indexOf(a), ib = ORDEM_CAMPOS.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

const tempo = (iso) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} dia(s)`;
};

async function acao(corpo) {
  const sess = await sb.auth.getSession();
  const r = await fetch(SUPABASE_URL + "/functions/v1/gestao-acao", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.data?.session?.access_token, apikey: ANON_KEY },
    body: JSON.stringify(corpo),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "Não foi possível concluir a ação.");
  return out;
}

// Link wa.me para a equipe encaminhar à gestão pelo próprio WhatsApp. Só protocolo, assunto e prioridade.
function linkGestao(cfg, a) {
  if (!cfg?.telefone_gestao) return null;
  const txt = `Atendimento ${a.protocolo} · ${CATEGORIA[a.categoria]} · prioridade ${PRIORIDADE[a.prioridade].txt}. Detalhes no painel (Triagem).`;
  return `https://wa.me/${cfg.telefone_gestao}?text=${encodeURIComponent(txt)}`;
}

function Detalhe({ a, cfg, onMudou }) {
  const [eventos, setEventos] = useState([]);
  const [anexos, setAnexos] = useState([]);
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    const [e, x] = await Promise.all([
      sb.from("atendimento_adm_evento").select("*, funcionario(nome)").eq("atendimento_id", a.id).order("criado_em"),
      sb.from("atendimento_adm_anexo").select("*").eq("atendimento_id", a.id).order("criado_em"),
    ]);
    setEventos(e.data || []);
    setAnexos(x.data || []);
  }
  useEffect(() => { carregar(); }, [a.id, a.atualizado_em]);

  async function atualizar(params, texto) {
    setMsg(""); setOcupado(true);
    const r = await sb.rpc("atualizar_atendimento_adm", { p_id: a.id, ...params });
    setOcupado(false);
    if (r.error) { setMsg("❌ " + r.error.message); return; }
    setMsg("✅ " + texto);
    onMudou();
    carregar();
  }

  async function reenviar() {
    setMsg(""); setOcupado(true);
    try {
      const out = await acao({ acao: "atendimento_reenviar_aviso", atendimento: a.id });
      setMsg(out.aviso_gestao === "enviado" ? "✅ Gestão avisada no WhatsApp." : out.aviso_gestao === "nao_configurado"
        ? "⚠️ Aviso automático não configurado (falta a mensagem modelo aprovada pela Meta ou o número da gestão). Use o botão de encaminhar."
        : "❌ O aviso falhou: " + (out.erro || ""));
      onMudou(); carregar();
    } catch (e) { setMsg("❌ " + e.message); } finally { setOcupado(false); }
  }

  async function abrirAnexo(x) {
    const r = await sb.storage.from("triagem").createSignedUrl(x.storage_path, 120);
    if (r.error) { setMsg("❌ Não foi possível abrir o arquivo: " + r.error.message); return; }
    window.open(r.data.signedUrl, "_blank", "noopener");
  }

  const wa = linkGestao(cfg, a);
  const descrever = (e) => {
    const quem = e.funcionario?.nome || (e.ator === "cliente" ? "Cliente (WhatsApp)" : e.ator === "robo" ? "Robô" : "Equipe");
    const txt = {
      criado: `abriu o atendimento (prioridade ${PRIORIDADE[e.para]?.txt || e.para})`,
      status: `mudou de "${STATUS[e.de] || e.de}" para "${STATUS[e.para] || e.para}"`,
      prioridade: `mudou a prioridade de ${PRIORIDADE[e.de]?.txt || e.de} para ${PRIORIDADE[e.para]?.txt || e.para}`,
      responsavel: "assumiu o atendimento",
      nota: `anotou: ${e.texto}`,
      aviso_gestao: `aviso à gestão: ${AVISO[e.para] || e.para}${e.texto ? " (" + e.texto + ")" : ""}`,
      anexo: "anexou um arquivo",
    }[e.tipo] || e.tipo;
    return `${quem} ${txt}`;
  };

  return html`
    <div style="border-top:1px dashed var(--borda); margin-top:8px; padding-top:10px; display:flex; flex-direction:column; gap:10px;">
      <div style="display:grid; grid-template-columns:minmax(120px, max-content) 1fr; gap:4px 12px; font-size:0.9rem;">
        <span style="color:var(--texto-suave);">Contato</span><span>${a.nome || "—"}${a.telefone ? " · " + a.telefone : ""}</span>
        ${ordenarCampos(a.dados).map(([k, v]) => html`<span style="color:var(--texto-suave);">${k}</span><span style="white-space:pre-wrap;">${String(v)}</span>`)}
      </div>
      ${anexos.length > 0 && html`
        <div style="font-size:0.88rem;">
          <strong>Arquivos</strong>
          ${anexos.map((x) => html`<div>📎 ${x.nome_arquivo} ·
            ${x.status === "salvo" ? html`<a href="#" onClick=${(ev) => { ev.preventDefault(); abrirAnexo(x); }} style="color:var(--dourado-claro);">abrir</a>`
              : x.status === "falhou" ? html`<span style="color:var(--erro);">não foi possível baixar da Meta</span>`
              : html`<span style="color:var(--texto-suave);">aguardando download (precisa do token da Meta)</span>`}</div>`)}
        </div>`}
      <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
        ${!a.responsavel_id && html`<button class="botao" style="width:auto; padding:9px 16px;" disabled=${ocupado} onClick=${() => atualizar({ p_assumir: true }, "Você assumiu este atendimento.")}>Assumir</button>`}
        <select style=${campo + " width:auto;"} value=${a.status} disabled=${ocupado} onChange=${(e) => atualizar({ p_status: e.target.value }, "Situação atualizada.")}>
          ${Object.entries(STATUS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
        </select>
        <select style=${campo + " width:auto;"} value=${a.prioridade} disabled=${ocupado} onChange=${(e) => atualizar({ p_prioridade: e.target.value }, "Prioridade atualizada.")}>
          ${Object.entries(PRIORIDADE).map(([k, v]) => html`<option value=${k}>Prioridade: ${v.txt}</option>`)}
        </select>
        ${a.conversa_id && html`<a class="botao-secundario-pequeno" href="#/whatsapp">Responder no WhatsApp</a>`}
        ${wa && html`<a class="botao-secundario-pequeno" href=${wa} target="_blank" rel="noopener">Encaminhar à gestão (WhatsApp)</a>`}
        ${["pendente", "falhou", "nao_configurado"].includes(a.aviso_gestao) && html`<button class="botao-secundario-pequeno" disabled=${ocupado} onClick=${reenviar}>Tentar aviso automático</button>`}
      </div>
      <div style="display:flex; gap:6px;">
        <input style=${campo} value=${nota} onInput=${(e) => setNota(e.target.value)} placeholder="Anotação interna (o cliente não vê)" />
        <button class="botao-secundario-pequeno" disabled=${ocupado || !nota.trim()} onClick=${() => { atualizar({ p_nota: nota }, "Anotação salva."); setNota(""); }}>Anotar</button>
      </div>
      ${msg && html`<div style="font-size:0.85rem;">${msg}</div>`}
      <div style="font-size:0.8rem; color:var(--texto-suave); display:flex; flex-direction:column; gap:2px;">
        <strong style="color:var(--texto);">Histórico</strong>
        ${eventos.map((e) => html`<div>${formatarDataHora(e.criado_em)} — ${descrever(e)}</div>`)}
      </div>
    </div>`;
}

function Configuracao({ estab, cfg, onSalvo }) {
  const [c, setC] = useState({ telefone_gestao: cfg?.telefone_gestao || "", modelo_aviso: cfg?.modelo_aviso || "", modelo_idioma: cfg?.modelo_idioma || "pt_BR", avisar_prioridades: cfg?.avisar_prioridades || ["alta", "urgente"] });
  const [msg, setMsg] = useState("");
  const alterna = (p) => setC({ ...c, avisar_prioridades: c.avisar_prioridades.includes(p) ? c.avisar_prioridades.filter((x) => x !== p) : [...c.avisar_prioridades, p] });

  async function salvar() {
    setMsg("");
    let tel = c.telefone_gestao.replace(/\D/g, "");
    if (tel && tel.length <= 11) tel = "55" + tel;
    if (tel && !/^\d{12,13}$/.test(tel)) { setMsg("❌ Telefone inválido. Use DDD + número, ex.: 62 98274-3552."); return; }
    const r = await sb.from("triagem_config").upsert({
      estabelecimento_id: estab, telefone_gestao: tel || null, modelo_aviso: c.modelo_aviso.trim() || null,
      modelo_idioma: c.modelo_idioma.trim() || "pt_BR", avisar_prioridades: c.avisar_prioridades, atualizado_em: new Date().toISOString(),
    }, { onConflict: "estabelecimento_id" });
    setMsg(r.error ? "❌ " + r.error.message : "✅ Configuração salva.");
    if (!r.error) onSalvo();
  }

  return html`
    <div class="card">
      <h3 style="margin-top:0;">Aviso à gestão</h3>
      <div class="vazio" style="font-size:0.8rem;">
        O número da gestão nunca é mostrado ao cliente. O aviso automático usa uma <strong>mensagem modelo aprovada pela Meta</strong>
        (sem ela, a Meta não deixa o robô iniciar conversa). Texto sugerido para cadastrar na Meta, categoria "Utilidade":
        <em>"Novo atendimento {{1}} · {{2}} · prioridade {{3}}. Veja os detalhes no painel."</em>
        Enquanto o modelo não for aprovado, use o botão "Encaminhar à gestão" de cada atendimento.
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0 14px;">
        <label><span style=${rotulo}>WhatsApp da gestão</span><input style=${campo} value=${c.telefone_gestao} onInput=${(e) => setC({ ...c, telefone_gestao: e.target.value })} placeholder="62 98274-3552" /></label>
        <label><span style=${rotulo}>Nome da mensagem modelo (Meta)</span><input style=${campo} value=${c.modelo_aviso} onInput=${(e) => setC({ ...c, modelo_aviso: e.target.value })} placeholder="ex.: aviso_triagem" /></label>
        <label><span style=${rotulo}>Idioma do modelo</span><input style=${campo} value=${c.modelo_idioma} onInput=${(e) => setC({ ...c, modelo_idioma: e.target.value })} /></label>
      </div>
      <span style=${rotulo}>Avisar automaticamente quando a prioridade for</span>
      <div style="display:flex; gap:14px; flex-wrap:wrap;">
        ${Object.entries(PRIORIDADE).map(([k, v]) => html`<label><input type="checkbox" checked=${c.avisar_prioridades.includes(k)} onChange=${() => alterna(k)} /> ${v.txt}</label>`)}
      </div>
      <button class="botao" style="margin-top:12px; width:auto; padding:10px 20px;" onClick=${salvar}>Salvar</button>
      ${msg && html`<div style="font-size:0.85rem; margin-top:6px;">${msg}</div>`}
    </div>`;
}

export default function Triagem() {
  const [estab, setEstab] = useState(null);
  const [lista, setLista] = useState([]);
  const [cfg, setCfg] = useState(undefined);
  const [filtro, setFiltro] = useState("abertos");
  const [categoria, setCategoria] = useState("");
  const [aberto, setAberto] = useState(null);
  const [verConfig, setVerConfig] = useState(false);
  const [erro, setErro] = useState("");
  const filtros = useRef({ filtro, categoria }); // o tempo real usa sempre os filtros que estão na tela

  async function carregar() {
    const f = filtros.current;
    let q = sb.from("atendimento_adm").select("*, funcionario:responsavel_id(nome)").order("criado_em", { ascending: false }).limit(200);
    if (f.filtro === "abertos") q = q.in("status", ABERTOS);
    if (f.filtro === "fechados") q = q.in("status", ["resolvido", "arquivado"]);
    if (f.categoria) q = q.eq("categoria", f.categoria);
    const [a, c] = await Promise.all([q, sb.from("triagem_config").select("*").maybeSingle()]);
    if (a.error) setErro("Não foi possível carregar a triagem: " + a.error.message);
    const ordenada = (a.data || []).sort((x, y) => {
      const abertoX = ABERTOS.includes(x.status) ? 0 : 1;
      const abertoY = ABERTOS.includes(y.status) ? 0 : 1;
      return abertoX - abertoY || PRIORIDADE[x.prioridade].ordem - PRIORIDADE[y.prioridade].ordem || new Date(x.criado_em) - new Date(y.criado_em);
    });
    setLista(ordenada);
    setCfg(c.data || null);
  }

  useEffect(() => {
    getEstabelecimentoId().then(setEstab);
    const canal = sb.channel("painel-triagem").on("postgres_changes", { event: "*", schema: "public", table: "atendimento_adm" }, () => carregar()).subscribe();
    const t = setInterval(carregar, 60000);
    return () => { clearInterval(t); sb.removeChannel(canal); };
  }, []);
  useEffect(() => { filtros.current = { filtro, categoria }; carregar(); }, [filtro, categoria]);

  const urgentes = lista.filter((a) => ABERTOS.includes(a.status) && a.prioridade === "urgente").length;

  return html`
    <div>
      <h2>Triagem da gestão</h2>
      <p class="desc">Assuntos que o robô separou para a gestão. Cada um tem protocolo, prioridade e histórico. ${urgentes > 0 && html`<span class="chip" style="background:var(--erro); color:#fff;">${urgentes} urgente(s)</span>`}</p>
      ${erro && html`<div class="msg-erro" style="margin-bottom:10px;">${erro}</div>`}
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center;">
        ${[["abertos", "Abertos"], ["fechados", "Resolvidos"], ["todos", "Todos"]].map(([k, v]) => html`
          <button class=${filtro === k ? "botao" : "botao-secundario"} style="width:auto; padding:8px 14px;" onClick=${() => setFiltro(k)}>${v}</button>`)}
        <select style=${campo + " width:auto;"} value=${categoria} onChange=${(e) => setCategoria(e.target.value)}>
          <option value="">Todos os assuntos</option>
          ${Object.entries(CATEGORIA).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
        </select>
        <button class="botao-secundario" style="width:auto;" onClick=${() => setVerConfig(!verConfig)}>${verConfig ? "Fechar configuração" : "⚙️ Aviso à gestão"}</button>
      </div>
      ${verConfig && estab && cfg !== undefined && html`<${Configuracao} estab=${estab} cfg=${cfg} onSalvo=${carregar} />`}
      ${lista.length === 0 ? html`<p class="vazio">Nada por aqui.</p>` : html`
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${lista.map((a) => {
            const p = PRIORIDADE[a.prioridade];
            return html`
              <div class="item-conta" key=${a.id} style=${a.prioridade === "urgente" && ABERTOS.includes(a.status) ? "border-color:var(--erro);" : ""}>
                <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; cursor:pointer;" onClick=${() => setAberto(aberto === a.id ? null : a.id)}>
                  <div>
                    <strong>${CATEGORIA[a.categoria]}</strong>
                    <span style="color:var(--texto-suave); font-size:0.8rem;"> · ${a.protocolo} · ${tempo(a.criado_em)}</span>
                    <div style="font-size:0.88rem; margin-top:2px;">${a.nome || "Sem nome"}${a.resumo ? " — " + a.resumo : ""}</div>
                    <div style="font-size:0.75rem; color:var(--texto-suave);">
                      ${STATUS[a.status]}${a.funcionario?.nome ? " · com " + a.funcionario.nome : ""}${AVISO[a.aviso_gestao] ? " · " + AVISO[a.aviso_gestao] : ""}
                    </div>
                  </div>
                  <span class="chip" style=${"background:transparent; border:1px solid " + p.cor + "; color:" + p.cor + "; height:fit-content;"}>${p.txt}</span>
                </div>
                ${aberto === a.id && html`<${Detalhe} a=${a} cfg=${cfg} onMudou=${carregar} />`}
              </div>`;
          })}
        </div>`}
    </div>
  `;
}
