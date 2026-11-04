// Cardápio do dia (almoço). A equipe posta o cardápio pelo próprio WhatsApp do restaurante (app no
// celular). Se a mensagem começar com #cardapio, a cópia que a Meta entrega ao robô (coexistência)
// vira o cardápio de hoje. "#cardapio" substitui o do dia; "#cardapio+" acrescenta (ex.: carnes numa
// mensagem e acompanhamentos em outra). Vale só para a data de hoje (horário de Brasília).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const MARCA_CARDAPIO = /^\s*#card[aá]pio(\+)?[:\s-]*/i;

function hoje(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function salvarCardapioDia(sb: SupabaseClient, estab: string, texto: string, wamid: string): Promise<void> {
  const m = texto.match(MARCA_CARDAPIO);
  if (!m) return;
  const corpo = texto.slice(m[0].length).trim();
  if (!corpo) return;
  const data = hoje();
  const { data: atual } = await sb.from("cardapio_dia").select("texto, wamid").eq("estabelecimento_id", estab).eq("data", data).maybeSingle();
  if (atual?.wamid === wamid) return; // reentrega da Meta
  const acrescentar = !!m[1] && !!atual?.texto;
  const { error } = await sb.from("cardapio_dia").upsert({
    estabelecimento_id: estab, data, wamid,
    texto: (acrescentar ? `${atual!.texto}\n\n${corpo}` : corpo).slice(0, 4000),
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "estabelecimento_id,data" });
  if (error) throw new Error("cardapio_dia: " + error.message);
}

export async function cardapioDoDia(sb: SupabaseClient, estab: string): Promise<string | null> {
  const { data } = await sb.from("cardapio_dia").select("texto").eq("estabelecimento_id", estab).eq("data", hoje()).maybeSingle();
  return data?.texto || null;
}

const sem = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const IGNORAR = new Set(["hoje", "almoco", "voces", "quero", "queria", "cardapio", "marmita", "marmitex", "tarde", "noite", "obrigado", "obrigada"]);

// "Tem feijoada hoje?": alguma palavra da pergunta (5+ letras) aparece no cardápio de hoje?
export function citaCardapio(pergunta: string, cardapio: string): boolean {
  const c = sem(cardapio);
  return sem(pergunta).split(/[^a-z]+/).some((p) => p.length >= 5 && !IGNORAR.has(p) && new RegExp(`\\b${p}`).test(c));
}
