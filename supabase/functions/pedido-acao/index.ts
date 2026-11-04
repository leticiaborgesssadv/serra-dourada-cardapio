// Ações da equipe sobre pedidos (painel). Cada ação roda com o login de quem clicou:
// as permissões são conferidas no banco (tem_papel) e tudo fica no histórico com o nome da pessoa.
// Quando o pedido fica pronto ou é cancelado, o cliente é avisado pelo WhatsApp.
//   POST {"acao":"status","pedido":"<id>","para":"em_preparo|pronto|finalizado"}
//   POST {"acao":"cancelar","pedido":"<id>","motivo":"..."}
//   POST {"acao":"reimprimir","pedido":"<id>"}
//   POST {"acao":"pagamento","pedido":"<id>","status":"conferido|recusado|pendente"}
//   POST {"acao":"assumir_conversa"|"devolver_conversa","conversa":"<id>"}
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

// Avisa o cliente pela conversa do próprio pedido (dentro da janela de 24 h aberta pelo cliente).
async function avisarCliente(pedidoId: string, texto: (p: any) => string, userId: string) {
  const { data: p } = await admin.from("pedido").select("numero, total, cliente_telefone, conversa_id, modalidade, motivo_cancelamento").eq("id", pedidoId).single();
  if (!p?.cliente_telefone || !p?.conversa_id) return "sem_conversa";
  const corpo = texto(p);
  const token = await segredo("WHATSAPP_TOKEN");
  const phoneId = await segredo("WHATSAPP_PHONE_NUMBER_ID");
  let status = "nao_configurado";
  let erro: string | null = null;
  let wamid: string | null = null;
  if (token && phoneId) {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: p.cliente_telefone, type: "text", text: { body: corpo } }),
    });
    const resp = await r.text();
    if (r.ok) {
      status = "enviado";
      wamid = JSON.parse(resp || "{}")?.messages?.[0]?.id || null;
    } else {
      status = "falhou";
      erro = `${r.status} ${resp.slice(0, 300)}`;
    }
  }
  await admin.from("whatsapp_mensagem").insert({ conversa_id: p.conversa_id, direcao: "saida", conteudo: corpo, envio_status: status, envio_erro: erro, wamid, enviado_por: userId });
  return status;
}

const numero = (p: any) => String(p.numero).padStart(3, "0");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);
  // cliente com o login de quem clicou: as funções do banco conferem o papel (gerência, cozinha, caixa)
  const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ error: "Sessão inválida" }, 401);

  let b: any;
  try {
    b = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const erro = (e: any) => json({ error: e?.message || String(e) }, 400);

  switch (b.acao) {
    case "status": {
      const { error } = await usuario.rpc("mudar_status_pedido", { p_pedido: b.pedido, p_para: b.para });
      if (error) return erro(error);
      let aviso = "";
      if (b.para === "pronto") {
        aviso = await avisarCliente(b.pedido, (p) => p.modalidade === "entrega"
          ? `🛵 Seu pedido #${numero(p)} saiu para entrega!`
          : `✅ Seu pedido #${numero(p)} está pronto para retirada no balcão. Até já!`, u.user.id);
      }
      return json({ ok: true, aviso_cliente: aviso || null });
    }
    case "cancelar": {
      const { error } = await usuario.rpc("mudar_status_pedido", { p_pedido: b.pedido, p_para: "cancelado", p_motivo: b.motivo });
      if (error) return erro(error);
      const aviso = await avisarCliente(b.pedido, (p) => `Seu pedido #${numero(p)} foi cancelado. Motivo: ${p.motivo_cancelamento}. Se precisar, é só responder aqui.`, u.user.id);
      return json({ ok: true, aviso_cliente: aviso });
    }
    case "reimprimir": {
      const { data, error } = await usuario.rpc("reimprimir_pedido", { p_pedido: b.pedido });
      if (error) return erro(error);
      return json({ ok: true, comandas: data });
    }
    case "pagamento": {
      const { error } = await usuario.rpc("marcar_pagamento", { p_pedido: b.pedido, p_status: b.status });
      if (error) return erro(error);
      return json({ ok: true });
    }
    case "assumir_conversa": {
      const { error } = await usuario.rpc("assumir_conversa", { p_conversa: b.conversa, p_minutos: Number(b.minutos) || 60 });
      if (error) return erro(error);
      return json({ ok: true });
    }
    case "devolver_conversa": {
      const { error } = await usuario.rpc("devolver_conversa_robo", { p_conversa: b.conversa });
      if (error) return erro(error);
      return json({ ok: true });
    }
    default:
      return json({ error: "Ação desconhecida" }, 400);
  }
});
