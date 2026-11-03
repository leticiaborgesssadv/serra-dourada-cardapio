// Reserva pelo WhatsApp: junta data, horário, pessoas e nome, confere no banco (horário de funcionamento,
// antecedência, datas fechadas e vagas) e grava como SOLICITAÇÃO. Quem confirma é sempre a equipe, no painel.
// Turno lotado vira lista de espera; grupo grande vira "reserva especial" para a gestão.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Saida } from "./whatsapp.ts";
import { avisarGestao } from "./triagem.ts";

// minúsculas e sem acento, mas mantendo ":" e "/" (20:30, 04/11)
const normalizar = (s: string) => (s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

export type ContextoReserva = {
  tipo: "reserva";
  etapa: "dados" | "nome" | "ocasiao" | "confirmar";
  data?: string | null;
  horario?: string | null;
  pessoas?: number | null;
  nome?: string;
  ocasiao?: string;
  especial?: boolean;
  listaEspera?: boolean;
  limiteGrupo?: number;
};

export type EntradaReserva = { texto: string; respostaId: string; wamid: string; telefone: string; nomeContato: string; conversaId: string };
type Resultado = { saidas: Saida[]; contexto: Record<string, unknown> };

const texto = (t: string): Saida => ({ tipo: "texto", texto: t });
const CANCELAR = ["cancelar", "cancela", "desisto", "sair"];
const DIAS_TXT = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const DIAS_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ---------- leitura de data, horário e pessoas ----------

function hojeLocal(): { iso: string; diaSemana: number } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)!.value;
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { iso: `${v("year")}-${v("month")}-${v("day")}`, diaSemana: dias[v("weekday")] ?? 0 };
}

function somarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

export function lerData(t: string): string | null {
  const hoje = hojeLocal();
  const num = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (num) {
    const dia = Number(num[1]);
    const mes = Number(num[2]);
    let ano = num[3] ? Number(num[3]) : Number(hoje.iso.slice(0, 4));
    if (ano < 100) ano += 2000;
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      let iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      if (!num[3] && iso < hoje.iso) iso = `${ano + 1}${iso.slice(4)}`; // "05/01" em dezembro = ano que vem
      return iso;
    }
  }
  if (/\bhoje\b/.test(t)) return hoje.iso;
  if (/\bdepois de amanha\b/.test(t)) return somarDias(hoje.iso, 2);
  if (/\bamanha\b/.test(t)) return somarDias(hoje.iso, 1);
  for (let alvo = 0; alvo < 7; alvo++) {
    if (new RegExp(`\\b${DIAS_TXT[alvo]}\\b`).test(t)) return somarDias(hoje.iso, (alvo - hoje.diaSemana + 7) % 7);
  }
  return null;
}

