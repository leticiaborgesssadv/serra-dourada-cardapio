import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, formatarMoeda, formatarData, getEstabelecimentoId, hojeISO, diasAte, enviarAnexo, urlAssinadaAnexo, ehCaminhoArmazenado } from "../lib/supabase.js";

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

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const TIPOS_OCORRENCIA = [
  { valor: "advertencia", rotulo: "Advertência" },
  { valor: "suspensao", rotulo: "Suspensão" },
  { valor: "elogio", rotulo: "Elogio" },
  { valor: "atraso", rotulo: "Atraso" },
  { valor: "falta", rotulo: "Falta" },
  { valor: "acidente", rotulo: "Acidente de trabalho" },
  { valor: "outro", rotulo: "Outro" },
];
function chipOcorrencia(tipo) {
  if (tipo === "elogio") return "chip-ok";
  if (tipo === "advertencia" || tipo === "suspensao") return "chip-erro";
  if (tipo === "atraso" || tipo === "falta") return "chip-alerta";
  return "chip-neutro";
}
function somarAno(dataISO, anos) {
  const d = new Date(dataISO + "T00:00:00");
  d.setFullYear(d.getFullYear() + anos);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TIPOS_DOCUMENTO_FUNCIONARIO = [
  { valor: "rg", rotulo: "RG" },
  { valor: "cpf", rotulo: "CPF" },
  { valor: "ctps", rotulo: "CTPS" },
  { valor: "pis", rotulo: "PIS/PASEP" },
  { valor: "titulo_eleitor", rotulo: "Título de eleitor" },
  { valor: "comprovante_residencia", rotulo: "Comprovante de residência" },
  { valor: "aso_admissional", rotulo: "ASO admissional" },
  { valor: "aso_periodico", rotulo: "ASO periódico" },
  { valor: "aso_demissional", rotulo: "ASO demissional" },
  { valor: "certificado_curso", rotulo: "Certificado de curso" },
  { valor: "contrato_assinado", rotulo: "Contrato assinado" },
  { valor: "outro", rotulo: "Outro" },
];

function FormaDadosSensiveis({ funcionario, dadosExistentes, onSalvo }) {
  const [cpf, setCpf] = useState(dadosExistentes?.cpf || "");
  const [telefone, setTelefone] = useState(dadosExistentes?.telefone || "");
  const [dataAdmissao, setDataAdmissao] = useState(dadosExistentes?.data_admissao || "");
  const [salario, setSalario] = useState(dadosExistentes?.salario || "");
  const [jornada, setJornada] = useState(dadosExistentes?.jornada || "");
  const [contatoNome, setContatoNome] = useState(dadosExistentes?.contato_emergencia_nome || "");
  const [contatoTelefone, setContatoTelefone] = useState(dadosExistentes?.contato_emergencia_telefone || "");
  const [observacoes, setObservacoes] = useState(dadosExistentes?.observacoes || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [msgOk, setMsgOk] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro(""); setMsgOk("");
    setSalvando(true);
    try {
      const payload = {
        funcionario_id: funcionario.id,
        cpf: cpf.trim() || null,
        telefone: telefone.trim() || null,
        data_admissao: dataAdmissao || null,
        salario: salario === "" ? null : Number(salario),
        jornada: jornada.trim() || null,
        contato_emergencia_nome: contatoNome.trim() || null,
        contato_emergencia_telefone: contatoTelefone.trim() || null,
        observacoes: observacoes.trim() || null,
      };
      const r = await sb.from("funcionario_dados_rh").upsert(payload, { onConflict: "funcionario_id" });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setMsgOk("Salvo. Alterações ficam registradas no log de auditoria.");
      onSalvo();
    } catch (e) {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Dados de RH — ${funcionario.nome}</h3>
      <p class="desc-form">Informação sensível. Visível só para gerência, e toda alteração fica registrada (quem, quando, valor anterior e novo).</p>
      <div class="linha-campos">
        <div><label>CPF</label><input type="text" value=${cpf} onInput=${(e) => setCpf(e.target.value)} /></div>
        <div><label>Telefone</label><input type="text" value=${telefone} onInput=${(e) => setTelefone(e.target.value)} /></div>
      </div>
      <div class="linha-campos">
        <div><label>Data de admissão</label><input type="date" value=${dataAdmissao} onInput=${(e) => setDataAdmissao(e.target.value)} /></div>
        <div><label>Salário (R$)</label><input type="number" step="0.01" min="0" value=${salario} onInput=${(e) => setSalario(e.target.value)} /></div>
      </div>
      <label>Jornada</label>
      <input type="text" value=${jornada} onInput=${(e) => setJornada(e.target.value)} placeholder="Ex.: 44h semanais, escala 6x1" />
      <div class="linha-campos">
        <div><label>Contato de emergência — nome</label><input type="text" value=${contatoNome} onInput=${(e) => setContatoNome(e.target.value)} /></div>
        <div><label>Contato de emergência — telefone</label><input type="text" value=${contatoTelefone} onInput=${(e) => setContatoTelefone(e.target.value)} /></div>
      </div>
      <label>Observações</label>
      <textarea rows="2" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--borda);background:var(--fundo-input);color:var(--texto);font-family:inherit;font-size:0.88rem;" value=${observacoes} onInput=${(e) => setObservacoes(e.target.value)}></textarea>
      <button class="botao" type="submit" disabled=${salvando} style="margin-top:10px;">${salvando ? "Salvando…" : "Salvar dados de RH"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
      ${msgOk && html`<div style="color: var(--sucesso); font-size: 0.8rem; margin-top: 6px;">${msgOk}</div>`}
    </form>
  `;
}

function PainelEquipe() {
  const [funcionarios, setFuncionarios] = useState([]);
  const [dadosRh, setDadosRh] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [selecionadoId, setSelecionadoId] = useState(null);

  async function carregar() {
    const [funcRes, rhRes] = await Promise.all([
      sb.from("funcionario").select("id,nome,papel,ativo,email,user_id").order("papel").order("nome"),
      sb.from("funcionario_dados_rh").select("*"),
    ]);
    setFuncionarios(funcRes.data || []);
    setDadosRh(rhRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const rhPorFuncionario = useMemo(() => Object.fromEntries(dadosRh.map((r) => [r.funcionario_id, r])), [dadosRh]);
  const selecionado = funcionarios.find((f) => f.id === selecionadoId) || null;

  if (carregando) return html`<p class="vazio">Carregando equipe…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div>
        <h3 class="titulo-lista">Equipe</h3>
        <div class="lista-contas">
          ${funcionarios.map((f) => {
            const temRh = !!rhPorFuncionario[f.id];
            return html`
              <div class="item-conta item-clicavel ${selecionadoId === f.id ? "selecionado" : ""}" key=${f.id} onClick=${() => setSelecionadoId(f.id)}>
                <div class="item-conta-topo">
                  <span class="item-conta-desc">${f.nome}</span>
                  ${temRh ? html`<span class="chip chip-ok">Cadastro OK</span>` : html`<span class="chip chip-neutro">Sem dados de RH</span>`}
                </div>
                <div class="item-conta-meta">${f.papel}${f.ativo ? "" : " · inativo"}</div>
              </div>
            `;
          })}
        </div>
      </div>
      <div>
        ${selecionado
          ? html`<${FormaDadosSensiveis} funcionario=${selecionado} dadosExistentes=${rhPorFuncionario[selecionado.id]} onSalvo=${carregar} />`
          : html`<p class="vazio">Clique em um funcionário à esquerda para ver ou editar os dados de RH.</p>`}
      </div>
    </div>
  `;
}

function PainelEscala() {
  const [funcionarios, setFuncionarios] = useState([]);
  const [escala, setEscala] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [funcionarioId, setFuncionarioId] = useState("");
  const [diaSemana, setDiaSemana] = useState("1");
  const [turno, setTurno] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function carregar() {
    const [funcRes, escalaRes] = await Promise.all([
      sb.from("funcionario").select("id,nome,papel").eq("ativo", true).order("nome"),
      sb.from("escala").select("*"),
    ]);
    setFuncionarios(funcRes.data || []);
    setEscala(escalaRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const funcionariosPorId = useMemo(() => Object.fromEntries(funcionarios.map((f) => [f.id, f.nome])), [funcionarios]);

  async function adicionar(ev) {
    ev.preventDefault();
    setErro("");
    if (!funcionarioId || !turno.trim()) { setErro("Selecione o funcionário e informe o turno."); return; }
    setSalvando(true);
    const r = await sb.from("escala").insert({ funcionario_id: funcionarioId, dia_semana: Number(diaSemana), turno: turno.trim() });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setTurno("");
    carregar();
  }

  async function remover(id) {
    if (!confirm("Remover este turno da escala?")) return;
    await sb.from("escala").delete().eq("id", id);
    carregar();
  }

  if (carregando) return html`<p class="vazio">Carregando escala…</p>`;

  return html`
    <div class="colunas-financeiro">
      <div>
        <form class="card" onSubmit=${adicionar}>
          <h3>Adicionar turno</h3>
          <label>Funcionário</label>
          <select value=${funcionarioId} onChange=${(e) => setFuncionarioId(e.target.value)}>
            <option value="">Selecione…</option>
            ${funcionarios.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
          </select>
          <div class="linha-campos">
            <div>
              <label>Dia da semana</label>
              <select value=${diaSemana} onChange=${(e) => setDiaSemana(e.target.value)}>
                ${DIAS.map((d, i) => html`<option value=${i}>${d}</option>`)}
              </select>
            </div>
            <div><label>Turno</label><input type="text" value=${turno} onInput=${(e) => setTurno(e.target.value)} placeholder="Ex.: Jantar 18h-23h" /></div>
          </div>
          <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar à escala"}</button>
          ${erro && html`<div class="msg-erro">${erro}</div>`}
        </form>
      </div>
      <div>
        <h3 class="titulo-lista">Escala da semana</h3>
        ${DIAS.map((dia, i) => {
          const doDia = escala.filter((e) => e.dia_semana === i);
          if (!doDia.length) return null;
          return html`
            <div class="card" key=${i} style="padding: 12px 16px;">
              <h3 style="margin-bottom: 8px;">${dia}</h3>
              <div class="lista-contas">
                ${doDia.map((e) => html`
                  <div class="item-conta" key=${e.id}>
                    <div class="item-conta-rodape">
                      <span>${funcionariosPorId[e.funcionario_id] || "?"} — ${e.turno}</span>
                      <button class="botao-secundario-pequeno" onClick=${() => remover(e.id)}>Remover</button>
                    </div>
                  </div>
                `)}
              </div>
            </div>
          `;
        })}
        ${!escala.length && html`<p class="vazio">Nenhum turno cadastrado ainda.</p>`}
      </div>
    </div>
  `;
}

function FormaChecklistItem({ ordemSeguinte, onSalvo }) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!nome.trim()) { setErro("Descreva o item do checklist."); return; }
    setSalvando(true);
    try {
      const estabelecimento_id = await getEstabelecimentoId();
      const r = await sb.from("checklist_item").insert({ estabelecimento_id, nome: nome.trim(), ativo: true, ordem: ordemSeguinte });
      if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
      setNome("");
      onSalvo();
    } catch (e) { setErro("Erro de conexão."); }
    finally { setSalvando(false); }
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo item de checklist</h3>
      <label>Descrição</label>
      <input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: Salão limpo e organizado" />
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar item"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelChecklists() {
  const [itens, setItens] = useState([]);
  const [execucoesHoje, setExecucoesHoje] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [funcionarioId, setFuncionarioId] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [processandoId, setProcessandoId] = useState(null);

  async function carregar() {
    const hoje = hojeISO();
    const [itensRes, execRes, funcRes] = await Promise.all([
      sb.from("checklist_item").select("*").eq("ativo", true).order("ordem"),
      sb.from("checklist_execucao").select("*").eq("data", hoje),
      sb.from("funcionario").select("id,nome").eq("ativo", true).order("nome"),
    ]);
    setItens(itensRes.data || []);
    setExecucoesHoje(execRes.data || []);
    setFuncionarios(funcRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function marcar(itemId, conforme) {
    setProcessandoId(itemId);
    await sb.from("checklist_execucao").insert({
      checklist_item_id: itemId, data: hojeISO(), conforme, funcionario_id: funcionarioId || null,
    });
    setProcessandoId(null);
    carregar();
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const execucoesPorItem = Object.fromEntries(execucoesHoje.map((e) => [e.checklist_item_id, e]));
  const ordemSeguinte = itens.length ? Math.max(...itens.map((i) => i.ordem)) + 1 : 1;

  return html`
    <div class="colunas-financeiro">
      <div><${FormaChecklistItem} ordemSeguinte=${ordemSeguinte} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Execução de hoje</h3>
        <label style="max-width: 260px;">Quem está executando</label>
        <select style="max-width: 260px;" value=${funcionarioId} onChange=${(e) => setFuncionarioId(e.target.value)}>
          <option value="">— não informar —</option>
          ${funcionarios.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
        </select>
        ${!itens.length && html`<p class="vazio">Nenhum item de checklist cadastrado ainda.</p>`}
        <div class="lista-contas" style="margin-top: 10px;">
          ${itens.map((item) => {
            const exec = execucoesPorItem[item.id];
            return html`
              <div class="item-conta" key=${item.id}>
                <div class="item-conta-topo">
                  <span class="item-conta-desc">${item.nome}</span>
                  ${exec
                    ? html`<span class="chip ${exec.conforme ? "chip-ok" : "chip-erro"}">${exec.conforme ? "Conforme" : "Não conforme"}</span>`
                    : html`<span class="chip chip-neutro">Pendente</span>`}
                </div>
                ${!exec && html`
                  <div class="linha-botoes" style="margin-top:8px; display:flex; gap:8px;">
                    <button class="botao-pequeno" disabled=${processandoId === item.id} onClick=${() => marcar(item.id, true)}>Conforme</button>
                    <button class="botao-secundario-pequeno" disabled=${processandoId === item.id} onClick=${() => marcar(item.id, false)}>Não conforme</button>
                  </div>
                `}
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}

function FormaFerias({ funcionarios, onSalvo }) {
  const [funcionarioId, setFuncionarioId] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [limite, setLimite] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  function aoMudarFim(valor) {
    setFim(valor);
    if (valor) setLimite(somarAno(valor, 1));
  }

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!funcionarioId || !inicio || !fim || !limite) { setErro("Preencha funcionário e as datas do período aquisitivo."); return; }
    setSalvando(true);
    const r = await sb.from("funcionario_ferias").insert({
      funcionario_id: funcionarioId, periodo_aquisitivo_inicio: inicio, periodo_aquisitivo_fim: fim, limite_para_gozo: limite,
    });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setFuncionarioId(""); setInicio(""); setFim(""); setLimite("");
    onSalvo();
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo período aquisitivo de férias</h3>
      <label>Funcionário</label>
      <select value=${funcionarioId} onChange=${(e) => setFuncionarioId(e.target.value)}>
        <option value="">Selecione…</option>
        ${funcionarios.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
      </select>
      <div class="linha-campos">
        <div><label>Início do período aquisitivo</label><input type="date" value=${inicio} onInput=${(e) => setInicio(e.target.value)} /></div>
        <div><label>Fim do período aquisitivo</label><input type="date" value=${fim} onInput=${(e) => aoMudarFim(e.target.value)} /></div>
      </div>
      <label>Prazo limite para gozo</label>
      <input type="date" value=${limite} onInput=${(e) => setLimite(e.target.value)} />
      <p class="desc-form">Sugerido automaticamente como 1 ano após o fim do período aquisitivo (prazo legal); pode ajustar.</p>
      <button class="botao" type="submit" disabled=${salvando}>${salvando ? "Salvando…" : "Adicionar período"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function ItemFerias({ item, nomeFuncionario, onMudou }) {
  const [programando, setProgramando] = useState(false);
  const [dataInicioGozo, setDataInicioGozo] = useState(item.data_inicio_gozo || "");
  const [dataFimGozo, setDataFimGozo] = useState(item.data_fim_gozo || "");
  const [salvando, setSalvando] = useState(false);

  async function programar() {
    if (!dataInicioGozo || !dataFimGozo) return;
    setSalvando(true);
    await sb.from("funcionario_ferias").update({ data_inicio_gozo: dataInicioGozo, data_fim_gozo: dataFimGozo, status: "programada" }).eq("id", item.id);
    setSalvando(false);
    setProgramando(false);
    onMudou();
  }
  async function concluir() {
    setSalvando(true);
    await sb.from("funcionario_ferias").update({ status: "gozada" }).eq("id", item.id);
    setSalvando(false);
    onMudou();
  }

  const dias = diasAte(item.limite_para_gozo);
  const chip = item.status === "gozada" ? html`<span class="chip chip-ok">Gozada</span>`
    : item.status === "programada" ? html`<span class="chip chip-neutro">Programada</span>`
    : dias < 0 ? html`<span class="chip chip-erro">Prazo vencido há ${Math.abs(dias)}d</span>`
    : dias <= 60 ? html`<span class="chip chip-alerta">Prazo em ${dias}d</span>`
    : html`<span class="chip chip-neutro">Pendente</span>`;

  return html`
    <div class="item-conta">
      <div class="item-conta-topo">
        <span class="item-conta-desc">${nomeFuncionario}</span>
        ${chip}
      </div>
      <div class="item-conta-meta">
        Aquisitivo ${formatarData(item.periodo_aquisitivo_inicio)} – ${formatarData(item.periodo_aquisitivo_fim)} · limite ${formatarData(item.limite_para_gozo)}
        ${item.data_inicio_gozo ? html` · gozo ${formatarData(item.data_inicio_gozo)} – ${formatarData(item.data_fim_gozo)}` : ""}
      </div>
      ${item.status === "pendente" && !programando && html`<button class="botao-pequeno" onClick=${() => setProgramando(true)}>Programar</button>`}
      ${item.status === "pendente" && programando && html`
        <div class="linha-campos" style="margin-top:8px;">
          <div><label>Início do gozo</label><input type="date" value=${dataInicioGozo} onInput=${(e) => setDataInicioGozo(e.target.value)} /></div>
          <div><label>Fim do gozo</label><input type="date" value=${dataFimGozo} onInput=${(e) => setDataFimGozo(e.target.value)} /></div>
        </div>
        <button class="botao-pequeno" disabled=${salvando} onClick=${programar}>Confirmar</button>
      `}
      ${item.status === "programada" && html`<button class="botao-pequeno" disabled=${salvando} onClick=${concluir}>Marcar como gozada</button>`}
    </div>
  `;
}

function PainelFerias() {
  const [funcionarios, setFuncionarios] = useState([]);
  const [ferias, setFerias] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const [funcRes, feriasRes] = await Promise.all([
      sb.from("funcionario").select("id,nome").eq("ativo", true).order("nome"),
      sb.from("funcionario_ferias").select("*").order("limite_para_gozo"),
    ]);
    setFuncionarios(funcRes.data || []);
    setFerias(feriasRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const nomesPorId = Object.fromEntries(funcionarios.map((f) => [f.id, f.nome]));

  return html`
    <div class="colunas-financeiro">
      <div><${FormaFerias} funcionarios=${funcionarios} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Períodos de férias</h3>
        ${!ferias.length && html`<p class="vazio">Nenhum período de férias cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${ferias.map((f) => html`<${ItemFerias} key=${f.id} item=${f} nomeFuncionario=${nomesPorId[f.funcionario_id] || "?"} onMudou=${carregar} />`)}
        </div>
      </div>
    </div>
  `;
}

function FormaOcorrencia({ funcionarios, onSalvo }) {
  const [funcionarioId, setFuncionarioId] = useState("");
  const [tipo, setTipo] = useState(TIPOS_OCORRENCIA[0].valor);
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(hojeISO());
  const [anexoUrl, setAnexoUrl] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!funcionarioId || !descricao.trim()) { setErro("Selecione o funcionário e descreva a ocorrência."); return; }
    setSalvando(true);
    const r = await sb.from("funcionario_ocorrencia").insert({
      funcionario_id: funcionarioId, tipo, descricao: descricao.trim(), data, anexo_url: anexoUrl.trim() || null,
    });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setDescricao(""); setAnexoUrl("");
    onSalvo();
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Nova ocorrência</h3>
      <p class="desc-form">Registro fica no histórico permanente do funcionário e no log de auditoria — não pode ser editado ou apagado depois de salvo.</p>
      <label>Funcionário</label>
      <select value=${funcionarioId} onChange=${(e) => setFuncionarioId(e.target.value)}>
        <option value="">Selecione…</option>
        ${funcionarios.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
      </select>
      <div class="linha-campos">
        <div><label>Tipo</label><select value=${tipo} onChange=${(e) => setTipo(e.target.value)}>${TIPOS_OCORRENCIA.map((t) => html`<option value=${t.valor}>${t.rotulo}</option>`)}</select></div>
        <div><label>Data</label><input type="date" value=${data} onInput=${(e) => setData(e.target.value)} /></div>
      </div>
      <label>Descrição</label>
      <textarea rows="3" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--borda);background:var(--fundo-input);color:var(--texto);font-family:inherit;font-size:0.88rem;" value=${descricao} onInput=${(e) => setDescricao(e.target.value)}></textarea>
      <div style="margin-top:11px;"><${CampoAnexo} valor=${anexoUrl} onMudar=${setAnexoUrl} /></div>
      <button class="botao" type="submit" disabled=${salvando} style="margin-top:10px;">${salvando ? "Salvando…" : "Registrar ocorrência"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelOcorrencias() {
  const [funcionarios, setFuncionarios] = useState([]);
  const [ocorrencias, setOcorrencias] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const [funcRes, ocoRes] = await Promise.all([
      sb.from("funcionario").select("id,nome").eq("ativo", true).order("nome"),
      sb.from("funcionario_ocorrencia").select("*").order("data", { ascending: false }),
    ]);
    setFuncionarios(funcRes.data || []);
    setOcorrencias(ocoRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const nomesPorId = Object.fromEntries(funcionarios.map((f) => [f.id, f.nome]));

  return html`
    <div class="colunas-financeiro">
      <div><${FormaOcorrencia} funcionarios=${funcionarios} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Histórico</h3>
        ${!ocorrencias.length && html`<p class="vazio">Nenhuma ocorrência registrada ainda.</p>`}
        <div class="lista-contas">
          ${ocorrencias.map((o) => html`
            <div class="item-conta" key=${o.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${nomesPorId[o.funcionario_id] || "?"}</span>
                <span class="chip ${chipOcorrencia(o.tipo)}">${TIPOS_OCORRENCIA.find((t) => t.valor === o.tipo)?.rotulo || o.tipo}</span>
              </div>
              <div class="item-conta-meta">${formatarData(o.data)}</div>
              <p style="font-size:0.82rem; margin: 4px 0 0;">${o.descricao}</p>
              ${o.anexo_url && html`<p style="margin: 4px 0 0;"><${LinkArquivo} caminho=${o.anexo_url} /></p>`}
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function FormaUniforme({ funcionarios, onSalvo }) {
  const [funcionarioId, setFuncionarioId] = useState("");
  const [item, setItem] = useState("");
  const [tamanho, setTamanho] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [dataEntrega, setDataEntrega] = useState(hojeISO());
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!funcionarioId || !item.trim()) { setErro("Selecione o funcionário e informe o item."); return; }
    setSalvando(true);
    const r = await sb.from("funcionario_uniforme").insert({
      funcionario_id: funcionarioId, item: item.trim(), tamanho: tamanho.trim() || null,
      quantidade: Number(quantidade) || 1, data_entrega: dataEntrega, observacoes: observacoes.trim() || null,
    });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setItem(""); setTamanho(""); setQuantidade("1"); setObservacoes("");
    onSalvo();
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Nova entrega de uniforme</h3>
      <label>Funcionário</label>
      <select value=${funcionarioId} onChange=${(e) => setFuncionarioId(e.target.value)}>
        <option value="">Selecione…</option>
        ${funcionarios.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
      </select>
      <label>Item</label>
      <input type="text" value=${item} onInput=${(e) => setItem(e.target.value)} placeholder="Ex.: Camisa polo, avental, tênis" />
      <div class="linha-campos">
        <div><label>Tamanho</label><input type="text" value=${tamanho} onInput=${(e) => setTamanho(e.target.value)} placeholder="Ex.: M, 40" /></div>
        <div><label>Quantidade</label><input type="number" min="1" value=${quantidade} onInput=${(e) => setQuantidade(e.target.value)} /></div>
      </div>
      <label>Data de entrega</label>
      <input type="date" value=${dataEntrega} onInput=${(e) => setDataEntrega(e.target.value)} />
      <label>Observações</label>
      <input type="text" value=${observacoes} onInput=${(e) => setObservacoes(e.target.value)} />
      <button class="botao" type="submit" disabled=${salvando} style="margin-top:10px;">${salvando ? "Salvando…" : "Registrar entrega"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelUniformes() {
  const [funcionarios, setFuncionarios] = useState([]);
  const [uniformes, setUniformes] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const [funcRes, uniRes] = await Promise.all([
      sb.from("funcionario").select("id,nome").eq("ativo", true).order("nome"),
      sb.from("funcionario_uniforme").select("*").order("data_entrega", { ascending: false }),
    ]);
    setFuncionarios(funcRes.data || []);
    setUniformes(uniRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function remover(id) {
    if (!confirm("Remover este registro de uniforme?")) return;
    await sb.from("funcionario_uniforme").delete().eq("id", id);
    carregar();
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const nomesPorId = Object.fromEntries(funcionarios.map((f) => [f.id, f.nome]));

  return html`
    <div class="colunas-financeiro">
      <div><${FormaUniforme} funcionarios=${funcionarios} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Entregas registradas</h3>
        ${!uniformes.length && html`<p class="vazio">Nenhuma entrega registrada ainda.</p>`}
        <div class="lista-contas">
          ${uniformes.map((u) => html`
            <div class="item-conta" key=${u.id}>
              <div class="item-conta-topo">
                <span class="item-conta-desc">${nomesPorId[u.funcionario_id] || "?"} — ${u.item}</span>
                <span class="chip chip-neutro">${u.quantidade}x${u.tamanho ? ` · ${u.tamanho}` : ""}</span>
              </div>
              <div class="item-conta-meta">${formatarData(u.data_entrega)}${u.observacoes ? ` · ${u.observacoes}` : ""}</div>
              <div class="item-conta-rodape" style="margin-top:6px;">
                <span></span>
                <button class="botao-secundario-pequeno" onClick=${() => remover(u.id)}>Remover</button>
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

function FormaDocumentoFuncionario({ funcionarios, onSalvo }) {
  const [funcionarioId, setFuncionarioId] = useState("");
  const [tipo, setTipo] = useState(TIPOS_DOCUMENTO_FUNCIONARIO[0].valor);
  const [nome, setNome] = useState("");
  const [validade, setValidade] = useState("");
  const [arquivoUrl, setArquivoUrl] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(ev) {
    ev.preventDefault();
    setErro("");
    if (!funcionarioId || !nome.trim()) { setErro("Selecione o funcionário e preencha o nome do documento."); return; }
    setSalvando(true);
    const r = await sb.from("funcionario_documento").insert({
      funcionario_id: funcionarioId, tipo, nome: nome.trim(), validade: validade || null, arquivo_url: arquivoUrl.trim() || null,
    });
    setSalvando(false);
    if (r.error) { setErro("Não foi possível salvar: " + r.error.message); return; }
    setNome(""); setValidade(""); setArquivoUrl("");
    onSalvo();
  }

  return html`
    <form class="card" onSubmit=${salvar}>
      <h3>Novo documento</h3>
      <label>Funcionário</label>
      <select value=${funcionarioId} onChange=${(e) => setFuncionarioId(e.target.value)}>
        <option value="">Selecione…</option>
        ${funcionarios.map((f) => html`<option value=${f.id}>${f.nome}</option>`)}
      </select>
      <div class="linha-campos">
        <div><label>Tipo</label><select value=${tipo} onChange=${(e) => setTipo(e.target.value)}>${TIPOS_DOCUMENTO_FUNCIONARIO.map((t) => html`<option value=${t.valor}>${t.rotulo}</option>`)}</select></div>
        <div><label>Nome</label><input type="text" value=${nome} onInput=${(e) => setNome(e.target.value)} placeholder="Ex.: ASO periódico 2026" /></div>
      </div>
      <label>Validade (se houver)</label>
      <input type="date" value=${validade} onInput=${(e) => setValidade(e.target.value)} />
      <${CampoAnexo} valor=${arquivoUrl} onMudar=${setArquivoUrl} />
      <button class="botao" type="submit" disabled=${salvando} style="margin-top:10px;">${salvando ? "Salvando…" : "Adicionar documento"}</button>
      ${erro && html`<div class="msg-erro">${erro}</div>`}
    </form>
  `;
}

function PainelDocumentosFuncionario() {
  const [funcionarios, setFuncionarios] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const [funcRes, docRes] = await Promise.all([
      sb.from("funcionario").select("id,nome").eq("ativo", true).order("nome"),
      sb.from("funcionario_documento").select("*").order("validade", { ascending: true, nullsFirst: false }),
    ]);
    setFuncionarios(funcRes.data || []);
    setDocumentos(docRes.data || []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function remover(id) {
    if (!confirm("Remover este documento? O arquivo anexado também deixará de ser acessível por aqui.")) return;
    await sb.from("funcionario_documento").delete().eq("id", id);
    carregar();
  }

  if (carregando) return html`<p class="vazio">Carregando…</p>`;

  const nomesPorId = Object.fromEntries(funcionarios.map((f) => [f.id, f.nome]));

  return html`
    <div class="colunas-financeiro">
      <div><${FormaDocumentoFuncionario} funcionarios=${funcionarios} onSalvo=${carregar} /></div>
      <div>
        <h3 class="titulo-lista">Documentos cadastrados</h3>
        ${!documentos.length && html`<p class="vazio">Nenhum documento cadastrado ainda.</p>`}
        <div class="lista-contas">
          ${documentos.map((d) => {
            const dias = d.validade ? diasAte(d.validade) : null;
            const chip = !d.validade ? html`<span class="chip chip-neutro">Sem validade</span>`
              : dias < 0 ? html`<span class="chip chip-erro">Vencido há ${Math.abs(dias)}d</span>`
              : dias <= 30 ? html`<span class="chip chip-alerta">Vence em ${dias}d</span>`
              : html`<span class="chip chip-neutro">Vence ${formatarData(d.validade)}</span>`;
            return html`
              <div class="item-conta" key=${d.id}>
                <div class="item-conta-topo">
                  <span class="item-conta-desc">${nomesPorId[d.funcionario_id] || "?"} — ${d.nome}</span>
                  ${chip}
                </div>
                <div class="item-conta-meta">
                  ${TIPOS_DOCUMENTO_FUNCIONARIO.find((t) => t.valor === d.tipo)?.rotulo || d.tipo}
                  ${d.arquivo_url ? html` · <${LinkArquivo} caminho=${d.arquivo_url} />` : ""}
                </div>
                <div class="item-conta-rodape" style="margin-top:6px;">
                  <span></span>
                  <button class="botao-secundario-pequeno" onClick=${() => remover(d.id)}>Remover</button>
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}

export default function RH() {
  const [aba, setAba] = useState("equipe");
  return html`
    <div>
      <h2>RH e equipe</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "equipe" ? " ativo" : "")} onClick=${() => setAba("equipe")}>Equipe</button>
        <button class=${"sub-tab" + (aba === "escala" ? " ativo" : "")} onClick=${() => setAba("escala")}>Escala</button>
        <button class=${"sub-tab" + (aba === "checklists" ? " ativo" : "")} onClick=${() => setAba("checklists")}>Checklists</button>
        <button class=${"sub-tab" + (aba === "ferias" ? " ativo" : "")} onClick=${() => setAba("ferias")}>Férias</button>
        <button class=${"sub-tab" + (aba === "ocorrencias" ? " ativo" : "")} onClick=${() => setAba("ocorrencias")}>Ocorrências</button>
        <button class=${"sub-tab" + (aba === "uniformes" ? " ativo" : "")} onClick=${() => setAba("uniformes")}>Uniformes</button>
        <button class=${"sub-tab" + (aba === "documentos" ? " ativo" : "")} onClick=${() => setAba("documentos")}>Documentos</button>
      </div>
      ${aba === "equipe" && html`<${PainelEquipe} />`}
      ${aba === "escala" && html`<${PainelEscala} />`}
      ${aba === "checklists" && html`<${PainelChecklists} />`}
      ${aba === "ferias" && html`<${PainelFerias} />`}
      ${aba === "ocorrencias" && html`<${PainelOcorrencias} />`}
      ${aba === "uniformes" && html`<${PainelUniformes} />`}
      ${aba === "documentos" && html`<${PainelDocumentosFuncionario} />`}
    </div>
  `;
}
