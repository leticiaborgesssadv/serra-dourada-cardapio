// Ponte entre a fila de impressão (banco) e o programa instalado no PC do restaurante.
// O agente se identifica com um token próprio (cabeçalho x-agente-token). Só o hash do token fica no banco.
//   POST {"acao":"buscar","limite":5}                         -> comandas pendentes (marcadas como "imprimindo")
//   POST {"acao":"resultado","job":"<id>","ok":true}          -> marca como impressa
//   POST {"acao":"resultado","job":"<id>","ok":false,"erro":"..."} -> volta para a fila (até 5 tentativas)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  const token = req.headers.get("x-agente-token") || "";
  if (token.length < 20) return json({ erro: "agente não autorizado" }, 401);

  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }

  if (corpo.acao === "buscar") {
    const { data, error } = await sb.rpc("impressao_buscar", { p_token: token, p_limite: Number(corpo.limite) || 5 });
    if (error) return json({ erro: error.message.includes("não autorizado") ? "agente não autorizado" : "falha ao buscar" }, error.message.includes("não autorizado") ? 401 : 500);
    return json({ jobs: data || [] });
  }

  if (corpo.acao === "resultado") {
    if (typeof corpo.job !== "string") return json({ erro: "job obrigatório" }, 400);
    const { error } = await sb.rpc("impressao_resultado", { p_token: token, p_job: corpo.job, p_ok: !!corpo.ok, p_erro: corpo.erro ? String(corpo.erro).slice(0, 500) : null });
    if (error) return json({ erro: error.message.includes("não autorizado") ? "agente não autorizado" : "falha ao registrar" }, error.message.includes("não autorizado") ? 401 : 500);
    return json({ ok: true });
  }

  return json({ erro: "ação desconhecida" }, 400);
});
