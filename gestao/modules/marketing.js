import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, getEstabelecimentoId, formatarMoeda, formatarData, hojeISO } from "../lib/supabase.js";

const html = htm.bind(h);

const PILARES = [
  { valor: "destaque_prato", rotulo: "Destaque de prato" },
  { valor: "bastidor", rotulo: "Bastidor" },
  { valor: "promocao", rotulo: "Promoção" },
  { valor: "evento", rotulo: "Evento" },
  { valor: "prova_social", rotulo: "Prova social" },
];
const FORMATOS = ["post", "story", "reels"];
const STATUS_POST = [
  { valor: "ideia", rotulo: "Ideia" },
  { valor: "pronto", rotulo: "Pronto" },
  { valor: "publicado", rotulo: "Publicado" },
];
const CANAIS = ["instagram", "google", "whatsapp", "influenciador", "evento", "promocao", "midia_paga", "midia_local", "outro"];

function FormaPost({ onSalvo }) {
  const [data, setData] = useState(hojeISO());
  const [pilar, setPilar] = useState(PILARES[0].valor);
  const [formato, setFormato] = useState(FORMATOS[0]);
  const [ideia, setIdeia] = useState("");
  const [cta, setCta] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!ideia.trim()) { setErro("Descreva a ideia do conteúdo."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("marketing_post").insert({ estabelecimento_id, data, pilar, formato, ideia: ideia.trim(), cta: cta.trim() || null, status: "ideia" });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setIdeia(""); setCta("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Nova ideia de conteúdo</h3>
      <div class="linha-campos">
        <div><label>Data</label><input type="date" value=${data} onInput=${(e) => setData(e.target.value)} /></div>
        <div><label>Formato</label><select value=${formato} onChange=${(e) => setFormato(e.target.value)}>${FORMATOS.map((f) => html`<option value=${f}>${f}</option>`)}</select></div>
      </div>
      <label>Pilar</label>
      <select value=${pilar} onChange=${(e) => setPilar(e.target.value)}>${PILARES.map((p) => html`<option value=${p.valor}>${p.rotulo}</option>`)}</select>
      <label>Ideia</label>
      <input type="text" value=${ideia} onInput=${(e) => setIdeia(e.target.value)} placeholder="Ex.: Vídeo mostrando o preparo da carne de sol" />
      <label>CTA (opcional)</label>
      <input type="text" value=${cta} onInput=${(e) => setCta(e.target.value)} placeholder="Ex.: Chama pra reservar mesa" />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar ao calendário"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelCalendario() {
  const [posts, setPosts] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("marketing_post").select("*").order("data", { ascending: true });
    setPosts(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function avancarStatus(post) {
    const ordem = STATUS_POST.map((s) => s.valor);
    const proximo = ordem[Math.min(ordem.indexOf(post.status) + 1, ordem.length - 1)];
    await sb.from("marketing_post").update({ status: proximo }).eq("id", post.id);
    carregar();
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div><${FormaPost} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Calendário</h3>
        ${!posts.length && html`<p class="vazio">Nenhum conteúdo planejado ainda.</p>`}
        <div class="lista-contas">
          ${posts.map((p) => html`
            <div class="item-conta" key=${p.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${p.ideia}</span>
                <span class="chip ${p.status === "publicado" ? "chip-ok" : p.status === "pronto" ? "chip-alerta" : "chip-neutro"}">${STATUS_POST.find((s) => s.valor === p.status)?.rotulo}</span>
              </div>
              <div class="item-conta-meta">${formatarData(p.data)} · ${p.formato} · ${PILARES.find((pi) => pi.valor === p.pilar)?.rotulo}${p.cta ? ` · CTA: ${p.cta}` : ""}</div>
              ${p.status !== "publicado" && html`
                <div class="item-conta-rodape" style="margin-top:6px;">
                  <span></span>
                  <button class="botao-pequeno" onClick=${() => avancarStatus(p)}>Avançar para "${STATUS_POST[STATUS_POST.findIndex((s) => s.valor === p.status) + 1]?.rotulo}"</button>
                </div>
              `}
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function FormaCampanha({ onSalvo }) {
  const [nome, setNome] = useState("");
  const [canal, setCanal] = useState(CANAIS[0]);
  const [periodoInicio, setPeriodoInicio] = useState(hojeISO());
  const [periodoFim, setPeriodoFim] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Dê um nome para a campanha."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("marketing_campanha").insert({
        estabelecimento_id, nome: nome.trim(), canal, periodo_inicio: periodoInicio, periodo_fim: periodoFim || null,
        objetivo: objetivo.trim() || null, orcamento: orcamento ? Number(orcamento) : null, investimento: 0,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setObjetivo(""); setOrcamento(""); setPeriodoFim("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Nova campanha</h3>
      <label>Nome</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Happy Hour de inverno" />
      <div class="linha-campos">
        <div><label>Canal</label><select value=${canal} onChange=${(e) => setCanal(e.target.value)}>${CANAIS.map((c) => html`<option value=${c}>${c.replace(/_/g, " ")}</option>`)}</select></div>
        <div><label>Orçamento (R$)</label><input type="number" step="0.01" min="0" value=${orcamento} onInput=${(e) => setOrcamento(e.target.value)} /></div>
      </div>
      <div class="linha-campos">
        <div><label>Início</label><input type="date" value=${periodoInicio} onInput=${(e) => setPeriodoInicio(e.target.value)} /></div>
        <div><label>Fim (opcional)</label><input type="date" value=${periodoFim} onInput=${(e) => setPeriodoFim(e.target.value)} /></div>
      </div>
      <label>Objetivo</label>
      <input type="text" value=${objetivo} onInput=${(e) => setObjetivo(e.target.value)} placeholder="Ex.: Aumentar movimento de terça e quarta" />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar campanha"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function CardCampanha({ campanha, onMudou }) {
  const [investimento, setInvestimento] = useState(campanha.investimento || 0);
  const [alcance, setAlcance] = useState(campanha.alcance ?? "");
  const [reservas, setReservas] = useState(campanha.reservas ?? "");
  const [clientesGerados, setClientesGerados] = useState(campanha.clientes_gerados ?? "");
  const [faturamentoAtribuido, setFaturamentoAtribuido] = useState(campanha.faturamento_atribuido ?? "");
  const [salvando, setSalvando] = useState(false);

  const inv = Number(investimento) || 0;
  const fat = Number(faturamentoAtribuido) || 0;
  const clientes = Number(clientesGerados) || 0;
  const roi = inv > 0 ? ((fat - inv) / inv) * 100 : null;
  const roas = inv > 0 ? fat / inv : null;
  const cac = clientes > 0 && inv > 0 ? inv / clientes : null;

  async function salvarResultados() {
    setSalvando(true);
    await sb.from("marketing_campanha").update({
      investimento: inv,
      alcance: alcance === "" ? null : Number(alcance),
      reservas: reservas === "" ? null : Number(reservas),
      clientes_gerados: clientesGerados === "" ? null : Number(clientesGerados),
      faturamento_atribuido: faturamentoAtribuido === "" ? null : Number(faturamentoAtribuido),
    }).eq("id", campanha.id);
    setSalvando(false);
    onMudou();
  }

  return html`
    <div class="card">
      <h3>${campanha.nome}</h3>
      <p class="desc-form">${campanha.canal.replace(/_/g, " ")} · desde ${formatarData(campanha.periodo_inicio)}${campanha.periodo_fim ? ` até ${formatarData(campanha.periodo_fim)}` : ""}${campanha.objetivo ? ` · ${campanha.objetivo}` : ""}</p>
      <div class="linha-campos">
        <div><label>Investimento (R$)</label><input type="number" step="0.01" min="0" value=${investimento} onInput=${(e) => setInvestimento(e.target.value)} /></div>
        <div><label>Alcance</label><input type="number" min="0" value=${alcance} onInput=${(e) => setAlcance(e.target.value)} /></div>
      </div>
      <div class="linha-campos">
        <div><label>Reservas geradas</label><input type="number" min="0" value=${reservas} onInput=${(e) => setReservas(e.target.value)} /></div>
        <div><label>Clientes novos</label><input type="number" min="0" value=${clientesGerados} onInput=${(e) => setClientesGerados(e.target.value)} /></div>
      </div>
      <label>Faturamento atribuído (R$)</label>
      <input type="number" step="0.01" min="0" value=${faturamentoAtribuido} onInput=${(e) => setFaturamentoAtribuido(e.target.value)} />
      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr); margin: 12px 0;">
        <div class="stat-box ${roi != null && roi < 0 ? "stat-erro" : "stat-ok"}"><div class="stat-num">${roi != null ? roi.toFixed(0) + "%" : "—"}</div><div class="stat-lbl">ROI</div></div>
        <div class="stat-box"><div class="stat-num">${roas != null ? roas.toFixed(2) + "x" : "—"}</div><div class="stat-lbl">ROAS</div></div>
        <div class="stat-box"><div class="stat-num">${cac != null ? formatarMoeda(cac) : "—"}</div><div class="stat-lbl">CAC</div></div>
      </div>
      <button class="botao-secundario" disabled=${salvando} onClick=${salvarResultados}>${salvando ? "Salvando…" : "Salvar resultados"}</button>
    </div>
  `;
}

function PainelCampanhas() {
  const [campanhas, setCampanhas] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("marketing_campanha").select("*").order("periodo_inicio", { ascending: false });
    setCampanhas(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div><${FormaCampanha} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Campanhas</h3>
        ${!campanhas.length && html`<p class="vazio">Nenhuma campanha cadastrada ainda.</p>`}
        ${campanhas.map((c) => html`<${CardCampanha} campanha=${c} onMudou=${carregar} key=${c.id} />`)}
      </div>
    </div>
  `;
}

function FormaCliente({ onSalvo }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [aniversario, setAniversario] = useState("");
  const [consentimento, setConsentimento] = useState(false);
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Preencha o nome do cliente."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("cliente").insert({
        estabelecimento_id, nome: nome.trim(), telefone: telefone.trim() || null, aniversario: aniversario || null,
        consentimento_marketing: consentimento, observacoes: observacoes.trim() || null,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setTelefone(""); setAniversario(""); setConsentimento(false); setObservacoes("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo cliente</h3>
      <label>Nome</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} />
      <div class="linha-campos">
        <div><label>Telefone/WhatsApp</label><input type="text" value=${telefone} onInput=${(e) => setTelefone(e.target.value)} /></div>
        <div><label>Aniversário</label><input type="date" value=${aniversario} onInput=${(e) => setAniversario(e.target.value)} /></div>
      </div>
      <div class="toggle-linha" style="margin-bottom:12px;">
        <label style="margin:0">Autorizou receber contato de marketing (LGPD)</label>
        <input type="checkbox" checked=${consentimento} onChange=${(e) => setConsentimento(e.target.checked)} />
      </div>
      <label>Observações</label>
      <input type="text" value=${observacoes} onInput=${(e) => setObservacoes(e.target.value)} placeholder="Ex.: prefere mesa no salão externo" />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar cliente"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function linkWhatsapp(telefone, mensagem) {
  const digitos = (telefone || "").replace(/\D/g, "");
  const numero = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

function PainelCRM() {
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await sb.from("cliente").select("*").order("nome");
    setClientes(r.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const mesDiaHoje = hojeISO().slice(5);
  const aniversariantesHoje = clientes.filter((c) => c.aniversario && c.aniversario.slice(5) === mesDiaHoje);
  const aniversariantesMes = clientes.filter((c) => c.aniversario && c.aniversario.slice(5, 7) === mesDiaHoje.slice(0, 2) && c.aniversario.slice(5) !== mesDiaHoje);

  return html`
    <div class="colunas-financeiro">
      <div><${FormaCliente} onSalvo=${carregar} /></div>
      <div>
        ${aniversariantesHoje.length > 0 && html`
          <div class="card" style="border-color: var(--dourado); margin-bottom: 16px;">
            <h3>🎂 Aniversário hoje</h3>
            <div class="lista-contas">
              ${aniversariantesHoje.map((c) => html`
                <div class="item-conta" key=${c.id}>
                  <div class="item-conta-topo"><span class="item-conta-desc">${c.nome}</span></div>
                  ${c.telefone
                    ? html`<a href=${linkWhatsapp(c.telefone, `Olá ${c.nome}! A equipe do Serra Dourada deseja um feliz aniversário! 🎉`)} target="_blank" rel="noopener" class="botao-pequeno" style="display:inline-block; margin-top:6px; text-decoration:none;">Enviar parabéns no WhatsApp</a>`
                    : html`<p class="desc-form" style="margin:6px 0 0;">Sem telefone cadastrado.</p>`}
                </div>
              `)}
            </div>
          </div>
        `}
        ${aniversariantesMes.length > 0 && html`<div class="alerta-banner">${aniversariantesMes.length} cliente(s) também fazem aniversário este mês: ${aniversariantesMes.map((c) => c.nome).join(", ")}</div>`}
        <h3 class="titulo-lista">Clientes cadastrados</h3>
        ${!clientes.length && html`<p class="vazio">Nenhum cliente cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${clientes.map((c) => html`
            <div class="item-conta" key=${c.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${c.nome}</span>
                ${c.consentimento_marketing ? html`<span class="chip chip-ok">Consentiu marketing</span>` : html`<span class="chip chip-neutro">Sem consentimento</span>`}
              </div>
              <div class="item-conta-meta">
                ${c.telefone || "sem telefone"}${c.aniversario ? ` · aniversário ${formatarData(c.aniversario)}` : ""}
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

export default function Marketing() {
  const [aba, setAba] = useState("calendario");
  return html`
    <div>
      <h2>Marketing e CRM</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "calendario" ? " ativo" : "")} onClick=${() => setAba("calendario")}>Calendário</button>
        <button class=${"sub-tab" + (aba === "campanhas" ? " ativo" : "")} onClick=${() => setAba("campanhas")}>Campanhas</button>
        <button class=${"sub-tab" + (aba === "crm" ? " ativo" : "")} onClick=${() => setAba("crm")}>CRM</button>
      </div>
      ${aba === "calendario" && html`<${PainelCalendario} />`}
      ${aba === "campanhas" && html`<${PainelCampanhas} />`}
      ${aba === "crm" && html`<${PainelCRM} />`}
    </div>
  `;
}
