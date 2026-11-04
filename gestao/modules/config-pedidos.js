// Configuração dos pedidos pelo WhatsApp (só gerência): regras gerais, setores por categoria,
// impressoras, itens esgotados e chave do programa de impressão. Nada aqui tem valor "inventado":
// o que ficar em branco simplesmente não é oferecido ao cliente (ex.: sem taxa = sem entrega).
import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, getEstabelecimentoId, formatarMoeda, formatarDataHora } from "../lib/supabase.js";

const html = htm.bind(h);

const SETORES = [["cozinha", "Cozinha"], ["churrasqueira", "Churrasqueira"], ["bar", "Bar"], ["caixa", "Caixa"]];
const PERIODOS = [["todos", "Almoço e bar"], ["almoco", "Só almoço"], ["bar", "Só bar (noite)"]];
const campo = "width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--borda); background:var(--fundo-input); color:var(--texto); font-size:0.95rem; font-family:inherit;";
const rotulo = "display:block; font-size:0.8rem; color:var(--texto-suave); margin:10px 0 4px;";

const numOuNulo = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")));

function Mensagem({ ok, erro }) {
  return html`${erro && html`<div class="msg-erro">${erro}</div>`}${ok && html`<div style="color:var(--sucesso); font-size:0.85rem; margin-top:6px;">${ok}</div>`}`;
}

