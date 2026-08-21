import { h, render } from "https://esm.sh/preact@10.19.6";
import { useState, useEffect } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { sb } from "./lib/supabase.js";

const html = htm.bind(h);

const VERSAO_CACHE = "10";

const MODULOS = [
  { rota: "financeiro", rotulo: "Financeiro", pronto: true },
  { rota: "estoque", rotulo: "Estoque e CMV", pronto: true },
  { rota: "compras", rotulo: "Compras e fornecedores", pronto: true },
  { rota: "vendas", rotulo: "Vendas e Colibri", pronto: true },
  { rota: "dashboard", rotulo: "Dashboard", pronto: true },
  { rota: "rh", rotulo: "RH e equipe", pronto: true },
  { rota: "documentos", rotulo: "Documentos e fiscal", pronto: true },
  { rota: "marketing", rotulo: "Marketing e CRM", pronto: true },
  { rota: "metas", rotulo: "Metas e orçamento", pronto: false },
];

function lerRota() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash || "financeiro";
}

function EmConstrucao({ rotulo }) {
  return html`<div class="em-construcao"><h2>${rotulo}</h2><p>Este módulo ainda não foi construído. Fale com o Claude para priorizá-lo.</p></div>`;
}

function Nav({ rotaAtual, nomeUsuario, onSair }) {
  return html`
    <nav class="gestao-nav">
      <div class="gestao-nav-topo">
        <div class="gestao-nav-titulo">Serra Dourada<span>gestão</span></div>
      </div>
      <div class="gestao-nav-links">
        ${MODULOS.map((m) => html`
          <a href="#/${m.rota}" class=${"gestao-nav-link" + (rotaAtual === m.rota ? " ativo" : "") + (!m.pronto ? " desabilitado" : "")}>
            ${m.rotulo}
          </a>
        `)}
      </div>
      <div class="gestao-nav-rodape">
        <div class="gestao-nav-usuario">${nomeUsuario}</div>
        <button class="botao-secundario-pequeno" onClick=${onSair}>Sair</button>
      </div>
    </nav>
  `;
}

function App() {
  const [sessao, setSessao] = useState(undefined);
  const [funcionario, setFuncionario] = useState(null);
  const [checandoAcesso, setChecandoAcesso] = useState(false);
  const [rota, setRota] = useState(lerRota());
  const [modulo, setModulo] = useState(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroLogin, setErroLogin] = useState("");
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then((r) => setSessao(r.data.session || null));
    const { data: sub } = sb.auth.onAuthStateChange((_ev, s) => setSessao(s));
    const aoMudarHash = () => setRota(lerRota());
    window.addEventListener("hashchange", aoMudarHash);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener("hashchange", aoMudarHash); };
  }, []);

  useEffect(() => {
    if (!sessao) { setFuncionario(null); return; }
    setChecandoAcesso(true);
    sb.from("funcionario").select("id,nome,papel,ativo").eq("user_id", sessao.user.id).maybeSingle()
      .then((r) => setFuncionario(r.data || false))
      .finally(() => setChecandoAcesso(false));
  }, [sessao]);

  useEffect(() => {
    const def = MODULOS.find((m) => m.rota === rota);
    if (!def || !def.pronto) { setModulo(() => null); return; }
    import(`./modules/${def.rota}.js?v=${VERSAO_CACHE}`).then((mod) => setModulo(() => mod.default));
  }, [rota]);

  async function entrar(ev) {
    ev.preventDefault();
    setErroLogin("");
    setEntrando(true);
    try {
      const r = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (r.error) setErroLogin("Não foi possível entrar: verifique e-mail e senha.");
    } catch (e) {
      setErroLogin("Erro de conexão. Tente novamente.");
    } finally {
      setEntrando(false);
    }
  }

  async function sair() {
    await sb.auth.signOut();
  }

  if (sessao === undefined) return html`<div class="tela-centro"><p>Carregando…</p></div>`;

  if (!sessao) {
    return html`
      <div class="tela-centro">
        <form class="card card-login" onSubmit=${entrar}>
          <h2>Serra Dourada · Gestão</h2>
          <p class="desc">Acesso restrito à gerência.</p>
          <label>E-mail</label>
          <input type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} autocomplete="username" />
          <label>Senha</label>
          <input type="password" value=${senha} onInput=${(e) => setSenha(e.target.value)} autocomplete="current-password" />
          <button class="botao" type="submit" disabled=${entrando}>${entrando ? "Entrando…" : "Entrar"}</button>
          ${erroLogin && html`<div class="msg-erro">${erroLogin}</div>`}
        </form>
      </div>
    `;
  }

  if (checandoAcesso || funcionario === null) {
    return html`<div class="tela-centro"><p>Verificando acesso…</p></div>`;
  }

  if (!funcionario || funcionario.papel !== "gerencia" || !funcionario.ativo) {
    return html`
      <div class="tela-centro">
        <div class="card">
          <h2>Acesso restrito</h2>
          <p class="desc">Este painel é de uso exclusivo da gerência. Se você acredita que deveria ter acesso, fale com a administradora.</p>
          <button class="botao-secundario" onClick=${sair}>Sair</button>
        </div>
      </div>
    `;
  }

  const def = MODULOS.find((m) => m.rota === rota) || MODULOS[0];

  return html`
    <div class="gestao-shell">
      <${Nav} rotaAtual=${rota} nomeUsuario=${funcionario.nome} onSair=${sair} />
      <main class="gestao-main">
        ${def.pronto && modulo ? h(modulo, {}) : html`<${EmConstrucao} rotulo=${def.rotulo} />`}
      </main>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
