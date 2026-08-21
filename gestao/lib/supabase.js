export const SUPABASE_URL = "https://bhxnhiggogosootbtwpb.supabase.co";
export const ANON_KEY = "sb_publishable_Zsg8lPJjUHK5-okGOuYc9g_VbKilzQG";
export const sb = window.supabase.createClient(SUPABASE_URL, ANON_KEY);

let estabelecimentoIdCache = null;

export async function getEstabelecimentoId() {
  if (estabelecimentoIdCache) return estabelecimentoIdCache;
  const r = await sb.from("estabelecimento").select("id").limit(1).single();
  if (r.error) throw new Error("Não foi possível identificar o estabelecimento.");
  estabelecimentoIdCache = r.data.id;
  return estabelecimentoIdCache;
}

export function formatarMoeda(valor) {
  const n = Number(valor || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function hojeISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function diasAte(dataISO) {
  const hoje = new Date(hojeISO() + "T00:00:00");
  const alvo = new Date(dataISO + "T00:00:00");
  return Math.round((alvo - hoje) / 86400000);
}
