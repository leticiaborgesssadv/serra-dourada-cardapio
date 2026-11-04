// Reservas: pedidos do WhatsApp, do site e do balcão num lugar só. A equipe confirma, recusa,
// põe na lista de espera e marca presença. Quem pediu pelo WhatsApp é avisado na mesma conversa.
// Toda ação passa pela função gestao-acao (permissão conferida no banco e registrada no histórico).
import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useRef } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, SUPABASE_URL, ANON_KEY, getEstabelecimentoId, hojeISO } from "../lib/supabase.js";

const html = htm.bind(h);

const campo = "width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--borda); background:var(--fundo-input); color:var(--texto); font-size:0.95rem; font-family:inherit;";
const rotulo = "display:block; font-size:0.8rem; color:var(--texto-suave); margin:10px 0 4px;";

const STATUS = {
  pendente: { txt: "Aguardando resposta", cor: "var(--alerta)" },
  confirmada: { txt: "Confirmada", cor: "var(--sucesso)" },
  lista_espera: { txt: "Lista de espera", cor: "#8ab4f8" },
  recusada: { txt: "Recusada", cor: "var(--texto-suave)" },
  cancelada: { txt: "Cancelada", cor: "var(--texto-suave)" },
  compareceu: { txt: "Compareceu", cor: "var(--sucesso)" },
  nao_compareceu: { txt: "Não compareceu", cor: "var(--erro)" },
};
const ORIGEM = { whatsapp: "WhatsApp", site: "Site", painel: "Balcão/telefone" };
const TURNO = { almoco: "Almoço", noite: "Noite (bar)" };
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const somarDias = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dataCurta = (iso) => { const d = new Date(iso + "T12:00:00"); return `${DIAS[d.getDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };
const hora = (t) => (t ? String(t).slice(0, 5) : "sem horário");

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

function Chip({ status }) {
  const s = STATUS[status] || { txt: status, cor: "var(--texto-suave)" };
  return html`<span class="chip" style=${"background:transparent; border:1px solid " + s.cor + "; color:" + s.cor + ";"}>${s.txt}</span>`;
}

function LinhaReserva({ r, onAcao, ocupado, mostrarData }) {
  const hoje = hojeISO();
  const pedirMotivo = (decisao, pergunta) => {
    const m = prompt(pergunta);
    if (m && m.trim()) onAcao(r, decisao, m.trim());
  };
  return html`
    <div class="item-conta" style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap;">
        <strong style="font-size:1.05rem;">${mostrarData ? dataCurta(r.data) + " · " : ""}${hora(r.horario)} · ${r.cliente_nome} · ${r.pessoas} pessoa(s)</strong>
        <${Chip} status=${r.status} />
      </div>
      <div style="font-size:0.8rem; color:var(--texto-suave);">
        ${r.protocolo} · ${ORIGEM[r.origem] || r.origem}${r.cliente_telefone ? " · " + r.cliente_telefone : ""}${r.turno ? "" : " · fora do horário de funcionamento"}
        ${r.atendimento_id && html` · <a href="#/triagem" style="color:var(--dourado-claro);">reserva especial (ver triagem)</a>`}
      </div>
      ${r.observacao && html`<div style="font-size:0.85rem; color:var(--dourado-claro);">💬 ${r.observacao}</div>`}
      ${r.motivo && html`<div style="font-size:0.8rem; color:var(--texto-suave);">Motivo: ${r.motivo}</div>`}
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${["pendente", "lista_espera"].includes(r.status) && html`<button class="botao" style="width:auto; padding:9px 16px;" disabled=${ocupado} onClick=${() => onAcao(r, "confirmar")}>Confirmar</button>`}
        ${r.status === "pendente" && html`<button class="botao-secundario-pequeno" disabled=${ocupado} onClick=${() => onAcao(r, "lista_espera")}>Lista de espera</button>`}
        ${["pendente", "lista_espera"].includes(r.status) && html`<button class="botao-secundario-pequeno" disabled=${ocupado} onClick=${() => pedirMotivo("recusar", `Motivo para recusar a reserva de ${r.cliente_nome} (o cliente recebe este texto):`)}>Recusar</button>`}
        ${r.status === "confirmada" && r.data <= hoje && html`
          <button class="botao-secundario-pequeno" disabled=${ocupado} onClick=${() => onAcao(r, "compareceu")}>Compareceu</button>
          <button class="botao-secundario-pequeno" disabled=${ocupado} onClick=${() => onAcao(r, "nao_compareceu")}>Não veio</button>`}
        ${["pendente", "lista_espera", "confirmada"].includes(r.status) && html`<button class="botao-secundario-pequeno" style="color:var(--erro); border-color:var(--erro);" disabled=${ocupado} onClick=${() => pedirMotivo("cancelar", `Motivo do cancelamento da reserva de ${r.cliente_nome} (o cliente recebe este texto):`)}>Cancelar</button>`}
      </div>
    </div>`;
}

function Ocupacao({ turno, lista, capacidade }) {
  const soma = (st) => lista.filter((r) => st.includes(r.status)).reduce((s, r) => s + r.pessoas, 0);
  const conf = soma(["confirmada", "compareceu"]);
  const pend = soma(["pendente"]);
  const esp = soma(["lista_espera"]);
  const pct = (n) => (capacidade ? Math.min(100, (n / capacidade) * 100) : 0);
  return html`
    <div style="margin:4px 0 10px;">
      <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
        <strong>${TURNO[turno]}</strong>
        <span>${conf} confirmada(s) + ${pend} aguardando${esp ? ` · ${esp} na espera` : ""} ${capacidade ? `de ${capacidade} lugares` : "· sem limite definido"}</span>
      </div>
      ${capacidade ? html`
        <div style="display:flex; height:10px; border-radius:6px; overflow:hidden; background:var(--fundo-input); margin-top:4px;">
          <div style=${`width:${pct(conf)}%; background:var(--sucesso);`}></div>
          <div style=${`width:${Math.min(pct(pend), 100 - pct(conf))}%; background:var(--alerta);`}></div>
        </div>` : ""}
    </div>`;
}

function NovaReserva({ onCriada }) {
  const vazio = { cliente_nome: "", cliente_telefone: "", data: hojeISO(), horario: "20:00", pessoas: 2, observacao: "" };
  const [f, setF] = useState(vazio);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const muda = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function salvar() {
    setErro("");
    if (!f.cliente_nome.trim()) { setErro("Informe o nome."); return; }
    setSalvando(true);
    try {
      const tel = f.cliente_telefone.replace(/\D/g, "");
      const out = await acao({ acao: "reserva_criar", dados: { ...f, cliente_telefone: tel ? (tel.length <= 11 ? "55" + tel : tel) : null, pessoas: Number(f.pessoas) } });
      setF(vazio); setAberto(false);
      onCriada(`Reserva ${out.protocolo} criada (${out.status === "lista_espera" ? "turno cheio: entrou na lista de espera" : "confirmada"}).`);
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  if (!aberto) return html`<button class="botao-secundario" style="width:auto;" onClick=${() => setAberto(true)}>+ Nova reserva (balcão/telefone)</button>`;
  return html`
    <div class="card">
      <h3 style="margin-top:0;">Nova reserva</h3>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:0 14px;">
        <label><span style=${rotulo}>Nome</span><input style=${campo} value=${f.cliente_nome} onInput=${muda("cliente_nome")} /></label>
        <label><span style=${rotulo}>Telefone (opcional)</span><input style=${campo} value=${f.cliente_telefone} onInput=${muda("cliente_telefone")} placeholder="62 9 9999-9999" /></label>
        <label><span style=${rotulo}>Data</span><input type="date" style=${campo} value=${f.data} onInput=${muda("data")} /></label>
        <label><span style=${rotulo}>Horário</span><input type="time" style=${campo} value=${f.horario} onInput=${muda("horario")} /></label>
        <label><span style=${rotulo}>Pessoas</span><input type="number" min="1" max="300" style=${campo} value=${f.pessoas} onInput=${muda("pessoas")} /></label>
        <label><span style=${rotulo}>Observação</span><input style=${campo} value=${f.observacao} onInput=${muda("observacao")} placeholder="aniversário, cadeirinha…" /></label>
      </div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="botao" style="width:auto; padding:10px 20px;" disabled=${salvando} onClick=${salvar}>${salvando ? "Salvando…" : "Salvar reserva"}</button>
        <button class="botao-secundario" style="width:auto;" onClick=${() => setAberto(false)}>Fechar</button>
      </div>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </div>`;
}

function Configuracao({ estab, cfg, onSalvo }) {
  const [c, setC] = useState(cfg || { estabelecimento_id: estab, aceitando_reservas: true, capacidade_almoco: "", capacidade_noite: "", limite_grupo: 20, antecedencia_min_horas: 2, dias_max_antecedencia: 60, datas_fechadas: [] });
  const [datas, setDatas] = useState((cfg?.datas_fechadas || []).map((d) => d.split("-").reverse().join("/")).join(", "));
  const [msg, setMsg] = useState("");
  const muda = (k) => (e) => setC({ ...c, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const num = (v) => (v === "" || v == null ? null : Number(v));

  async function salvar() {
    setMsg("");
    const lista = datas.split(/[,;\s]+/).filter(Boolean).map((d) => {
      const [dia, mes, ano] = d.split("/");
      return ano && mes && dia ? `${ano.length === 2 ? "20" + ano : ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}` : null;
    });
    if (lista.some((d) => !d)) { setMsg("❌ Datas fechadas: use o formato dd/mm/aaaa, separadas por vírgula."); return; }
    const r = await sb.from("reserva_config").upsert({
      estabelecimento_id: estab, aceitando_reservas: c.aceitando_reservas,
      capacidade_almoco: num(c.capacidade_almoco), capacidade_noite: num(c.capacidade_noite),
      limite_grupo: Number(c.limite_grupo) || 20, antecedencia_min_horas: Number(c.antecedencia_min_horas) || 0,
      dias_max_antecedencia: Number(c.dias_max_antecedencia) || 60, datas_fechadas: lista, atualizado_em: new Date().toISOString(),
    }, { onConflict: "estabelecimento_id" });
    setMsg(r.error ? "❌ Não foi possível salvar: " + r.error.message : "✅ Regras salvas. Já valem para os próximos pedidos de reserva.");
    if (!r.error) onSalvo();
  }

  return html`
    <div class="card">
      <h3 style="margin-top:0;">Regras de reserva</h3>
      <div class="vazio" style="font-size:0.8rem;">Os lugares por turno valem para o WhatsApp e o site: quando o turno enche, o pedido vai para a lista de espera. Em branco = sem limite automático (a equipe decide uma a uma). Grupos acima do limite viram "reserva especial" e vão para a triagem da gestão.</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:0 14px;">
        <label><span style=${rotulo}>Reservas pelo WhatsApp</span><input type="checkbox" checked=${c.aceitando_reservas} onChange=${muda("aceitando_reservas")} /> aceitando pedidos de reserva</label>
        <label><span style=${rotulo}>Lugares no almoço</span><input type="number" min="1" style=${campo} value=${c.capacidade_almoco ?? ""} onInput=${muda("capacidade_almoco")} placeholder="sem limite" /></label>
        <label><span style=${rotulo}>Lugares à noite</span><input type="number" min="1" style=${campo} value=${c.capacidade_noite ?? ""} onInput=${muda("capacidade_noite")} placeholder="sem limite" /></label>
        <label><span style=${rotulo}>Grupo grande: acima de quantas pessoas</span><input type="number" min="2" style=${campo} value=${c.limite_grupo} onInput=${muda("limite_grupo")} /></label>
        <label><span style=${rotulo}>Antecedência mínima (horas)</span><input type="number" min="0" style=${campo} value=${c.antecedencia_min_horas} onInput=${muda("antecedencia_min_horas")} /></label>
        <label><span style=${rotulo}>Até quantos dias à frente</span><input type="number" min="1" style=${campo} value=${c.dias_max_antecedencia} onInput=${muda("dias_max_antecedencia")} /></label>
      </div>
      <label><span style=${rotulo}>Datas sem reserva (feriados, eventos fechados)</span><input style=${campo} value=${datas} onInput=${(e) => setDatas(e.target.value)} placeholder="24/12/2026, 31/12/2026" /></label>
      <button class="botao" style="margin-top:12px; width:auto; padding:10px 20px;" onClick=${salvar}>Salvar regras</button>
      ${msg && html`<div style="font-size:0.85rem; margin-top:6px;">${msg}</div>`}
    </div>`;
}

export default function Reservas() {
  const [estab, setEstab] = useState(null);
  const [dia, setDia] = useState(hojeISO());
  const [doDia, setDoDia] = useState([]);
  const [pendentes, setPendentes] = useState([]);
  const [cfg, setCfg] = useState(undefined);
  const [verConfig, setVerConfig] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const diaAtual = useRef(dia); // o tempo real e o "seguro" usam sempre o dia que está na tela

  async function carregar(d = diaAtual.current) {
    const [a, b, c] = await Promise.all([
      sb.from("reserva").select("*").eq("data", d).order("horario", { nullsFirst: true }),
      sb.from("reserva").select("*").eq("status", "pendente").gte("data", hojeISO()).order("data").order("horario"),
      sb.from("reserva_config").select("*").maybeSingle(),
    ]);
    if (a.error) setErro("Não foi possível carregar as reservas: " + a.error.message);
    setDoDia(a.data || []);
    setPendentes(b.data || []);
    setCfg(c.data || null);
  }

  useEffect(() => {
    getEstabelecimentoId().then(setEstab);
    const canal = sb.channel("painel-reservas").on("postgres_changes", { event: "*", schema: "public", table: "reserva" }, () => carregar()).subscribe();
    const t = setInterval(() => carregar(), 60000);
    return () => { clearInterval(t); sb.removeChannel(canal); };
  }, []);
  useEffect(() => { diaAtual.current = dia; carregar(dia); }, [dia]);

  async function executar(r, decisao, motivo) {
    setErro(""); setAviso(""); setOcupado(true);
    try {
      const out = await acao({ acao: "reserva_decidir", reserva: r.id, decisao, motivo });
      const st = STATUS[out.status]?.txt || out.status;
      if (out.aviso_cliente === "enviado") setAviso(`${r.cliente_nome}: ${st}. Cliente avisado no WhatsApp.`);
      else if (out.aviso_cliente === "falhou" || out.aviso_cliente === "nao_configurado")
        setErro(`${r.cliente_nome}: ${st}. O aviso pelo WhatsApp não saiu — avise o cliente${r.cliente_telefone ? " no " + r.cliente_telefone : ""}.`);
      else setAviso(`${r.cliente_nome}: ${st}.${r.origem !== "whatsapp" && ["confirmada", "recusada", "cancelada"].includes(out.status) ? " Pedido veio do " + (ORIGEM[r.origem] || r.origem) + ": avise o cliente por telefone." : ""}`);
      await carregar();
    } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  }

  const turnos = ["almoco", "noite"];
  const semTurno = doDia.filter((r) => !r.turno);
  const capacidade = (t) => (t === "almoco" ? cfg?.capacidade_almoco : cfg?.capacidade_noite);

  return html`
    <div>
      <h2>Reservas</h2>
      <p class="desc">Pedidos de reserva do WhatsApp, do site e do balcão. O robô nunca confirma sozinho: a reserva só vale depois que alguém da equipe toca em <strong>Confirmar</strong>.</p>
      ${erro && html`<div class="msg-erro" style="font-size:0.9rem; margin-bottom:10px;">${erro}</div>`}
      ${aviso && html`<div style="color:var(--sucesso); font-size:0.9rem; margin-bottom:10px;">${aviso}</div>`}

      ${pendentes.length > 0 && html`
        <div class="card" style="border-color:var(--alerta);">
          <h3 style="margin-top:0;">⏳ Aguardando resposta (${pendentes.length})</h3>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${pendentes.map((r) => html`<${LinhaReserva} key=${r.id} r=${r} onAcao=${executar} ocupado=${ocupado} mostrarData=${true} />`)}
          </div>
        </div>`}

      <div class="card">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="botao-secundario-pequeno" onClick=${() => setDia(somarDias(dia, -1))}>◀</button>
          <input type="date" style=${campo + " width:auto;"} value=${dia} onInput=${(e) => e.target.value && setDia(e.target.value)} />
          <button class="botao-secundario-pequeno" onClick=${() => setDia(somarDias(dia, 1))}>▶</button>
          <button class="botao-secundario-pequeno" onClick=${() => setDia(hojeISO())}>Hoje</button>
          <strong style="margin-left:6px;">${dataCurta(dia)}</strong>
        </div>
        ${turnos.map((t) => {
          const lista = doDia.filter((r) => r.turno === t);
          return html`
            <div style="margin-top:14px;">
              <${Ocupacao} turno=${t} lista=${lista} capacidade=${capacidade(t)} />
              <div style="display:flex; flex-direction:column; gap:8px;">
                ${lista.length ? lista.map((r) => html`<${LinhaReserva} key=${r.id} r=${r} onAcao=${executar} ocupado=${ocupado} />`) : html`<p class="vazio">Nenhuma reserva neste turno.</p>`}
              </div>
            </div>`;
        })}
        ${semTurno.length > 0 && html`
          <div style="margin-top:14px;">
            <strong>Sem horário definido (site)</strong>
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
              ${semTurno.map((r) => html`<${LinhaReserva} key=${r.id} r=${r} onAcao=${executar} ocupado=${ocupado} />`)}
            </div>
          </div>`}
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        <${NovaReserva} onCriada=${(t) => { setAviso(t); carregar(); }} />
        <button class="botao-secundario" style="width:auto;" onClick=${() => setVerConfig(!verConfig)}>${verConfig ? "Fechar regras" : "⚙️ Regras de reserva"}</button>
      </div>
      ${verConfig && estab && cfg !== undefined && html`<${Configuracao} estab=${estab} cfg=${cfg} onSalvo=${() => carregar()} />`}
    </div>
  `;
}
