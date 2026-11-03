// Conversa com a WhatsApp Cloud API (oficial): assinatura, leitura e envio de mensagens.

// Mensagens que o robô sabe mandar. Botões e listas são os componentes oficiais do WhatsApp.
export type Botao = { id: string; titulo: string };
export type LinhaLista = { id: string; titulo: string; descricao?: string };
export type Saida =
  | { tipo: "texto"; texto: string }
  | { tipo: "botoes"; texto: string; botoes: Botao[] }
  | { tipo: "lista"; texto: string; botao: string; secoes: { titulo: string; linhas: LinhaLista[] }[] };

export type Recebida = {
  wamid: string;
  telefone: string;
  nomeContato: string;
  tipo: string;
  texto: string;        // texto digitado, ou o título do botão/linha tocado
  respostaId: string;   // id do botão/linha tocado ("" quando é texto digitado)
};

const corta = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

// ---------- assinatura (X-Hub-Signature-256) ----------

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function assinaturaValida(corpo: string, cabecalho: string | null, segredo: string): Promise<boolean> {
  if (!segredo || !cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)));
  const hex = Array.from(assinatura).map((b) => b.toString(16).padStart(2, "0")).join("");
  return iguais(hex, cabecalho.slice(7).toLowerCase());
}

// ---------- leitura ----------

export function extrairRecebida(payload: any): Recebida | null {
  const valor = payload?.entry?.[0]?.changes?.[0]?.value;
  const m = valor?.messages?.[0];
  if (!m) return null; // aviso de entrega/leitura, sem mensagem nova
  let texto = m.text?.body || "";
  let respostaId = "";
  if (m.type === "interactive") {
    const r = m.interactive?.button_reply || m.interactive?.list_reply;
    texto = r?.title || "";
    respostaId = r?.id || "";
  } else if (m.type === "button") {
    texto = m.button?.text || "";
    respostaId = m.button?.payload || "";
  }
  return {
    wamid: m.id,
    telefone: m.from,
    nomeContato: valor?.contacts?.[0]?.profile?.name || "",
    tipo: m.type,
    texto,
    respostaId,
  };
}

// ---------- envio ----------

// Texto simples equivalente (fica no histórico do painel).
export function textoDaSaida(s: Saida): string {
  if (s.tipo === "texto") return s.texto;
  if (s.tipo === "botoes") return `${s.texto}\n\n${s.botoes.map((b) => `[ ${b.titulo} ]`).join("  ")}`;
  const linhas = s.secoes.flatMap((sec) => sec.linhas.map((l) => `• ${l.titulo}${l.descricao ? ` — ${l.descricao}` : ""}`));
  return `${s.texto}\n\n${linhas.join("\n")}`;
}

function corpoMeta(para: string, s: Saida): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", to: para };
  if (s.tipo === "texto") return { ...base, type: "text", text: { body: corta(s.texto, 4096) } };
  if (s.tipo === "botoes") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: corta(s.texto, 1024) },
        action: { buttons: s.botoes.slice(0, 3).map((b) => ({ type: "reply", reply: { id: corta(b.id, 256), title: corta(b.titulo, 20) } })) },
      },
    };
  }
  // lista: no máximo 10 linhas no total
  let restantes = 10;
  const secoes = s.secoes
    .map((sec) => {
      const linhas = sec.linhas.slice(0, restantes);
      restantes -= linhas.length;
      return {
        title: corta(sec.titulo, 24),
        rows: linhas.map((l) => ({ id: corta(l.id, 200), title: corta(l.titulo, 24), ...(l.descricao ? { description: corta(l.descricao, 72) } : {}) })),
      };
    })
    .filter((sec) => sec.rows.length > 0);
  return {
    ...base,
    type: "interactive",
    interactive: { type: "list", body: { text: corta(s.texto, 1024) }, action: { button: corta(s.botao, 20), sections: secoes } },
  };
}

export type ResultadoEnvio = { status: "enviado" | "falhou" | "nao_configurado"; wamid?: string; erro?: string };

export async function enviar(token: string, phoneId: string, para: string, s: Saida): Promise<ResultadoEnvio> {
  if (!token || !phoneId) return { status: "nao_configurado" };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpoMeta(para, s)),
    });
    const corpo = await r.text();
    if (!r.ok) return { status: "falhou", erro: `${r.status} ${corpo.slice(0, 300)}` };
    const json = JSON.parse(corpo || "{}");
    return { status: "enviado", wamid: json?.messages?.[0]?.id };
  } catch (e) {
    return { status: "falhou", erro: String(e).slice(0, 300) };
  }
}
