// Agente de WhatsApp — Fase 1 + Etapa 1 (pedidos, impressão, atendimento humano).
// Usa a WhatsApp Cloud API OFICIAL. Respostas por palavra-chave e botões, com dados reais do Supabase.
// Segredos (variáveis da função OU Supabase Vault com o mesmo nome em minúsculas):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas pela plataforma.)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assinaturaValida, enviar, extrairRecebida, textoDaSaida, type Recebida, type Saida } from "./whatsapp.ts";
import { continuarPedido, iniciarPedido, type ContextoPedido } from "./pedido.ts";
import { brl } from "./texto.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Segredos: primeiro as variáveis da função; se faltarem, o Supabase Vault (ler_segredo).
const cacheSegredos = new Map<string, string>();
async function segredo(nome: string): Promise<string> {
  const env = Deno.env.get(nome);
  if (env) return env;
  if (cacheSegredos.has(nome)) return cacheSegredos.get(nome)!;
  const { data } = await sb.rpc("ler_segredo", { p_nome: nome.toLowerCase() });
  const valor = typeof data === "string" ? data : "";
  cacheSegredos.set(nome, valor);
  return valor;
}

const CARDAPIO_URL = "https://bhxnhiggogosootbtwpb.supabase.co/storage/v1/object/public/site/cardapio/index.html";
const HORAS_ATENDIMENTO_HUMANO = 4;
const CONTEXTO_EXPIRA_MS = 2 * 3600000;

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type CategoriaCaptura = "reclamacao" | "gerente" | "vagas" | "fornecedor" | "parceria" | "nota_fiscal";
type Intencao =
  | "cardapio" | "horario" | "horario_almoco" | "endereco" | "happy_hour" | "reserva" | "atendente"
  | "elogio" | "avaliacao" | "prato" | "pedido" | "status_pedido" | CategoriaCaptura | "fallback";

// "1".."7" respondem ao menu numerado.
const OPCAO_NUMERICA: Record<string, Intencao> = {
  "1": "cardapio",
  "2": "reserva",
  "3": "endereco",
  "4": "horario",
  "5": "happy_hour",
  "6": "atendente",
  "7": "pedido",
};

