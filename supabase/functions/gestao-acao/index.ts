// Ações da equipe sobre reservas e triagem (painel). Cada ação roda com o login de quem clicou:
// as permissões são conferidas no banco e tudo fica no histórico com o nome da pessoa.
//   POST {"acao":"reserva_decidir","reserva":"<id>","decisao":"confirmar|lista_espera|recusar|cancelar|compareceu|nao_compareceu","motivo":"..."}
//   POST {"acao":"reserva_criar","dados":{cliente_nome, cliente_telefone, data, horario, pessoas, observacao}}
//   POST {"acao":"atendimento_reenviar_aviso","atendimento":"<id>"}
// Quando a reserva veio do WhatsApp, o cliente é avisado na mesma conversa.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function segredo(nome: string): Promise<string> {
  const env = Deno.env.get(nome);
  if (env) return env;
  const { data } = await admin.rpc("ler_segredo", { p_nome: nome.toLowerCase() });
  return typeof data === "string" ? data : "";
}

const TITULO: Record<string, string> = {
  reclamacao: "Reclamação", gerente: "Falar com a gerência", curriculo: "Currículo", fornecedor: "Fornecedor",
  artista: "Artista / música", parceria: "Parceria / divulgação", nota_fiscal: "Nota fiscal", reserva_especial: "Reserva especial", outro: "Outro assunto",
};

// Brasil: a Meta entrega alguns celulares sem o nono dígito; para enviar, usa o formato com o 9.
function numeroParaEnvio(t: string): string {
  const d = (t || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("55") && /[6-9]/.test(d[4])) return d.slice(0, 4) + "9" + d.slice(4);
  return d;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function quando(r: any): string {
  const [y, m, d] = String(r.data).split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS[dow]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}${r.horario ? " às " + String(r.horario).slice(0, 5) : ""}`;
}

// Mensagem livre ao cliente (só funciona dentro da janela de 24 h aberta pelo cliente; fora dela, a Meta recusa).
async function avisarCliente(conversaId: string | null, telefone: string | null, corpo: string, userId: string): Promise<string> {
  if (!conversaId || !telefone) return "sem_conversa";
  const token = await segredo("WHATSAPP_TOKEN");
  const phoneId = await segredo("WHATSAPP_PHONE_NUMBER_ID");
  let status = "nao_configurado";
  let erro: string | null = null;
  let wamid: string | null = null;
  if (token && phoneId) {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: numeroParaEnvio(telefone), type: "text", text: { body: corpo } }),
    });
    const resp = await r.text();
    if (r.ok) { status = "enviado"; wamid = JSON.parse(resp || "{}")?.messages?.[0]?.id || null; }
    else { status = "falhou"; erro = `${r.status} ${resp.slice(0, 300)}`; }
  }
  await admin.from("whatsapp_mensagem").insert({ conversa_id: conversaId, direcao: "saida", conteudo: corpo, envio_status: status, envio_erro: erro, wamid, enviado_por: userId });
  return status;
}

function textoDecisao(r: any): string | null {
  switch (r.status) {
    case "confirmada": {
      // texto aprovado pela gestão em 03/11 (o mesmo do modelo enviado à Meta)
      const [, m, d] = String(r.data).split("-");
      const nome = String(r.cliente_nome || "").trim().split(/\s+/)[0] || "";
      const hora = r.horario ? `, às ${String(r.horario).slice(0, 5)}` : "";
      return `Oi${nome ? ", " + nome : ""}! 😊 Que alegria: sua reserva no Serra Dourada está confirmada! Vamos te esperar no dia ${d}/${m}${hora}, com tudo pronto para ${r.pessoas} pessoa(s). Se for comemorar algo especial, conta pra gente que a equipe capricha. Seu protocolo é ${r.protocolo}. Qualquer mudança, é só responder aqui. Até lá!`;
    }
    case "lista_espera": return `📝 Sua solicitação *${r.protocolo}* (${quando(r)}) está na lista de espera. Se abrir vaga, avisamos por aqui.`;
    case "recusada": return `Infelizmente não conseguimos confirmar a reserva *${r.protocolo}* (${quando(r)}). Motivo: ${r.motivo}.\nSe quiser, escreva *reserva* para tentar outro dia ou horário.`;
    case "cancelada": return `Sua reserva *${r.protocolo}* (${quando(r)}) foi cancelada. Motivo: ${r.motivo}.\nSe precisar, é só responder aqui.`;
    default: return null; // presença não gera mensagem
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);
  const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ error: "Sessão inválida" }, 401);

  let b: any;
  try { b = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const erro = (e: any) => json({ error: e?.message || String(e) }, 400);

  switch (b.acao) {
    case "reserva_decidir": {
      const { data: r, error } = await usuario.rpc("decidir_reserva", { p_id: b.reserva, p_acao: b.decisao, p_motivo: b.motivo || null });
      if (error) return erro(error);
      const msg = r.origem === "whatsapp" ? textoDecisao(r) : null;
      const aviso = msg ? await avisarCliente(r.conversa_id, r.cliente_telefone, msg, u.user.id) : null;
      return json({ ok: true, status: r.status, aviso_cliente: aviso });
    }
    case "reserva_criar": {
      const { data, error } = await usuario.rpc("criar_reserva_painel", { p_dados: b.dados || {} });
      if (error) return erro(error);
      if (!data?.ok) return json({ error: (data?.erros || []).join(" ") || "Não foi possível criar a reserva." }, 400);
      return json({ ok: true, protocolo: data.protocolo, status: data.status });
    }
    case "atendimento_reenviar_aviso": {
      // lê com o login de quem clicou: só a gerência enxerga a triagem
      const { data: a, error } = await usuario.from("atendimento_adm").select("id, protocolo, categoria, prioridade, estabelecimento_id").eq("id", b.atendimento).maybeSingle();
      if (error || !a) return erro(error || "Atendimento não encontrado");
      const { data: cfg } = await usuario.from("triagem_config").select("telefone_gestao, modelo_aviso, modelo_idioma").eq("estabelecimento_id", a.estabelecimento_id).maybeSingle();
      const token = await segredo("WHATSAPP_TOKEN");
      const phoneId = await segredo("WHATSAPP_PHONE_NUMBER_ID");
      let status = "nao_configurado";
      let detalhe: string | null = null;
      if (cfg?.telefone_gestao && cfg?.modelo_aviso && token && phoneId) {
        const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp", to: numeroParaEnvio(cfg.telefone_gestao), type: "template",
            template: { name: cfg.modelo_aviso, language: { code: cfg.modelo_idioma || "pt_BR" }, components: [{ type: "body", parameters: [a.protocolo, TITULO[a.categoria] || a.categoria, a.prioridade.toUpperCase()].map((t) => ({ type: "text", text: t })) }] },
          }),
        });
        const resp = await r.text();
        status = r.ok ? "enviado" : "falhou";
        detalhe = r.ok ? null : `${r.status} ${resp.slice(0, 300)}`;
      }
      const reg = await usuario.rpc("registrar_aviso_gestao", { p_id: a.id, p_status: status, p_erro: detalhe });
      if (reg.error) return erro(reg.error);
      return json({ ok: true, aviso_gestao: status, erro: detalhe });
    }
    default:
      return json({ error: "Ação desconhecida" }, 400);
  }
});