export function lerHorario(t: string): string | null {
  // "20:30", "20h30" | "20h", "20 horas" | "às 20". Minutos só colados ao "h"/":" ("20h 25 pessoas" = 20:00).
  const m = t.match(/\b(\d{1,2})(?::|h)(\d{2})\b/) || t.match(/\b(\d{1,2})\s*(?:h|hs|horas?)\b/) || t.match(/\bas (\d{1,2})\b(?!\s*pessoa)/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function lerPessoas(t: string): number | null {
  const m = t.match(/\b(\d{1,3})\s*(?:pessoas?|pax|adultos?|lugares)\b/) || t.match(/\b(?:para|pra|somos)\s+(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 300 ? n : null;
}

function dataCurta(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS_CURTO[dow]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

// ---------- telas ----------

function pedirDados(ctx: ContextoReserva, primeira: boolean): Saida {
  if (primeira) {
    return texto("Será um prazer receber você! Para solicitar a reserva, me diga:\n\n📅 Data\n🕒 Horário\n👥 Quantidade de pessoas\n\nPode mandar tudo numa mensagem só (ex.: _amanhã às 20h, 4 pessoas_).");
  }
  const falta: string[] = [];
  if (!ctx.data) falta.push("a data");
  if (!ctx.horario) falta.push("o horário");
  if (!ctx.pessoas) falta.push("a quantidade de pessoas");
  return texto(`Para continuar, me diga também ${falta.join(", ").replace(/, ([^,]*)$/, " e $1")}.`);
}

function pedirNome(ctx: ContextoReserva, nomeContato: string): Saida {
  ctx.etapa = "nome";
  const primeiro = (nomeContato || "").trim().split(/\s+/)[0] || "";
  if (primeiro.length >= 2 && primeiro.length <= 20) {
    return { tipo: "botoes", texto: "Em nome de quem fica a reserva? Toque no botão ou escreva o nome.", botoes: [{ id: "res:nome", titulo: primeiro }] };
  }
  return texto("Em nome de quem fica a reserva?");
}

function telaConfirmar(ctx: ContextoReserva): Saida {
  ctx.etapa = "confirmar";
  const linhas = [
    "📝 *Confira sua solicitação*",
    "",
    `📅 ${dataCurta(ctx.data!)} às ${ctx.horario}`,
    `👥 ${ctx.pessoas} pessoa(s)`,
    `👤 ${ctx.nome}`,
    ...(ctx.ocasiao ? [`🎉 ${ctx.ocasiao}`] : []),
    "",
    ctx.listaEspera
      ? "⚠️ Esse turno já está cheio. Posso colocar você na *lista de espera* e avisamos por aqui se abrir vaga."
      : "A reserva só vale depois que nossa equipe *confirmar* por aqui.",
  ];
  return {
    tipo: "botoes",
    texto: linhas.join("\n"),
    botoes: [
      { id: "res:enviar", titulo: ctx.listaEspera ? "Entrar na espera" : "Enviar solicitação" },
      { id: "res:alterar", titulo: "Alterar" },
      { id: "res:cancelar", titulo: "Cancelar" },
    ],
  };
}

// Confere no banco. Se algo não serve, explica e pede para trocar só o que precisa.
async function conferir(sb: SupabaseClient, estab: string, ctx: ContextoReserva, nomeContato: string): Promise<Resultado> {
  const { data: v, error } = await sb.rpc("validar_reserva", { p_estab: estab, p_dados: { data: ctx.data, horario: ctx.horario, pessoas: ctx.pessoas } });
  if (error) throw new Error("validar_reserva: " + error.message);
  if (!v.ok) {
    const erros: string[] = v.erros || [];
    if (erros.some((x) => x.includes("aceitando"))) return { saidas: [texto(erros.join("\n") + "\n\nSe quiser, escreva *atendente* para falar com a equipe.")], contexto: {} };
    if (erros.some((x) => /fechad|anteced|dias/.test(x))) { ctx.data = null; ctx.horario = null; }
    return { saidas: [texto(`⚠️ ${erros.join("\n⚠️ ")}\n\nPode me dizer outro dia e horário?`)], contexto: ctx };
  }
  ctx.especial = !!v.especial;
  ctx.listaEspera = !!v.lista_espera;
  ctx.limiteGrupo = v.limite_grupo;
  return { saidas: [pedirNome(ctx, nomeContato)], contexto: ctx };
}

// ---------- entrada ----------

export async function iniciarReserva(sb: SupabaseClient, estab: string, e: EntradaReserva): Promise<Resultado> {
  const ctx: ContextoReserva = { tipo: "reserva", etapa: "dados" };
  const t = normalizar(e.texto);
  ctx.data = lerData(t);
  ctx.horario = lerHorario(t);
  ctx.pessoas = lerPessoas(t);
  if (ctx.data && ctx.horario && ctx.pessoas) return conferir(sb, estab, ctx, e.nomeContato);
  return { saidas: [pedirDados(ctx, !(ctx.data || ctx.horario || ctx.pessoas))], contexto: ctx };
}

export async function continuarReserva(
  sb: SupabaseClient, estab: string, ctx: ContextoReserva, e: EntradaReserva, segredo: (n: string) => Promise<string>,
): Promise<Resultado> {
  const t = normalizar(e.texto);
  const id = e.respostaId;
  if (CANCELAR.includes(t) || id === "res:cancelar") return { saidas: [texto("Tudo bem, não registrei a reserva. Quando quiser, é só chamar! 😊")], contexto: {} };
  if (id === "res:alterar") {
    const novo: ContextoReserva = { tipo: "reserva", etapa: "dados" };
    return { saidas: [texto("Sem problema! Me mande de novo a data, o horário e a quantidade de pessoas.")], contexto: novo };
  }

  switch (ctx.etapa) {
    case "dados": {
      ctx.data = lerData(t) || ctx.data || null;
      ctx.horario = lerHorario(t) || ctx.horario || null;
      ctx.pessoas = lerPessoas(t) || ctx.pessoas || null;
      // "4" sozinho, quando só falta a quantidade
      if (!ctx.pessoas && ctx.data && ctx.horario && /^\d{1,3}$/.test(t)) ctx.pessoas = Number(t);
      if (ctx.data && ctx.horario && ctx.pessoas) return conferir(sb, estab, ctx, e.nomeContato);
      return { saidas: [pedirDados(ctx, false)], contexto: ctx };
    }
    case "nome": {
      const nome = id === "res:nome" ? e.nomeContato.trim() : e.texto.trim();
      if (nome.length < 2 || nome.length > 60) return { saidas: [texto("Qual nome devo colocar na reserva?")], contexto: ctx };
      ctx.nome = nome.slice(0, 60);
      if (ctx.especial) {
        ctx.etapa = "ocasiao";
        return { saidas: [texto(`Para grupos com mais de ${ctx.limiteGrupo} pessoas, nossa gestão organiza tudo com você. 😊\nQual é a ocasião (aniversário, confraternização…) e algum detalhe importante?`)], contexto: ctx };
      }
      return { saidas: [telaConfirmar(ctx)], contexto: ctx };
    }
    case "ocasiao": {
      if (e.texto.trim().length < 2) return { saidas: [texto("Qual é a ocasião? (ex.: aniversário, confraternização da empresa)")], contexto: ctx };
      ctx.ocasiao = e.texto.trim().slice(0, 250);
      return { saidas: [telaConfirmar(ctx)], contexto: ctx };
    }
    case "confirmar": {
      if (!(id === "res:enviar" || ["sim", "enviar", "confirmar", "confirmo", "ok"].includes(t))) return { saidas: [telaConfirmar(ctx)], contexto: ctx };
      const { data: r, error } = await sb.rpc("solicitar_reserva", {
        p_estab: estab, p_chave: "wa:" + e.wamid, p_conversa: e.conversaId,
        p_dados: { origem: "whatsapp", cliente_nome: ctx.nome, cliente_telefone: e.telefone, data: ctx.data, horario: ctx.horario, pessoas: ctx.pessoas, observacao: ctx.ocasiao || null },
      });
      if (error) throw new Error("solicitar_reserva: " + error.message);
      if (!r.ok) {
        // algo mudou entre a conferência e o envio (ex.: passou do horário): volta a pedir data e horário
        const novo: ContextoReserva = { tipo: "reserva", etapa: "dados", pessoas: ctx.pessoas };
        return { saidas: [texto(`⚠️ ${(r.erros || []).join("\n⚠️ ")}\n\nPode me dizer outro dia e horário?`)], contexto: novo };
      }
      if (r.atendimento && !r.atendimento.duplicado && r.atendimento.avisar) {
        await avisarGestao(sb, estab, segredo, r.atendimento, "reserva_especial");
      }
      const quando = `${dataCurta(ctx.data!)} às ${ctx.horario}`;
      const linhas = r.status === "lista_espera"
        ? [`📝 Você entrou na *lista de espera* para ${quando} (${ctx.pessoas} pessoas).`, `Protocolo: *${r.protocolo}*`, "Se abrir vaga, avisamos por aqui."]
        : [`📨 Solicitação enviada! ${quando}, ${ctx.pessoas} pessoa(s), em nome de ${ctx.nome}.`, `Protocolo: *${r.protocolo}*`,
           r.especial ? "Como é um grupo grande, a gestão vai falar com você por aqui para combinar os detalhes." : "Nossa equipe confere a disponibilidade e *confirma por aqui*."];
      return { saidas: [texto(linhas.join("\n"))], contexto: {} };
    }
  }
  return { saidas: [pedirDados(ctx, false)], contexto: { ...ctx, etapa: "dados" } };
}

// "Minha reserva": próximas reservas deste telefone.
export async function responderMinhaReserva(sb: SupabaseClient, estab: string, telefone: string): Promise<string> {
  const { data } = await sb.from("reserva")
    .select("protocolo, data, horario, pessoas, status")
    .eq("estabelecimento_id", estab).eq("cliente_telefone", telefone)
    .gte("data", hojeLocal().iso).in("status", ["pendente", "confirmada", "lista_espera"])
    .order("data").limit(3);
  if (!data?.length) return "Não encontrei reservas futuras feitas por este número. Para fazer uma, escreva *reserva*.";
  const rotulo: Record<string, string> = { pendente: "aguardando confirmação da equipe", confirmada: "confirmada ✅", lista_espera: "na lista de espera" };
  const linhas = data.map((r: any) => `• *${r.protocolo}* — ${dataCurta(r.data)}${r.horario ? " às " + String(r.horario).slice(0, 5) : ""}, ${r.pessoas} pessoa(s): ${rotulo[r.status]}`);
  return `Suas próximas reservas:\n${linhas.join("\n")}\n\nPara alterar ou cancelar, escreva *atendente*.`;
}
