import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, getEstabelecimentoId, formatarMoeda, formatarData, diasAte, hojeISO, enviarAnexo, urlAssinadaAnexo, ehCaminhoArmazenado } from "../lib/supabase.js";

const html = htm.bind(h);

function CampoAnexo({ valor, onMudar }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function aoSelecionar(ev) {
    const arquivo = ev.target.files[0];
    ev.target.value = "";
    if (!arquivo) return;
    setErro("");
    setEnviando(true);
    try {
      const caminho = await enviarAnexo(arquivo);
      onMudar(caminho);
    } catch (e) {
      setErro("Não foi possível enviar o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  return html`
    <div>
      <label>Link ou anexo (opcional)</label>
      <div style="display:flex; gap:8px; align-items:flex-start;">
        <input type="text" style="flex:1;" value=${valor} onInput=${(e) => onMudar(e.target.value)} placeholder="Cole um link…" />
        <label class="botao-secundario-pequeno" style="cursor:pointer; white-space:nowrap; padding:9px 12px;">
          ${enviando ? "Enviando…" : "📷 Anexar"}
          <input type="file" accept="image/*,.pdf" capture="environment" style="display:none;" onChange=${aoSelecionar} disabled=${enviando} />
        </label>
      </div>
      ${valor && ehCaminhoArmazenado(valor) && html`<p class="desc-form" style="margin-top:4px;">Arquivo anexado ✓</p>`}
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </div>
  `;
}

function LinkArquivo({ caminho }) {
  const [abrindo, setAbrindo] = useState(false);
  async function abrir(ev) {
    ev.preventDefault();
    setAbrindo(true);
    try {
      const url = ehCaminhoArmazenado(caminho) ? await urlAssinadaAnexo(caminho) : caminho;
      window.open(url, "_blank", "noopener");
    } catch (e) {} finally { setAbrindo(false); }
  }
  return html`<a href="#" onClick=${abrir} style="color:var(--dourado-claro)">${abrindo ? "abrindo…" : "ver arquivo"}</a>`;
}

const TIPOS_DOCUMENTO = ["cnpj", "contrato_social", "alvara", "licenca_sanitaria", "licenca_bombeiros", "certidao_federal", "certidao_estadual", "simples_nacional", "seguro", "procuracao", "outro"];
const TIPOS_CONTRATO = ["aluguel", "fornecedor", "software", "contabilidade", "marketing", "seguranca", "manutencao", "maquina_cartao", "delivery", "internet", "outro"];
const CATEGORIAS_LEMBRETE = [
  { valor: "rh", rotulo: "RH" },
  { valor: "financeiro", rotulo: "Financeiro" },
  { valor: "compliance", rotulo: "Compliance/fiscal" },
  { valor: "manutencao", rotulo: "Manutenção" },
  { valor: "juridico", rotulo: "Jurídico" },
];

function ChipVencimento({ data }) {
  if (!data) return null;
  const dias = diasAte(data);
  if (dias < 0) return html`<span class="chip chip-erro">Vencido há ${Math.abs(dias)}d</span>`;
  if (dias <= 30) return html`<span class="chip chip-alerta">Vence em ${dias}d</span>`;
  return html`<span class="chip chip-neutro">Vence ${formatarData(data)}</span>`;
}

function PainelVencimentos({ documentos, contratos, lembretes }) {
  const itens = [
    ...documentos.filter((d) => d.validade).map((d) => ({ tipo: "Documento", nome: d.nome, data: d.validade })),
    ...contratos.filter((c) => c.termino).map((c) => ({ tipo: "Contrato", nome: `${c.contraparte} (${c.tipo})`, data: c.termino })),
    ...lembretes.filter((l) => l.status === "pendente").map((l) => ({ tipo: "Lembrete", nome: l.titulo, data: l.data_vencimento })),
  ]
    .filter((i) => diasAte(i.data) <= 30)
    .sort((a, b) => a.data.localeCompare(b.data));

  if (!itens.length) return html`<p class="vazio">Nada vencendo nos próximos 30 dias.</p>`;

  return html`
    <div class="lista-contas">
      ${itens.map((i, idx) => html`
        <div class="item-conta" key=${idx}>
          <div class="item-conta-topo">
            <span class="item-conta-desc">${i.nome}</span>
            <${ChipVencimento} data=${i.data} />
          </div>
          <div class="item-conta-meta">${i.tipo}</div>
        </div>
      `)}
    </div>
  `;
}

function FormaDocumento({ onSalvo }) {
  const [tipo, setTipo] = useState(TIPOS_DOCUMENTO[0]);
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [emissao, setEmissao] = useState("");
  const [validade, setValidade] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [arquivoUrl, setArquivoUrl] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Preencha o nome do documento."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("documento_empresa").insert({
        estabelecimento_id, tipo, nome: nome.trim(),
        numero: numero.trim() || null, emissao: emissao || null, validade: validade || null,
        responsavel: responsavel.trim() || null, arquivo_url: arquivoUrl.trim() || null,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setNumero(""); setEmissao(""); setValidade(""); setResponsavel(""); setArquivoUrl("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo documento</h3>
      <label>Tipo</label>
      <select value=${tipo} onChange=${(e) => setTipo(e.target.value)}>${TIPOS_DOCUMENTO.map((t) => html`<option value=${t}>${t.replace(/_/g, " ")}</option>`)}</select>
      <label>Nome</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Alvará de funcionamento" />
      <div class="linha-campos">
        <div><label>Número</label><input type="text" value=${numero} onInput=${(e) => setNumero(e.target.value)} /></div>
        <div><label>Responsável</label><input type="text" value=${responsavel} onInput=${(e) => setResponsavel(e.target.value)} /></div>
      </div>
      <div class="linha-campos">
        <div><label>Emissão</label><input type="date" value=${emissao} onInput=${(e) => setEmissao(e.target.value)} /></div>
        <div><label>Validade</label><input type="date" value=${validade} onInput=${(e) => setValidade(e.target.value)} /></div>
      </div>
      <${CampoAnexo} valor=${arquivoUrl} onMudar=${setArquivoUrl} />
      <button class="botao" type="submit" disabled=${salvando} style="margin-top:10px;">${salvando ? "Salvando…" : "Adicionar documento"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelDocumentos({ documentos, onMudou }) {
  return html`
    <div class="colunas-financeiro">
      <div><${FormaDocumento} onSalvo=${onMudou} /></div>
      <div>
        <h3 class="titulo-lista">Documentos cadastrados</h3>
        ${!documentos.length && html`<p class="vazio">Nenhum documento cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${documentos.map((d) => html`
            <div class="item-conta" key=${d.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${d.nome}</span>
                ${d.validade ? html`<${ChipVencimento} data=${d.validade} />` : html`<span class="chip chip-neutro">Sem validade</span>`}
              </div>
              <div class="item-conta-meta">
                ${d.tipo.replace(/_/g, " ")}${d.numero ? ` · nº ${d.numero}` : ""}${d.responsavel ? ` · ${d.responsavel}` : ""}
                ${d.arquivo_url ? html` · <${LinkArquivo} caminho=${d.arquivo_url} />` : ""}
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function FormaContrato({ onSalvo }) {
  const [tipo, setTipo] = useState(TIPOS_CONTRATO[0]);
  const [contraparte, setContraparte] = useState("");
  const [inicio, setInicio] = useState("");
  const [termino, setTermino] = useState("");
  const [valor, setValor] = useState("");
  const [indiceReajuste, setIndiceReajuste] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!contraparte.trim() || !inicio) { setErro("Preencha a contraparte e a data de início."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("contrato").insert({
        estabelecimento_id, tipo, contraparte: contraparte.trim(), inicio, termino: termino || null,
        valor: valor ? Number(valor) : null, indice_reajuste: indiceReajuste.trim() || null, responsavel: responsavel.trim() || null,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setContraparte(""); setInicio(""); setTermino(""); setValor(""); setIndiceReajuste(""); setResponsavel("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo contrato</h3>
      <label>Tipo</label>
      <select value=${tipo} onChange=${(e) => setTipo(e.target.value)}>${TIPOS_CONTRATO.map((t) => html`<option value=${t}>${t.replace(/_/g, " ")}</option>`)}</select>
      <label>Contraparte</label>
      <input type="text" value=${contraparte} onInput=${(e) => setContraparte(e.target.value)} placeholder="Ex.: Imobiliária X" />
      <div class="linha-campos">
        <div><label>Início</label><input type="date" value=${inicio} onInput=${(e) => setInicio(e.target.value)} /></div>
        <div><label>Término</label><input type="date" value=${termino} onInput=${(e) => setTermino(e.target.value)} /></div>
      </div>
      <div class="linha-campos">
        <div><label>Valor (R$)</label><input type="number" step="0.01" min="0" value=${valor} onInput=${(e) => setValor(e.target.value)} /></div>
        <div><label>Índice de reajuste</label><input type="text" value=${indiceReajuste} onInput=${(e) => setIndiceReajuste(e.target.value)} placeholder="Ex.: IGPM" /></div>
      </div>
      <label>Responsável</label>
      <input type="text" value=${responsavel} onInput=${(e) => setResponsavel(e.target.value)} />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar contrato"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelContratos({ contratos, onMudou }) {
  return html`
    <div class="colunas-financeiro">
      <div><${FormaContrato} onSalvo=${onMudou} /></div>
      <div>
        <h3 class="titulo-lista">Contratos cadastrados</h3>
        ${!contratos.length && html`<p class="vazio">Nenhum contrato cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${contratos.map((c) => html`
            <div class="item-conta" key=${c.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${c.contraparte}</span>
                ${c.termino ? html`<${ChipVencimento} data=${c.termino} />` : html`<span class="chip chip-neutro">Sem prazo</span>`}
              </div>
              <div class="item-conta-meta">
                ${c.tipo.replace(/_/g, " ")}${c.valor ? ` · ${formatarMoeda(c.valor)}` : ""} · desde ${formatarData(c.inicio)}
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function FormaLembrete({ onSalvo }) {
  const [categoria, setCategoria] = useState("compliance");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [dataVencimento, setDataVencimento] = useState("");
  const [recorrencia, setRecorrencia] = useState("nenhuma");
  const [diasAviso, setDiasAviso] = useState("15");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!titulo.trim() || !dataVencimento) { setErro("Preencha o título e a data de vencimento."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("lembrete").insert({
        estabelecimento_id, categoria, titulo: titulo.trim(), descricao: descricao.trim() || null,
        data_vencimento: dataVencimento, recorrencia, dias_aviso_antecedencia: Number(diasAviso) || 0, status: "pendente",
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setTitulo(""); setDescricao(""); setDataVencimento("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo lembrete</h3>
      <label>Categoria</label>
      <select value=${categoria} onChange=${(e) => setCategoria(e.target.value)}>${CATEGORIAS_LEMBRETE.map((c) => html`<option value=${c.valor}>${c.rotulo}</option>`)}</select>
      <label>Título</label>
      <input type="text" value=${titulo} onInput=${(e) => setTitulo(e.target.value)} placeholder="Ex.: Vencimento do DAS" />
      <label>Descrição</label>
      <input type="text" value=${descricao} onInput=${(e) => setDescricao(e.target.value)} />
      <div class="linha-campos">
        <div><label>Data de vencimento</label><input type="date" value=${dataVencimento} onInput=${(e) => setDataVencimento(e.target.value)} /></div>
        <div><label>Recorrência</label><select value=${recorrencia} onChange=${(e) => setRecorrencia(e.target.value)}><option value="nenhuma">Nenhuma</option><option value="mensal">Mensal</option><option value="anual">Anual</option></select></div>
      </div>
      <label>Avisar com quantos dias de antecedência</label>
      <input type="number" min="0" value=${diasAviso} onInput=${(e) => setDiasAviso(e.target.value)} />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar lembrete"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelLembretes({ lembretes, onMudou }) {
  async function concluir(id) {
    await sb.from("lembrete").update({ status: "concluido", concluido_em: new Date().toISOString() }).eq("id", id);
    onMudou();
  }
  const pendentes = lembretes.filter((l) => l.status === "pendente").sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));
  const concluidos = lembretes.filter((l) => l.status === "concluido");

  return html`
    <div class="colunas-financeiro">
      <div><${FormaLembrete} onSalvo=${onMudou} /></div>
      <div>
        <h3 class="titulo-lista">Pendentes</h3>
        ${!pendentes.length && html`<p class="vazio">Nenhum lembrete pendente.</p>`}
        <div class="lista-contas">
          ${pendentes.map((l) => html`
            <div class="item-conta" key=${l.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${l.titulo}</span>
                <${ChipVencimento} data=${l.data_vencimento} />
              </div>
              <div class="item-conta-meta">${CATEGORIAS_LEMBRETE.find((c) => c.valor === l.categoria)?.rotulo || l.categoria}${l.descricao ? ` · ${l.descricao}` : ""}</div>
              <div class="item-conta-rodape" style="margin-top:6px;">
                <span></span>
                <button class="botao-pequeno" onClick=${() => concluir(l.id)}>Marcar concluído</button>
              </div>
            </div>
          `)}
        </div>
        ${concluidos.length > 0 && html`<p class="desc-form" style="margin-top:14px;">${concluidos.length} lembrete(s) concluído(s) no histórico.</p>`}
      </div>
    </div>
  `;
}

function FormaEquipamento({ onSalvo }) {
  const [nome, setNome] = useState("");
  const [patrimonio, setPatrimonio] = useState("");
  const [categoria, setCategoria] = useState("");
  const [dataCompra, setDataCompra] = useState("");
  const [valorCompra, setValorCompra] = useState("");
  const [garantiaAte, setGarantiaAte] = useState("");
  const [proximaRevisao, setProximaRevisao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Preencha o nome do equipamento."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("equipamento").insert({
        estabelecimento_id, nome: nome.trim(), patrimonio: patrimonio.trim() || null, categoria: categoria.trim() || null,
        data_compra: dataCompra || null, valor_compra: valorCompra ? Number(valorCompra) : null,
        garantia_ate: garantiaAte || null, proxima_revisao: proximaRevisao || null, observacoes: observacoes.trim() || null,
      });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome(""); setPatrimonio(""); setCategoria(""); setDataCompra(""); setValorCompra(""); setGarantiaAte(""); setProximaRevisao(""); setObservacoes("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo equipamento</h3>
      <label>Nome</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Câmara fria 2" />
      <div class="linha-campos">
        <div><label>Patrimônio / série</label><input type="text" value=${patrimonio} onInput=${(e) => setPatrimonio(e.target.value)} /></div>
        <div><label>Categoria</label><input type="text" value=${categoria} onInput=${(e) => setCategoria(e.target.value)} placeholder="Ex.: Refrigeração" /></div>
      </div>
      <div class="linha-campos">
        <div><label>Data de compra</label><input type="date" value=${dataCompra} onInput=${(e) => setDataCompra(e.target.value)} /></div>
        <div><label>Valor de compra (R$)</label><input type="number" step="0.01" min="0" value=${valorCompra} onInput=${(e) => setValorCompra(e.target.value)} /></div>
      </div>
      <div class="linha-campos">
        <div><label>Garantia até</label><input type="date" value=${garantiaAte} onInput=${(e) => setGarantiaAte(e.target.value)} /></div>
        <div><label>Próxima revisão</label><input type="date" value=${proximaRevisao} onInput=${(e) => setProximaRevisao(e.target.value)} /></div>
      </div>
      <label>Observações</label>
      <input type="text" value=${observacoes} onInput=${(e) => setObservacoes(e.target.value)} />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar equipamento"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function FormaManutencao({ equipamentoId, onSalvo }) {
  const [data, setData] = useState(hojeISO());
  const [tipo, setTipo] = useState("preventiva");
  const [descricao, setDescricao] = useState("");
  const [custo, setCusto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!descricao.trim()) { setErro("Descreva o serviço de manutenção."); return; }
    setSalvando(true);
    const r = await sb.from("manutencao_equipamento").insert({
      equipamento_id: equipamentoId, data, tipo, descricao: descricao.trim(), custo: custo ? Number(custo) : null,
    });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setDescricao(""); setCusto("");
    onSalvo();
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Registrar manutenção</h3>
      <div class="linha-campos">
        <div><label>Data</label><input type="date" value=${data} onInput=${(e) => setData(e.target.value)} /></div>
        <div><label>Tipo</label><select value=${tipo} onChange=${(e) => setTipo(e.target.value)}><option value="preventiva">Preventiva</option><option value="corretiva">Corretiva</option></select></div>
      </div>
      <label>Descrição</label>
      <input type="text" value=${descricao} onInput=${(e) => setDescricao(e.target.value)} placeholder="Ex.: Troca de gás e limpeza do condensador" />
      <label>Custo (R$)</label>
      <input type="number" step="0.01" min="0" value=${custo} onInput=${(e) => setCusto(e.target.value)} />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Registrar"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelManutencao() {
  const [equipamentos, setEquipamentos] = useState([]);
  const [manutencoes, setManutencoes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionadoId, setSelecionadoId] = useState(null);

  async function carregar() {
    const [eqRes, manRes] = await Promise.all([
      sb.from("equipamento").select("*").order("proxima_revisao", { ascending: true, nullsFirst: false }),
      sb.from("manutencao_equipamento").select("*").order("data", { ascending: false }),
    ]);
    setEquipamentos(eqRes.data || []);
    setManutencoes(manRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const selecionado = equipamentos.find((e) => e.id === selecionadoId) || null;
  const historicoSelecionado = manutencoes.filter((m) => m.equipamento_id === selecionadoId);

  return html`
    <div class="colunas-financeiro">
      <div>
        <${FormaEquipamento} onSalvo=${carregar} />
        <h3 class="titulo-lista">Equipamentos cadastrados</h3>
        ${!equipamentos.length && html`<p class="vazio">Nenhum equipamento cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${equipamentos.map((eq) => html`
            <div class="item-conta item-clicavel ${selecionadoId === eq.id ? "selecionado" : ""}" key=${eq.id} onClick=${() => setSelecionadoId(eq.id)}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${eq.nome}</span>
                ${eq.proxima_revisao ? html`<${ChipVencimento} data=${eq.proxima_revisao} />` : html`<span class="chip chip-neutro">Sem revisão agendada</span>`}
              </div>
              <div class="item-conta-meta">${eq.categoria || ""}${eq.patrimonio ? ` · ${eq.patrimonio}` : ""}</div>
            </div>
          `)}
        </div>
      </div>
      <div>
        ${!selecionado
          ? html`<p class="vazio">Clique em um equipamento à esquerda para ver ou registrar manutenções.</p>`
          : html`
            <h3 class="titulo-lista">Histórico — ${selecionado.nome}</h3>
            <${FormaManutencao} equipamentoId=${selecionado.id} onSalvo=${carregar} />
            ${!historicoSelecionado.length && html`<p class="vazio">Nenhuma manutenção registrada ainda.</p>`}
            <div class="lista-contas">
              ${historicoSelecionado.map((m) => html`
                <div class="item-conta" key=${m.id}>
                  <div class="item-conta-topo">
                    <span class="item-conta-desc">${m.tipo === "preventiva" ? "Preventiva" : "Corretiva"}</span>
                    ${m.custo ? html`<span class="item-conta-valor">${formatarMoeda(m.custo)}</span>` : ""}
                  </div>
                  <div class="item-conta-meta">${formatarData(m.data)}</div>
                  <p style="font-size:0.82rem; margin: 4px 0 0;">${m.descricao}</p>
                </div>
              `)}
            </div>
          `}
      </div>
    </div>
  `;
}

export default function Documentos() {
  const [aba, setAba] = useState("vencimentos");
  const [documentos, setDocumentos] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [lembretes, setLembretes] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const [docsRes, contratosRes, lembretesRes] = await Promise.all([
      sb.from("documento_empresa").select("*").order("validade", { ascending: true, nullsFirst: false }),
      sb.from("contrato").select("*").order("termino", { ascending: true, nullsFirst: false }),
      sb.from("lembrete").select("*"),
    ]);
    setDocumentos(docsRes.data || []);
    setContratos(contratosRes.data || []);
    setLembretes(lembretesRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  return html`
    <div>
      <h2>Documentos e fiscal</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "vencimentos" ? " ativo" : "")} onClick=${() => setAba("vencimentos")}>Vencimentos</button>
        <button class=${"sub-tab" + (aba === "documentos" ? " ativo" : "")} onClick=${() => setAba("documentos")}>Documentos</button>
        <button class=${"sub-tab" + (aba === "contratos" ? " ativo" : "")} onClick=${() => setAba("contratos")}>Contratos</button>
        <button class=${"sub-tab" + (aba === "lembretes" ? " ativo" : "")} onClick=${() => setAba("lembretes")}>Lembretes</button>
        <button class=${"sub-tab" + (aba === "manutencao" ? " ativo" : "")} onClick=${() => setAba("manutencao")}>Manutenção</button>
      </div>
      ${aba === "vencimentos" && html`<${PainelVencimentos} documentos=${documentos} contratos=${contratos} lembretes=${lembretes} />`}
      ${aba === "documentos" && html`<${PainelDocumentos} documentos=${documentos} onMudou=${carregar} />`}
      ${aba === "contratos" && html`<${PainelContratos} contratos=${contratos} onMudou=${carregar} />`}
      ${aba === "lembretes" && html`<${PainelLembretes} lembretes=${lembretes} onMudou=${carregar} />`}
      ${aba === "manutencao" && html`<${PainelManutencao} />`}
    </div>
  `;
}
