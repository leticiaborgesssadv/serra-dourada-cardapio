import { h } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb, formatarMoeda, formatarData, getEstabelecimentoId, hojeISO } from "../lib/supabase.js";

const html = htm.bind(h);

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

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
      <textarea rows="2" style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--borda);background:#1a1006;color:var(--texto);font-family:inherit;font-size:0.88rem;" value=${observacoes} onInput=${(e) => setObservacoes(e.target.value)}></textarea>
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

export default function RH() {
  const [aba, setAba] = useState("equipe");
  return html`
    <div>
      <h2>RH e equipe</h2>
      <div class="sub-tabs">
        <button class=${"sub-tab" + (aba === "equipe" ? " ativo" : "")} onClick=${() => setAba("equipe")}>Equipe</button>
        <button class=${"sub-tab" + (aba === "escala" ? " ativo" : "")} onClick=${() => setAba("escala")}>Escala</button>
        <button class=${"sub-tab" + (aba === "checklists" ? " ativo" : "")} onClick=${() => setAba("checklists")}>Checklists</button>
      </div>
      ${aba === "equipe" ? html`<${PainelEquipe} />` : aba === "escala" ? html`<${PainelEscala} />` : html`<${PainelChecklists} />`}
    </div>
  `;
}
