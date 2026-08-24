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

const BUCKET_ANEXOS = "documentos-privados";

export function ehCaminhoArmazenado(valor) {
  return !!valor && !/^https?:\/\//i.test(valor);
}

export async function enviarAnexo(arquivo) {
  const ext = arquivo.name.includes(".") ? arquivo.name.split(".").pop() : "bin";
  const caminho = `${crypto.randomUUID()}.${ext}`;
  const r = await sb.storage.from(BUCKET_ANEXOS).upload(caminho, arquivo);
  if (r.error) throw new Error(r.error.message);
  return caminho;
}

export async function urlAssinadaAnexo(caminho, segundos = 120) {
  const r = await sb.storage.from(BUCKET_ANEXOS).createSignedUrl(caminho, segundos);
  if (r.error) throw new Error(r.error.message);
  return r.data.signedUrl;
}

export async function coletarAlertas() {
  const [contasRes, insumosRes, docsRes, contratosRes, lembretesRes, feriasRes, equipRes, funcDocsRes, funcRes] = await Promise.all([
    sb.from("conta_pagar").select("descricao, valor, vencimento, status").eq("status", "a_vencer"),
    sb.from("insumo").select("nome, estoque_atual, ponto_reposicao"),
    sb.from("documento_empresa").select("nome, validade").not("validade", "is", null),
    sb.from("contrato").select("contraparte, termino").not("termino", "is", null),
    sb.from("lembrete").select("titulo, data_vencimento, status").eq("status", "pendente"),
    sb.from("funcionario_ferias").select("funcionario_id, limite_para_gozo, status").neq("status", "gozada"),
    sb.from("equipamento").select("nome, proxima_revisao").not("proxima_revisao", "is", null),
    sb.from("funcionario_documento").select("funcionario_id, nome, validade").not("validade", "is", null),
    sb.from("funcionario").select("id, nome"),
  ]);

  const nomesPorId = Object.fromEntries((funcRes.data || []).map((f) => [f.id, f.nome]));
  const itens = [];

  (contasRes.data || []).forEach((c) => {
    const dias = diasAte(c.vencimento);
    if (dias <= 7) itens.push({ categoria: "Contas a pagar", texto: `${c.descricao} — ${formatarMoeda(c.valor)}`, dias });
  });
  (insumosRes.data || []).filter((i) => Number(i.estoque_atual) <= Number(i.ponto_reposicao)).forEach((i) => {
    itens.push({ categoria: "Estoque baixo", texto: i.nome, dias: -1 });
  });
  (docsRes.data || []).forEach((d) => {
    const dias = diasAte(d.validade);
    if (dias <= 30) itens.push({ categoria: "Documento da empresa", texto: d.nome, dias });
  });
  (contratosRes.data || []).forEach((c) => {
    const dias = diasAte(c.termino);
    if (dias <= 30) itens.push({ categoria: "Contrato", texto: c.contraparte, dias });
  });
  (lembretesRes.data || []).forEach((l) => {
    const dias = diasAte(l.data_vencimento);
    if (dias <= 30) itens.push({ categoria: "Lembrete", texto: l.titulo, dias });
  });
  (feriasRes.data || []).forEach((f) => {
    const dias = diasAte(f.limite_para_gozo);
    if (dias <= 60) itens.push({ categoria: "Férias", texto: `${nomesPorId[f.funcionario_id] || "?"} — prazo de gozo`, dias });
  });
  (equipRes.data || []).forEach((e) => {
    const dias = diasAte(e.proxima_revisao);
    if (dias <= 30) itens.push({ categoria: "Manutenção de equipamento", texto: e.nome, dias });
  });
  (funcDocsRes.data || []).forEach((d) => {
    const dias = diasAte(d.validade);
    if (dias <= 30) itens.push({ categoria: "Documento de funcionário", texto: `${nomesPorId[d.funcionario_id] || "?"} — ${d.nome}`, dias });
  });

  return itens.sort((a, b) => a.dias - b.dias);
}