// ---------- regras gerais ----------
function Geral({ estab }) {
  const [c, setC] = useState(null);
  const [ok, setOk] = useState("");
  const [erro, setErro] = useState("");

  async function carregar() {
    const r = await sb.from("pedido_config").select("*").eq("estabelecimento_id", estab).maybeSingle();
    setC(r.data || { estabelecimento_id: estab, aceitando_pedidos: false, retirada_ativa: true, entrega_ativa: false, pedido_minimo: 0, max_itens_por_pedido: 50, happy_hour_em_pedidos: false });
  }
  useEffect(() => { carregar(); }, []);
  if (!c) return html`<p class="vazio">Carregando…</p>`;
  const muda = (k) => (e) => setC({ ...c, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function salvar(extra = {}) {
    setOk(""); setErro("");
    const dados = {
      ...c, ...extra,
      taxa_entrega: numOuNulo(extra.taxa_entrega ?? c.taxa_entrega),
      pedido_minimo: numOuNulo(c.pedido_minimo) ?? 0,
      max_itens_por_pedido: Number(c.max_itens_por_pedido) || 50,
      almoco_aceita_ate: c.almoco_aceita_ate || null,
      bar_aceita_ate: c.bar_aceita_ate || null,
      chave_pix: (c.chave_pix || "").trim() || null,
      pix_titular: (c.pix_titular || "").trim() || null,
      ifood_url: (c.ifood_url || "").trim() || null,
      tempo_retirada: (c.tempo_retirada || "").trim() || null,
      tempo_entrega: (c.tempo_entrega || "").trim() || null,
      atualizado_em: new Date().toISOString(),
    };
    if (dados.ifood_url && !/^https:\/\//.test(dados.ifood_url)) { setErro("O link do iFood precisa começar com https://"); return; }
    if (dados.entrega_ativa && dados.taxa_entrega === null) { setErro("Para ligar a entrega, informe a taxa de entrega (pode ser 0 se for grátis)."); return; }
    const r = await sb.from("pedido_config").upsert(dados, { onConflict: "estabelecimento_id" });
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setOk("Configuração salva. Já vale para os próximos pedidos.");
    carregar();
  }

  async function alternarPedidos() {
    const ligar = !c.aceitando_pedidos;
    const txt = ligar
      ? "Ligar os pedidos pelo WhatsApp? O robô passa a aceitar pedidos e mandar comandas para a impressora."
      : "Desligar os pedidos pelo WhatsApp? O robô avisa os clientes que os pedidos estão pausados.";
    if (confirm(txt)) { setC({ ...c, aceitando_pedidos: ligar }); await salvar({ aceitando_pedidos: ligar }); }
  }

  return html`
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div>
          <h3 style="margin:0;">Pedidos pelo WhatsApp</h3>
          <div class="vazio" style="font-size:0.8rem;">Chave geral. Use para pausar em caso de problema ou movimento excessivo.</div>
        </div>
        <button class=${c.aceitando_pedidos ? "botao-secundario" : "botao"} style="width:auto; min-width:200px; padding:14px 18px; font-size:1rem;" onClick=${alternarPedidos}>
          ${c.aceitando_pedidos ? "🟢 Ligado — tocar para pausar" : "🔴 Desligado — tocar para ligar"}
        </button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:4px 18px; margin-top:8px;">
        <label><span style=${rotulo}>Retirada no balcão</span><input type="checkbox" checked=${c.retirada_ativa} onChange=${muda("retirada_ativa")} /> aceitar retirada</label>
        <label><span style=${rotulo}>Entrega</span><input type="checkbox" checked=${c.entrega_ativa} onChange=${muda("entrega_ativa")} /> aceitar entrega</label>
        <label><span style=${rotulo}>Taxa de entrega (R$)</span><input style=${campo} value=${c.taxa_entrega ?? ""} onInput=${muda("taxa_entrega")} placeholder="0 = grátis (vazio = sem entrega)" /></label>
        <label><span style=${rotulo}>Pedido mínimo (R$)</span><input style=${campo} value=${c.pedido_minimo ?? 0} onInput=${muda("pedido_minimo")} /></label>
        <label><span style=${rotulo}>Tempo para retirada</span><input style=${campo} value=${c.tempo_retirada || ""} onInput=${muda("tempo_retirada")} placeholder="ex.: 20 a 30 minutos" /></label>
        <label><span style=${rotulo}>Tempo de entrega</span><input style=${campo} value=${c.tempo_entrega || ""} onInput=${muda("tempo_entrega")} placeholder="ex.: 40 a 60 minutos" /></label>
        <label><span style=${rotulo}>Chave Pix (enviada ao cliente)</span><input style=${campo} value=${c.chave_pix || ""} onInput=${muda("chave_pix")} placeholder="CNPJ, e-mail ou telefone" /></label>
        <label><span style=${rotulo}>Titular da conta Pix</span><input style=${campo} value=${c.pix_titular || ""} onInput=${muda("pix_titular")} placeholder="nome que aparece no app do banco" /></label>
        <label><span style=${rotulo}>Link da loja no iFood (fora da área de entrega)</span><input style=${campo} value=${c.ifood_url || ""} onInput=${muda("ifood_url")} placeholder="https://www.ifood.com.br/delivery/..." /></label>
        <label><span style=${rotulo}>Almoço aceita pedidos até</span><input type="time" style=${campo} value=${(c.almoco_aceita_ate || "").slice(0, 5)} onInput=${muda("almoco_aceita_ate")} /></label>
        <label><span style=${rotulo}>Bar aceita pedidos até</span><input type="time" style=${campo} value=${(c.bar_aceita_ate || "").slice(0, 5)} onInput=${muda("bar_aceita_ate")} /></label>
        <label><span style=${rotulo}>Máximo de itens por pedido</span><input type="number" min="1" max="200" style=${campo} value=${c.max_itens_por_pedido} onInput=${muda("max_itens_por_pedido")} /></label>
        <label><span style=${rotulo}>Happy hour</span><input type="checkbox" checked=${c.happy_hour_em_pedidos} onChange=${muda("happy_hour_em_pedidos")} /> aplicar preço de happy hour nos pedidos</label>
      </div>
      <div class="vazio" style="font-size:0.78rem; margin-top:8px;">Horários de funcionamento vêm do cadastro do site (almoço e bar). Os campos "aceita pedidos até" servem para encerrar os pedidos antes do fechamento; em branco, vale até fechar.</div>
      <button class="botao" style="margin-top:12px; width:auto; padding:12px 22px;" onClick=${() => salvar()}>Salvar configuração</button>
      <${Mensagem} ok=${ok} erro=${erro} />
    </div>
  `;
}

// ---------- setor e turno de cada categoria ----------
function Categorias({ estab }) {
  const [linhas, setLinhas] = useState([]);
  const [ok, setOk] = useState("");
  const [erro, setErro] = useState("");

  async function carregar() {
    const [cards, cats] = await Promise.all([
      sb.from("cardapio_publico").select("categoria, grupo").eq("ativo", true),
      sb.from("categoria_pedido").select("*"),
    ]);
    const existentes = Object.fromEntries((cats.data || []).map((c) => [c.categoria, c]));
    const nomes = [...new Set((cards.data || []).map((c) => c.categoria))].sort();
    setLinhas(nomes.map((n) => existentes[n] || { estabelecimento_id: estab, categoria: n, setor: "", periodo: "todos", disponivel_pedido: false, pergunta: "", novo: true }));
  }
  useEffect(() => { carregar(); }, []);

  const muda = (i, k, v) => setLinhas(linhas.map((l, j) => (j === i ? { ...l, [k]: v, alterada: true } : l)));

  async function salvar() {
    setOk(""); setErro("");
    const alteradas = linhas.filter((l) => l.alterada);
    if (alteradas.some((l) => l.disponivel_pedido && !l.setor)) { setErro("Escolha o setor de toda categoria liberada para pedido."); return; }
    const dados = alteradas.filter((l) => l.setor).map(({ novo, alterada, ...l }) => ({ ...l, estabelecimento_id: estab, pergunta: (l.pergunta || "").trim() || null }));
    if (!dados.length) { setOk("Nada para salvar."); return; }
    const r = await sb.from("categoria_pedido").upsert(dados, { onConflict: "estabelecimento_id,categoria" });
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setOk(`${dados.length} categoria(s) salva(s).`);
    carregar();
  }

  return html`
    <div class="card">
      <h3 style="margin-top:0;">Setor e horário de cada categoria</h3>
      <div class="vazio" style="font-size:0.8rem; margin-bottom:8px;">Define para qual impressora vai a comanda e em que turno o item pode ser pedido. Categoria sem setor não aparece para o cliente. "Pergunta" é feita ao cliente quando ele escolhe um item da categoria (ex.: "Qual sabor?").</div>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.86rem;">
          <thead><tr style="text-align:left; color:var(--texto-suave);"><th style="padding:6px;">Pedir?</th><th style="padding:6px;">Categoria</th><th style="padding:6px;">Setor</th><th style="padding:6px;">Turno</th><th style="padding:6px;">Pergunta ao cliente</th></tr></thead>
          <tbody>
            ${linhas.map((l, i) => html`
              <tr style="border-top:1px solid var(--borda);">
                <td style="padding:6px;"><input type="checkbox" checked=${l.disponivel_pedido} onChange=${(e) => muda(i, "disponivel_pedido", e.target.checked)} /></td>
                <td style="padding:6px; font-weight:600;">${l.categoria}</td>
                <td style="padding:6px;"><select style=${campo} value=${l.setor} onChange=${(e) => muda(i, "setor", e.target.value)}><option value="">—</option>${SETORES.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></td>
                <td style="padding:6px;"><select style=${campo} value=${l.periodo} onChange=${(e) => muda(i, "periodo", e.target.value)}>${PERIODOS.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></td>
                <td style="padding:6px; min-width:220px;"><input style=${campo} value=${l.pergunta || ""} onInput=${(e) => muda(i, "pergunta", e.target.value)} placeholder="(opcional)" /></td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      <button class="botao" style="margin-top:12px; width:auto; padding:12px 22px;" onClick=${salvar}>Salvar categorias</button>
      <${Mensagem} ok=${ok} erro=${erro} />
    </div>
  `;
}

// ---------- itens esgotados / fora do WhatsApp ----------
function Itens() {
  const [itens, setItens] = useState([]);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");

  async function carregar() {
    const r = await sb.from("cardapio_publico").select("id, nome, categoria, preco, esgotado, aceita_pedido").eq("ativo", true).order("categoria").order("ordem");
    setItens(r.data || []);
  }
  useEffect(() => { carregar(); }, []);

  async function alternar(item, campo) {
    setErro("");
    const r = await sb.from("cardapio_publico").update({ [campo]: !item[campo] }).eq("id", item.id);
    if (r.error) setErro("Não foi possível alterar: " + r.error.message);
    carregar();
  }

  const t = busca.trim().toLowerCase();
  const filtrados = itens.filter((i) => !t || i.nome.toLowerCase().includes(t) || i.categoria.toLowerCase().includes(t));
  const esgotados = itens.filter((i) => i.esgotado);

  return html`
    <div class="card">
      <h3 style="margin-top:0;">Itens esgotados</h3>
      <div class="vazio" style="font-size:0.8rem;">Item esgotado some na hora do WhatsApp, inclusive de carrinhos em andamento. ${esgotados.length ? html`<strong style="color:var(--alerta);">Esgotados agora: ${esgotados.map((i) => i.nome).join(", ")}</strong>` : ""}</div>
      <input style=${campo + " margin:10px 0;"} value=${busca} onInput=${(e) => setBusca(e.target.value)} placeholder="Buscar item (ex.: picanha, coca)" />
      <div style="display:flex; flex-direction:column; gap:6px; max-height:420px; overflow-y:auto;">
        ${filtrados.slice(0, 80).map((i) => html`
          <div class="item-conta" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span><strong>${i.nome}</strong> <span style="font-size:0.75rem; color:var(--texto-suave);">${i.categoria} · ${formatarMoeda(i.preco)}</span></span>
            <span style="display:flex; gap:6px;">
              <button class="botao-secundario-pequeno" style=${i.esgotado ? "border-color:var(--erro); color:var(--erro);" : ""} onClick=${() => alternar(i, "esgotado")}>${i.esgotado ? "Esgotado — reativar" : "Marcar esgotado"}</button>
              <button class="botao-secundario-pequeno" onClick=${() => alternar(i, "aceita_pedido")}>${i.aceita_pedido ? "No WhatsApp" : "Fora do WhatsApp"}</button>
            </span>
          </div>`)}
      </div>
      <${Mensagem} erro=${erro} />
    </div>
  `;
}

// ---------- impressoras e programa de impressão ----------
const alternaSetor = (lst, s) => (lst.includes(s) ? lst.filter((x) => x !== s) : [...lst, s]);

// Formulário de uma impressora (fora do componente pai para o campo não perder o foco ao digitar).
function Linha({ imp, onMuda }) {
  return html`
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:6px 12px; align-items:end;">
      <label><span style=${rotulo}>Nome</span><input style=${campo} value=${imp.nome} onInput=${(e) => onMuda({ ...imp, nome: e.target.value })} placeholder="ex.: Cozinha" /></label>
      <label><span style=${rotulo}>Nome no Windows</span><input style=${campo} value=${imp.nome_windows} onInput=${(e) => onMuda({ ...imp, nome_windows: e.target.value })} placeholder="EPSON TM-T20 ReceiptE4" /></label>
      <label><span style=${rotulo}>Tipo</span><select style=${campo} value=${imp.modo} onChange=${(e) => onMuda({ ...imp, modo: e.target.value })}><option value="escpos">Térmica (Epson/ESC-POS)</option><option value="texto">Somente texto</option></select></label>
      <label><span style=${rotulo}>Colunas</span><input type="number" style=${campo} value=${imp.colunas} onInput=${(e) => onMuda({ ...imp, colunas: e.target.value })} /></label>
      <label><span style=${rotulo}>Vias</span><input type="number" min="1" max="3" style=${campo} value=${imp.vias} onInput=${(e) => onMuda({ ...imp, vias: e.target.value })} /></label>
      <div><span style=${rotulo}>Setores</span>${SETORES.map(([v, t]) => html`<label style="margin-right:8px; font-size:0.85rem;"><input type="checkbox" checked=${imp.setores.includes(v)} onChange=${() => onMuda({ ...imp, setores: alternaSetor(imp.setores, v) })} /> ${t}</label>`)}</div>
    </div>`;
}

function Impressoras({ estab }) {
  const [lista, setLista] = useState([]);
  const [agentes, setAgentes] = useState([]);
  const [nova, setNova] = useState({ nome: "", nome_windows: "", setores: [], modo: "escpos", colunas: 48, vias: 1 });
  const [token, setToken] = useState("");
  const [ok, setOk] = useState("");
  const [erro, setErro] = useState("");

  async function carregar() {
    const [i, a] = await Promise.all([
      sb.from("impressora").select("*").order("nome"),
      sb.from("impressao_agente").select("id, nome, ativo, ultimo_contato, criado_em").order("criado_em"),
    ]);
    setLista(i.data || []);
    setAgentes(a.data || []);
  }
  useEffect(() => { carregar(); }, []);

  async function salvarImpressora(imp) {
    setOk(""); setErro("");
    if (!imp.nome.trim() || !imp.nome_windows.trim() || !imp.setores.length) { setErro("Preencha o nome, o nome no Windows e pelo menos um setor."); return; }
    const { id, criado_em, ultimo_contato, ultimo_erro, ...dados } = imp;
    const r = id
      ? await sb.from("impressora").update({ ...dados, colunas: Number(dados.colunas), vias: Number(dados.vias) }).eq("id", id)
      : await sb.from("impressora").insert({ ...dados, estabelecimento_id: estab, colunas: Number(dados.colunas), vias: Number(dados.vias) });
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setOk("Impressora salva.");
    if (!id) setNova({ nome: "", nome_windows: "", setores: [], modo: "escpos", colunas: 48, vias: 1 });
    carregar();
  }

  async function gerarToken() {
    setOk(""); setErro(""); setToken("");
    const nome = prompt("Nome deste computador (ex.: PC do caixa):", "PC do caixa");
    if (!nome) return;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const novo = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(novo)))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const r = await sb.from("impressao_agente").insert({ estabelecimento_id: estab, nome, token_hash: hash });
    if (r.error) { setErro("Não foi possível gerar: " + r.error.message); return; }
    setToken(novo);
    carregar();
  }

  async function desativarAgente(a) {
    if (!confirm(`Desligar a chave do "${a.nome}"? O programa desse computador para de imprimir até receber uma chave nova.`)) return;
    await sb.from("impressao_agente").update({ ativo: false }).eq("id", a.id);
    carregar();
  }

  return html`
    <div class="card">
      <h3 style="margin-top:0;">Impressoras</h3>
      <div class="vazio" style="font-size:0.8rem;">Cada impressora recebe as comandas dos setores marcados. Marque "Caixa" na que deve receber a via completa com preços e pagamento. O "nome no Windows" é exatamente o que aparece em Configurações › Impressoras do PC.</div>
      ${lista.map((imp) => html`
        <div class="item-conta" style="margin-top:10px;">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; font-size:0.8rem;">
            <span>${imp.ativo ? "🟢 Ativa" : "⚪ Desativada"}${imp.ultimo_contato ? ` · último sinal do PC: ${formatarDataHora(imp.ultimo_contato)}` : " · ainda sem sinal do PC"}</span>
            ${imp.ultimo_erro && html`<span style="color:var(--erro);">Último erro: ${imp.ultimo_erro}</span>`}
          </div>
          <${Linha} imp=${imp} onMuda=${(x) => setLista(lista.map((y) => (y.id === imp.id ? x : y)))} />
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="botao-secundario-pequeno" onClick=${() => salvarImpressora(imp)}>Salvar</button>
            <button class="botao-secundario-pequeno" onClick=${() => salvarImpressora({ ...imp, ativo: !imp.ativo })}>${imp.ativo ? "Desativar" : "Ativar"}</button>
          </div>
        </div>`)}
      <div class="item-conta" style="margin-top:10px; border-style:dashed;">
        <strong style="font-size:0.9rem;">Nova impressora</strong>
        <${Linha} imp=${nova} onMuda=${setNova} />
        <button class="botao-secundario-pequeno" style="margin-top:8px;" onClick=${() => salvarImpressora(nova)}>Adicionar</button>
      </div>

      <h3 style="margin:22px 0 4px;">Programa de impressão (PC do restaurante)</h3>
      <div class="vazio" style="font-size:0.8rem;">Gere uma chave e cole no arquivo <code>agente.config.json</code> do PC. A chave aparece <strong>uma única vez</strong> e não deve ser enviada por WhatsApp ou e-mail.</div>
      ${agentes.map((a) => html`
        <div style="display:flex; justify-content:space-between; gap:8px; font-size:0.85rem; margin-top:6px;">
          <span>${a.ativo ? "🟢" : "⚪"} ${a.nome} · ${a.ultimo_contato ? "último sinal " + formatarDataHora(a.ultimo_contato) : "nunca conectou"}</span>
          ${a.ativo && html`<button class="botao-secundario-pequeno" onClick=${() => desativarAgente(a)}>Desligar chave</button>`}
        </div>`)}
      <button class="botao-secundario" style="margin-top:10px;" onClick=${gerarToken}>Gerar nova chave do programa</button>
      ${token && html`<div class="item-conta" style="margin-top:10px; word-break:break-all;"><div style="font-size:0.8rem; color:var(--alerta); margin-bottom:4px;">Copie agora — ela não será mostrada de novo:</div><code style="font-size:0.95rem;">${token}</code></div>`}
      <${Mensagem} ok=${ok} erro=${erro} />
    </div>
  `;
}

export default function ConfigPedidos() {
  const [estab, setEstab] = useState(null);
  const [aba, setAba] = useState("geral");
  useEffect(() => { getEstabelecimentoId().then(setEstab); }, []);
  if (!estab) return html`<p class="vazio">Carregando…</p>`;
  const abas = [["geral", "Regras gerais"], ["categorias", "Setores e horários"], ["itens", "Esgotados"], ["impressoras", "Impressoras"]];
  return html`
    <div>
      <h2>Configurar pedidos</h2>
      <p class="desc">Tudo que o robô do WhatsApp oferece e imprime vem daqui e do cardápio do site.</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        ${abas.map(([k, t]) => html`<button class=${aba === k ? "botao" : "botao-secundario"} style="width:auto; padding:10px 16px;" onClick=${() => setAba(k)}>${t}</button>`)}
      </div>
      ${aba === "geral" && html`<${Geral} estab=${estab} />`}
      ${aba === "categorias" && html`<${Categorias} estab=${estab} />`}
      ${aba === "itens" && html`<${Itens} />`}
      ${aba === "impressoras" && html`<${Impressoras} estab=${estab} />`}
    </div>
  `;
}
