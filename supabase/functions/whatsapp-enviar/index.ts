// Envio manual pela equipe (painel gestão → WhatsApp), na mesma conversa que o agente automático usa.
// Só quem tem papel "gerencia", "cozinha" ou "caixa" pode chamar.
// Quando um funcionário responde, o robô fica em silêncio nessa conversa por 60 min (atendimento humano),
// até alguém tocar em "Devolver ao robô" no painel.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}

const MINUTOS_ATENDIMENTO_HUMANO = 60;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resposta({ error: "Método não permitido" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return resposta({ error: "Não autenticado" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  async function segredo(nome: string): Promise<string> {
    const env = Deno.env.get(nome);
    if (env) return env;
    const { data } = await admin.rpc("ler_segredo", { p_nome: nome.toLowerCase() });
    return typeof data === "string" ? data : "";
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return resposta({ error: "Sessão inválida" }, 401);

  const { data: chamador } = await admin.from("funcionario").select("papel, ativo").eq("user_id", userData.user.id).maybeSingle();
  if (!chamador || !["gerencia", "cozinha", "caixa"].includes(chamador.papel) || !chamador.ativo) {
    return resposta({ error: "Você não tem acesso para enviar mensagens pelo WhatsApp." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return resposta({ error: "JSON inválido" }, 400);
  }

  const conversaId = String(body.conversa_id || "");
  const texto = String(body.texto || "").trim();
  if (!conversaId || !texto) return resposta({ error: "conversa_id e texto são obrigatórios" }, 400);

  const { data: conversa } = await admin.from("whatsapp_conversa").select("id, telefone").eq("id", conversaId).maybeSingle();
  if (!conversa) return resposta({ error: "Conversa não encontrada" }, 404);

  const WHATSAPP_TOKEN = await segredo("WHATSAPP_TOKEN");
  const PHONE_NUMBER_ID = await segredo("WHATSAPP_PHONE_NUMBER_ID");
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    return resposta({ error: "WhatsApp ainda não está conectado (faltam os segredos WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID)." }, 409);
  }

  const envio = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: conversa.telefone, type: "text", text: { body: texto } }),
  });
  if (!envio.ok) {
    const erro = await envio.text();
    await admin.from("whatsapp_mensagem").insert({ conversa_id: conversaId, direcao: "saida", conteudo: texto, envio_status: "falhou", envio_erro: erro.slice(0, 300), enviado_por: userData.user.id });
    return resposta({ error: "Falha ao enviar via WhatsApp: " + erro }, 502);
  }
  const envioJson = await envio.json().catch(() => ({}));
  const wamid = envioJson?.messages?.[0]?.id || null;

  await admin.from("whatsapp_mensagem").insert({ conversa_id: conversaId, direcao: "saida", conteudo: texto, intencao: null, wamid, envio_status: "enviado", enviado_por: userData.user.id });
  await admin.from("whatsapp_conversa").update({
    atualizado_em: new Date().toISOString(),
    atendimento_humano_ate: new Date(Date.now() + MINUTOS_ATENDIMENTO_HUMANO * 60000).toISOString(),
    atendimento_humano_por: userData.user.id,
    aguardando_humano_desde: null,
  }).eq("id", conversaId);

  return resposta({ ok: true });
});