function normalizarTexto(texto: string): string {
  return texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// "permitirAtalhoNumerico" fica false durante a coleta de reserva: "4" ali quase certamente
// significa "4 pessoas", não a opção 4 do menu.
function detectarIntencao(texto: string, permitirAtalhoNumerico = true): Intencao {
  const bruto = texto.trim();
  if (permitirAtalhoNumerico && OPCAO_NUMERICA[bruto]) return OPCAO_NUMERICA[bruto];

  const t = normalizarTexto(texto);

  if (/atendente|falar com (uma pessoa|alguem|humano)|pessoa de verdade/.test(t)) return "atendente";
  if (/\b(meu pedido|status do pedido|cade (o|meu) pedido|pedido (ja )?(saiu|esta pronto|ficou pronto))\b/.test(t)) return "status_pedido";
  if (/\breserv|\bmesa\b/.test(t)) return "reserva";
  if (/cardapio|menu/.test(t)) return "cardapio";
  if (/happy ?hour|promocao/.test(t)) return "happy_hour";
  if (/horario|funciona|que horas|abre|fecha|aberto/.test(t)) return "horario";
  if (/endereco|localizacao|onde fica|como chegar|mapa/.test(t)) return "endereco";
  if (/\b(pedir|pedido|fazer (um )?pedido|delivery|encomendar|marmit|quero|me (ve|manda)|manda (um|uma|dois|duas))\b/.test(t)) return "pedido";
  if (/almoc/.test(t)) return "horario_almoco";

  if (/gerente|falar com o dono|responsavel pelo restaurante/.test(t)) return "gerente";
  if (/reclama|\bproblema\b|insatisfeit|pessimo|decepcion/.test(t)) return "reclamacao";
  if (/elogio|parabens|adorei|amei|maravilhoso|show de bola/.test(t)) return "elogio";
  if (/avali|deixar.*review|nota no google/.test(t)) return "avaliacao";
  if (/emprego|curriculo|trabalhar (aqui|conosco|com voces|na equipe)|vagas? de (emprego|trabalho)/.test(t)) return "vagas";
  if (/fornecedor|fornecimento|represent(o|amos) a empresa/.test(t)) return "fornecedor";
  if (/parceria|divulgacao|publicidade|permuta/.test(t)) return "parceria";
  if (/nota fiscal|\bnf\b|cnpj|razao social/.test(t)) return "nota_fiscal";
  if (/prato|quanto custa|preco|valor/.test(t)) return "prato";

  return "fallback";
}

const CAPTURAS: Record<CategoriaCaptura, { abertura: string; tituloLog: string }> = {
  reclamacao: {
    abertura:
      "Sentimos muito que sua experiência não tenha sido como esperava. Queremos entender e resolver da melhor forma. Conte o que aconteceu e, se possível, informe a data e o horário da visita. Sua mensagem será encaminhada ao responsável.",
    tituloLog: "Reclamação",
  },
  gerente: {
    abertura: "Entendemos e vamos encaminhar sua mensagem diretamente ao responsável. Por favor, me conte um resumo do ocorrido para que possamos retornar.",
    tituloLog: "Pedido de gerente",
  },
  vagas: {
    abertura:
      "Obrigado pelo interesse em trabalhar conosco! Envie seu currículo (ou um resumo da sua experiência) e o nome da vaga desejada. Nossa equipe analisará e entrará em contato caso seu perfil seja selecionado.",
    tituloLog: "Vaga de emprego",
  },
  fornecedor: {
    abertura: "Olá! Envie o nome da empresa e os produtos ou serviços oferecidos. Encaminharemos a apresentação ao setor responsável.",
    tituloLog: "Fornecedor",
  },
  parceria: {
    abertura: "Obrigado pelo contato! Envie sua proposta, seu perfil ou portfólio. Nossa equipe responsável avaliará a possibilidade de parceria.",
    tituloLog: "Parceria/divulgação",
  },
  nota_fiscal: {
    abertura:
      "Para solicitar nota fiscal ou corrigir algum dado, envie o nome ou razão social, CPF ou CNPJ e as informações da compra. Evite enviar dados bancários ou senhas pelo WhatsApp.",
    tituloLog: "Nota fiscal",
  },
};

function respostaElogio(): string {
  return "Ficamos muito felizes com sua mensagem! 😊 Obrigado por compartilhar sua experiência. Vamos repassar seu elogio para toda a equipe.";
}

async function respostaAvaliacao(estabelecimentoId: string): Promise<string> {
  const { data } = await sb.from("pagina_config").select("avaliacao_url").eq("estabelecimento_id", estabelecimentoId).maybeSingle();
  if (!data?.avaliacao_url) {
    return "Ficamos felizes que tenha gostado! Assim que tivermos o link de avaliação configurado, mando pra você. Muito obrigado pelo carinho! 😊";
  }
  return `Ficamos felizes que tenha gostado! Sua avaliação é muito importante para nós. Você pode contar como foi sua experiência neste link: ${data.avaliacao_url}`;
}

async function getEstabelecimento() {
  const { data, error } = await sb.from("estabelecimento").select("id, nome, nome_fantasia, endereco").limit(1).single();
  if (error) throw new Error("Não foi possível identificar o estabelecimento: " + error.message);
  return data;
}

async function responderCardapio(): Promise<string> {
  return `Confira nosso cardápio completo, com todas as opções e valores: ${CARDAPIO_URL}\n\nPara fazer um pedido por aqui, é só escrever *pedido*.`;
}

function formatarHoraNatural(hhmmss: string): string {
  const hhmm = hhmmss.slice(0, 5);
  if (hhmm === "00:00") return "meia-noite";
  const [h, m] = hhmm.split(":");
  return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

function conectorAteHora(hhmmssFecha: string): string {
  return hhmmssFecha.slice(0, 5) === "00:00" ? "à" : "até";
}

function formatarDiasSemana(dias: number[]): string {
  if (!dias.length) return "";
  const ordenado = [...dias].sort((a, b) => a - b);
  const contiguo = ordenado.every((d, i) => i === 0 || d === ordenado[i - 1] + 1);
  if (contiguo && ordenado.length > 1) return `de ${DIAS[ordenado[0]]} a ${DIAS[ordenado[ordenado.length - 1]]}`;
  return ordenado.map((d) => DIAS[d]).join(", ");
}

type TurnoUniforme = { almocoAbre: string; almocoFecha: string; barAbre: string; barFecha: string; domingoFechado: boolean };

function horarioUniformeSegSab(horario: any): TurnoUniforme | null {
  const chaveDia1 = JSON.stringify(horario["1"] || {});
  const igualEmTodos = [1, 2, 3, 4, 5, 6].every((i) => JSON.stringify(horario[String(i)] || {}) === chaveDia1);
  if (!igualEmTodos) return null;
  const d = horario["1"] || {};
  if (!d.almoco?.abre || !d.almoco?.fecha || !d.bar?.abre || !d.bar?.fecha) return null;
  const domingo = horario["0"] || {};
  const domingoFechado = !domingo.almoco?.abre && !domingo.bar?.abre;
  return { almocoAbre: d.almoco.abre, almocoFecha: d.almoco.fecha, barAbre: d.bar.abre, barFecha: d.bar.fecha, domingoFechado };
}

async function buscarHorarioFuncionamento(estabelecimentoId: string): Promise<any> {
  const { data } = await sb.from("pagina_config").select("horario_funcionamento").eq("estabelecimento_id", estabelecimentoId).maybeSingle();
  return data?.horario_funcionamento || {};
}

async function responderHorario(estabelecimentoId: string): Promise<string> {
  const horario = await buscarHorarioFuncionamento(estabelecimentoId);
  const uniforme = horarioUniformeSegSab(horario);
  if (uniforme) {
    const fechamentoDomingo = uniforme.domingoFechado ? "\n\nAos domingos, não abrimos." : "";
    return `Nosso horário de funcionamento é de segunda a sábado:\n🍽️ Almoço: das ${formatarHoraNatural(uniforme.almocoAbre)} às ${formatarHoraNatural(uniforme.almocoFecha)}\n🍻 Bar: das ${formatarHoraNatural(uniforme.barAbre)} ${conectorAteHora(uniforme.barFecha)} ${formatarHoraNatural(uniforme.barFecha)}${fechamentoDomingo}`;
  }
  const linhas = DIAS.map((nome, i) => {
    const v = horario[String(i)] || {};
    const turnos: string[] = [];
    if (v.almoco?.abre && v.almoco?.fecha) turnos.push(`almoço ${formatarHoraNatural(v.almoco.abre)} às ${formatarHoraNatural(v.almoco.fecha)}`);
    if (v.bar?.abre && v.bar?.fecha) turnos.push(`bar ${formatarHoraNatural(v.bar.abre)} ${conectorAteHora(v.bar.fecha)} ${formatarHoraNatural(v.bar.fecha)}`);
    return `${nome}: ${turnos.length ? turnos.join(", ") : "fechado"}`;
  });
  if (linhas.every((l) => l.endsWith("fechado"))) {
    return "Ainda não temos o horário de funcionamento cadastrado. Já vou chamar alguém da equipe pra te passar certinho.";
  }
  return `Nosso horário de funcionamento:\n${linhas.join("\n")}`;
}

async function responderHorarioAlmoco(estabelecimentoId: string): Promise<string> {
  const horario = await buscarHorarioFuncionamento(estabelecimentoId);
  const uniforme = horarioUniformeSegSab(horario);
  if (!uniforme) return responderHorario(estabelecimentoId);
  const fechamentoDomingo = uniforme.domingoFechado ? " Aos domingos, não abrimos." : "";
  return `Nosso almoço é servido de segunda a sábado, das ${formatarHoraNatural(uniforme.almocoAbre)} às ${formatarHoraNatural(uniforme.almocoFecha)}. 🍽️\n\nPara conferir as opções disponíveis hoje, peça o cardápio do dia por aqui.${fechamentoDomingo}`;
}

async function responderEndereco(estabelecimento: { endereco: string | null }, estabelecimentoId: string): Promise<string> {
  const { data } = await sb.from("pagina_config").select("google_maps_url").eq("estabelecimento_id", estabelecimentoId).maybeSingle();
  if (!estabelecimento.endereco) {
    return "Ainda não temos o endereço cadastrado por aqui. Já vou chamar alguém da equipe pra te passar certinho.";
  }
  const mapa = data?.google_maps_url ? `\n\n📍 Veja a localização e trace sua rota pelo Google Maps: ${data.google_maps_url}` : "";
  return `Estamos na ${estabelecimento.endereco}.${mapa}`;
}

async function responderHappyHour(): Promise<string> {
  const { data } = await sb.from("happy_hour").select("descricao, dias_semana, horario_inicio, horario_fim, ativo").maybeSingle();
  if (!data?.ativo) return "No momento não temos happy hour ativo, mas fique de olho — em breve tem novidade!";
  const dias = formatarDiasSemana(data.dias_semana || []);
  const periodo = data.horario_inicio && data.horario_fim ? `, das ${formatarHoraNatural(data.horario_inicio)} às ${formatarHoraNatural(data.horario_fim)}` : "";
  const descricao = data.descricao || "confira com a equipe os detalhes!";
  return `Nosso Happy Hour acontece ${dias}${periodo}! 🍻\n\n${descricao}\n\nOs petiscos selecionados ficam com preços especiais durante o horário do Happy Hour.`;
}

// Cliente pergunta "e meu pedido?": responde com o último pedido do dia desse telefone.
async function responderStatusPedido(estabelecimentoId: string, telefone: string): Promise<string> {
  const { data } = await sb
    .from("pedido")
    .select("numero, status, total, criado_em")
    .eq("estabelecimento_id", estabelecimentoId)
    .eq("cliente_telefone", telefone)
    .gte("criado_em", new Date(Date.now() - 18 * 3600000).toISOString())
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return "Não encontrei nenhum pedido recente feito por este número. Se quiser fazer um, é só escrever *pedido*.";
  const rotulo: Record<string, string> = {
    confirmado: "recebido e aguardando a cozinha",
    em_preparo: "em preparo 👨‍🍳",
    pronto: "pronto ✅",
    finalizado: "finalizado",
    cancelado: "cancelado",
  };
  return `Seu pedido *#${String(data.numero).padStart(3, "0")}* (${brl(Number(data.total))}) está *${rotulo[data.status] || data.status}*.`;
}

// ---------- Reserva (sem mudanças em relação à Fase 1) ----------

function hojeISOLocal(): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const y = partes.find((p) => p.type === "year")!.value;
  const m = partes.find((p) => p.type === "month")!.value;
  const d = partes.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function somarDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

const DIAS_SEMANA_TXT = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function parseData(t: string): string | null {
  const dataNumerica = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dataNumerica) {
    const dia = Number(dataNumerica[1]);
    const mes = Number(dataNumerica[2]);
    let ano = dataNumerica[3] ? Number(dataNumerica[3]) : Number(hojeISOLocal().slice(0, 4));
    if (ano < 100) ano += 2000;
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  const hoje = hojeISOLocal();
  if (/\bhoje\b/.test(t)) return hoje;
  if (/\bamanha\b/.test(t)) return somarDiasISO(hoje, 1);
  const { diaSemana: diaSemanaHoje } = obterAgoraLocal();
  for (let alvo = 0; alvo < 7; alvo++) {
    if (new RegExp(`\\b${DIAS_SEMANA_TXT[alvo]}\\b`).test(t)) return somarDiasISO(hoje, (alvo - diaSemanaHoje + 7) % 7);
  }
  return null;
}

function parseHorarioReserva(t: string): string | null {
  const m = t.match(/\b(\d{1,2})[:h](\d{2})?\b/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseQuantidade(t: string): number | null {
  const m = t.match(/\b(\d{1,3})\s*pessoas?\b/) || t.match(/\bpara\s+(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 200 ? n : null;
}

function formatarDataBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

type ContextoReserva = { tipo: "reserva"; data?: string | null; horario?: string | null; quantidade?: number | null };

async function tratarFluxoReserva(
  estabelecimentoId: string, telefone: string, nomeContato: string, textoOriginal: string, contextoAtual: any, eraNovoPedido: boolean,
): Promise<{ resposta: string; novoContexto: any }> {
  const t = normalizarTexto(textoOriginal);
  const parcial: ContextoReserva = contextoAtual?.tipo === "reserva" ? contextoAtual : { tipo: "reserva" };
  const data = parseData(t) || parcial.data || null;
  const horario = parseHorarioReserva(t) || parcial.horario || null;
  let quantidade = parseQuantidade(t) || parcial.quantidade || null;
  if (!quantidade && data && horario) {
    const soNumero = t.match(/^\d{1,3}$/);
    if (soNumero) quantidade = Number(soNumero[0]);
  }
  const faltando: string[] = [];
  if (!data) faltando.push("a data");
  if (!horario) faltando.push("o horário");
  if (!quantidade) faltando.push("a quantidade de pessoas");
  if (faltando.length) {
    const novoContexto: ContextoReserva = { tipo: "reserva", data, horario, quantidade };
    if (eraNovoPedido) {
      return {
        resposta:
          "Será um prazer receber você! Pra solicitar sua reserva, me diga:\n\n📅 Data\n🕒 Horário\n👥 Quantidade de pessoas\n\nVocê pode mandar tudo em uma mensagem só (ex.: \"amanhã às 20h, 4 pessoas\"). Após o envio, nossa equipe verificará a disponibilidade.",
        novoContexto,
      };
    }
    return { resposta: `Para continuar com a solicitação, ainda preciso: ${faltando.join(", ")}.`, novoContexto };
  }
  await sb.from("contato_publico").insert({
    estabelecimento_id: estabelecimentoId,
    nome: nomeContato || "Cliente WhatsApp",
    telefone,
    mensagem: `Reserva via WhatsApp (agente): ${quantidade} pessoa(s), às ${horario}.`,
    data_desejada: data,
    pessoas: quantidade,
    horario_desejado: horario,
    status: "novo",
  });
  return {
    resposta: `Recebi sua solicitação para ${quantidade} pessoa(s), no dia ${formatarDataBR(data!)}, às ${horario}, em nome de ${nomeContato || "você"}. Agora nossa equipe verificará a disponibilidade e confirmará por aqui.`,
    novoContexto: {},
  };
}

function obterAgoraLocal(): { diaSemana: number; hhmm: string } {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const mapaDia: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const diaTxt = partes.find((p) => p.type === "weekday")?.value || "Sun";
  const hh = partes.find((p) => p.type === "hour")?.value || "00";
  const mm = partes.find((p) => p.type === "minute")?.value || "00";
  return { diaSemana: mapaDia[diaTxt] ?? 0, hhmm: `${hh}:${mm}` };
}

function horarioConfigurado(horario: any): boolean {
  return Object.values(horario || {}).some((v: any) => (v?.almoco?.abre && v?.almoco?.fecha) || (v?.bar?.abre && v?.bar?.fecha));
}

function estaAbertoAgora(horario: any): boolean {
  const { diaSemana, hhmm } = obterAgoraLocal();
  const v = horario?.[String(diaSemana)] || {};
  const dentroDoTurno = (turno: any) => {
    if (!turno?.abre || !turno?.fecha) return false;
    return turno.abre <= turno.fecha ? turno.abre <= hhmm && hhmm < turno.fecha : hhmm >= turno.abre || hhmm < turno.fecha;
  };
  return dentroDoTurno(v.almoco) || dentroDoTurno(v.bar);
}

// ---------- Consulta de prato específico (catálogo em `produto`) ----------

const PALAVRAS_IGNORADAS = new Set(["de", "da", "do", "com", "para", "the"]);

function palavrasSignificativas(nome: string): string[] {
  return normalizarTexto(nome).split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !PALAVRAS_IGNORADAS.has(p));
}

async function buscarProdutoNoTexto(estabelecimentoId: string, textoOriginal: string): Promise<string | null> {
  const { data } = await sb.from("produto").select("nome, categoria, preco_venda, descricao").eq("estabelecimento_id", estabelecimentoId).eq("ativo", true);
  const tNorm = normalizarTexto(textoOriginal);
  const achados = (data || []).filter((p) => palavrasSignificativas(p.nome).some((palavra) => new RegExp(`\\b${palavra}\\b`).test(tNorm))).slice(0, 5);
  if (!achados.length) return null;
  const linhas = achados.map((p) => {
    const preco = Number(p.preco_venda) > 0 ? brl(Number(p.preco_venda)) : "consulte o valor com a equipe";
    const desc = p.descricao ? ` — ${p.descricao}` : "";
    return `• ${p.nome}: ${preco}${desc}`;
  });
  return `Encontrei isso no nosso cardápio:\n${linhas.join("\n")}\n\nQuer pedir? É só escrever *pedido*.`;
}

async function respostaFallback(estabelecimentoId: string): Promise<string> {
  const horario = await buscarHorarioFuncionamento(estabelecimentoId);
  if (horarioConfigurado(horario) && !estaAbertoAgora(horario)) {
    return "No momento, estamos fora do nosso horário de atendimento. Sua mensagem já ficou registrada e nossa equipe responderá assim que retornarmos. Obrigado pela compreensão!";
  }
  return "Posso te ajudar com:\n1 - Cardápio\n2 - Reserva\n3 - Endereço\n4 - Horário\n5 - Happy hour\n6 - Falar com uma pessoa\n7 - Fazer um pedido\n\nÉ só responder com o número.";
}

const AVISO_LGPD =
  "Oi! Seja bem-vindo(a) ao Serra Dourada Bar e Restaurante! 😊 Sou nosso assistente virtual e estou aqui para agilizar seu atendimento. Para reservas e pedidos, utilizamos seu nome e telefone somente para organizar e confirmar sua solicitação. Se preferir falar diretamente com nossa equipe, é só escrever \"atendente\".";

async function gerarResposta(intencao: Intencao, estabelecimento: { id: string; endereco: string | null }, telefone: string): Promise<string> {
  switch (intencao) {
    case "cardapio": return responderCardapio();
    case "horario": return responderHorario(estabelecimento.id);
    case "horario_almoco": return responderHorarioAlmoco(estabelecimento.id);
    case "endereco": return responderEndereco(estabelecimento, estabelecimento.id);
    case "happy_hour": return responderHappyHour();
    case "elogio": return respostaElogio();
    case "avaliacao": return respostaAvaliacao(estabelecimento.id);
    case "status_pedido": return responderStatusPedido(estabelecimento.id, telefone);
    default: return respostaFallback(estabelecimento.id);
  }
}

// ---------- conversa e mensagens ----------

async function obterOuCriarConversa(estabelecimentoId: string, telefone: string) {
  const existente = await sb.from("whatsapp_conversa").select("id").eq("estabelecimento_id", estabelecimentoId).eq("telefone", telefone).maybeSingle();
  const nova = !existente.data;
  const r = await sb
    .from("whatsapp_conversa")
    .upsert({ estabelecimento_id: estabelecimentoId, telefone, atualizado_em: new Date().toISOString() }, { onConflict: "estabelecimento_id,telefone" })
    .select("id, contexto, atendimento_humano_ate")
    .single();
  if (r.error) throw new Error("Não foi possível obter/criar a conversa: " + r.error.message);
  return { id: r.data.id as string, nova, contexto: r.data.contexto || {}, humanoAte: r.data.atendimento_humano_ate as string | null };
}

// Grava a mensagem recebida ANTES de processar. O índice único em wamid barra reentregas da Meta,
// inclusive as que chegam enquanto a primeira ainda está sendo respondida.
async function registrarEntrada(conversaId: string, recebida: Recebida): Promise<string | null> {
  const conteudo = recebida.texto || `[${recebida.tipo}]`;
  const r = await sb.from("whatsapp_mensagem").insert({ conversa_id: conversaId, direcao: "entrada", conteudo, intencao: null, wamid: recebida.wamid }).select("id").single();
  if (r.error) {
    if (r.error.code === "23505") return null; // já processada
    throw new Error("Não foi possível registrar a mensagem: " + r.error.message);
  }
  return r.data.id;
}

async function responder(conversaId: string, telefone: string, saidas: Saida[]) {
  const token = await segredo("WHATSAPP_TOKEN");
  const phoneId = await segredo("WHATSAPP_PHONE_NUMBER_ID");
  for (const s of saidas) {
    const envio = await enviar(token, phoneId, telefone, s);
    if (envio.status === "falhou") console.error("Falha ao enviar pelo WhatsApp:", envio.erro);
    await sb.from("whatsapp_mensagem").insert({
      conversa_id: conversaId, direcao: "saida", conteudo: textoDaSaida(s), intencao: null,
      wamid: envio.wamid || null, envio_status: envio.status, envio_erro: envio.erro || null,
    });
  }
}

const texto = (t: string): Saida => ({ tipo: "texto", texto: t });

async function tratarWebhook(req: Request): Promise<Response> {
  const corpo = await req.text();

  // 1. Só aceita o que veio da Meta (assinatura com o App Secret). Sem segredo configurado, recusa tudo.
  const appSecret = await segredo("WHATSAPP_APP_SECRET");
  if (!(await assinaturaValida(corpo, req.headers.get("x-hub-signature-256"), appSecret))) {
    console.warn("Webhook recusado: assinatura ausente ou inválida.");
    return new Response("assinatura inválida", { status: 401 });
  }

  const recebida = extrairRecebida(JSON.parse(corpo));
  if (!recebida) return new Response("ok", { status: 200 });

  const estabelecimento = await getEstabelecimento();
  const conversa = await obterOuCriarConversa(estabelecimento.id, recebida.telefone);

  const entradaId = await registrarEntrada(conversa.id, recebida);
  if (!entradaId) return new Response("ok", { status: 200 }); // reentrega da Meta

  const marcarIntencao = (intencao: Intencao) => sb.from("whatsapp_mensagem").update({ intencao }).eq("id", entradaId);

  // 2. Atendimento humano ativo: o robô não responde (a mensagem fica registrada para a equipe).
  if (conversa.humanoAte && new Date(conversa.humanoAte).getTime() > Date.now()) {
    return new Response("ok", { status: 200 });
  }

  // Conversa em andamento (pedido, reserva, triagem) parada há mais de 2 h recomeça do zero.
  let contexto = conversa.contexto || {};
  if (contexto.tipo && (!contexto.atualizadoEm || Date.now() - Date.parse(contexto.atualizadoEm) > CONTEXTO_EXPIRA_MS)) contexto = {};
  const tipoFluxo: string | undefined = contexto?.tipo;
  const intencao = recebida.respostaId ? "fallback" : detectarIntencao(recebida.texto, !tipoFluxo);
  let saidas: Saida[] = [];
  let novoContexto: any = contexto;
  let intencaoLog: Intencao = intencao;

  const entrada = {
    texto: recebida.texto, respostaId: recebida.respostaId, wamid: recebida.wamid,
    telefone: recebida.telefone, nomeContato: recebida.nomeContato, conversaId: conversa.id,
  };
  const textoHorario = () => responderHorario(estabelecimento.id);

  if (intencao === "atendente") {
    // 3. Transferência para pessoa: robô para de responder até a equipe devolver (ou até o prazo).
    const ate = new Date(Date.now() + HORAS_ATENDIMENTO_HUMANO * 3600000).toISOString();
    await sb.from("whatsapp_conversa").update({ atendimento_humano_ate: ate, aguardando_humano_desde: new Date().toISOString() }).eq("id", conversa.id);
    saidas = [texto("Certo! Já chamei alguém da equipe para continuar o atendimento por aqui. Aguarde só um pouquinho. 🙏")];
    novoContexto = {};
  } else if (!tipoFluxo && recebida.respostaId.startsWith("conf:")) {
    // tocou de novo em "Confirmar" de um pedido já fechado: não cria outro, só informa
    saidas = [texto(await responderStatusPedido(estabelecimento.id, recebida.telefone))];
    intencaoLog = "status_pedido";
  } else if (tipoFluxo === "pedido") {
    const r = await continuarPedido(sb, estabelecimento.id, contexto as ContextoPedido, entrada, textoHorario);
    saidas = r.saidas;
    novoContexto = r.contexto;
    intencaoLog = "pedido";
  } else if (intencao === "pedido") {
    const r = await iniciarPedido(sb, estabelecimento.id, entrada, textoHorario);
    saidas = r.saidas;
    novoContexto = r.contexto;
  } else if (tipoFluxo === "reserva" && (intencao === "reserva" || intencao === "fallback")) {
    const r = await tratarFluxoReserva(estabelecimento.id, recebida.telefone, recebida.nomeContato, recebida.texto, contexto, false);
    saidas = [texto(r.resposta)];
    novoContexto = r.novoContexto;
    intencaoLog = "reserva";
  } else if (tipoFluxo === "captura" && intencao === "fallback") {
    const categoria = contexto.categoria as CategoriaCaptura;
    const info = CAPTURAS[categoria];
    await sb.from("contato_publico").insert({
      estabelecimento_id: estabelecimento.id,
      nome: recebida.nomeContato || "Cliente WhatsApp",
      telefone: recebida.telefone,
      mensagem: `[${info.tituloLog}] ${recebida.texto}`,
      status: "novo",
    });
    saidas = [texto("Recebido! Nossa equipe vai analisar e retornar em breve.")];
    novoContexto = {};
    intencaoLog = categoria;
  } else if (intencao === "reserva") {
    const r = await tratarFluxoReserva(estabelecimento.id, recebida.telefone, recebida.nomeContato, recebida.texto, {}, true);
    saidas = [texto(r.resposta)];
    novoContexto = r.novoContexto;
  } else if (intencao in CAPTURAS) {
    saidas = [texto(CAPTURAS[intencao as CategoriaCaptura].abertura)];
    novoContexto = { tipo: "captura", categoria: intencao };
  } else if (recebida.tipo === "audio") {
    saidas = [texto("Por enquanto ainda não consigo ouvir áudios. 🙏 Pode me escrever o que precisa?")];
    novoContexto = {};
  } else {
    if (intencao === "fallback" || intencao === "prato") {
      const respostaProduto = await buscarProdutoNoTexto(estabelecimento.id, recebida.texto);
      if (respostaProduto) {
        saidas = [texto(respostaProduto)];
        intencaoLog = "prato";
      }
    }
    if (!saidas.length) saidas = [texto(await gerarResposta(intencao, estabelecimento, recebida.telefone))];
    novoContexto = {};
  }

  if (conversa.nova && saidas.length) saidas = [texto(AVISO_LGPD), ...saidas];

  if (novoContexto?.tipo) novoContexto = { ...novoContexto, atualizadoEm: new Date().toISOString() };

  await marcarIntencao(intencaoLog);
  await sb.from("whatsapp_conversa").update({ contexto: novoContexto }).eq("id", conversa.id);
  await responder(conversa.id, recebida.telefone, saidas);

  return new Response("ok", { status: 200 });
}

async function tratarVerificacao(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const esperado = await segredo("WHATSAPP_VERIFY_TOKEN");
  if (modo === "subscribe" && esperado && token === esperado && challenge) return new Response(challenge, { status: 200 });
  return new Response("Verificação inválida", { status: 403 });
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "GET") return await tratarVerificacao(req);
    if (req.method === "POST") return await tratarWebhook(req);
    return new Response("Método não suportado", { status: 405 });
  } catch (e) {
    console.error("Erro no webhook do WhatsApp:", e);
    return new Response("ok", { status: 200 }); // 200 para a Meta não reenviar em loop; o erro fica no log
  }
});
