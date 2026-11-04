// Agente de WhatsApp — Fase 1 + Etapa 1 (pedidos, impressão, atendimento humano) + Etapa 2 (triagem e reservas).
// Usa a WhatsApp Cloud API OFICIAL. Respostas por palavra-chave e botões, com dados reais do Supabase.
// Segredos (variáveis da função OU Supabase Vault com o mesmo nome em minúsculas):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas pela plataforma.)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assinaturaValida, enviar, extrairEcos, extrairRecebidas, textoDaSaida, variantesTelefone, type Eco, type Recebida, type Saida } from "./whatsapp.ts";
import { continuarPedido, iniciarPedido, type ContextoPedido } from "./pedido.ts";
import { brl } from "./texto.ts";
import { DIRETO_GESTAO, TRIAGEM, continuarTriagem, iniciarTriagem, responderContatoGestao, type CategoriaTriagem, type ContextoTriagem } from "./triagem.ts";
import { continuarReserva, iniciarReserva, responderMinhaReserva, type ContextoReserva } from "./reserva.ts";
import { MARCA_CARDAPIO, cardapioDoDia, citaCardapio, salvarCardapioDia } from "./cardapio-dia.ts";

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

// o link antigo (storage do Supabase) dava erro 400; a página do site está no ar
const CARDAPIO_URL = "https://serradouradabar.com.br/cardapio-visual.html";
// decisão da gestão: se ninguém da equipe devolver a conversa, o robô volta sozinho em 1 hora
const HORAS_ATENDIMENTO_HUMANO = 1;
// a equipe escreve isto (pelo celular ou WhatsApp Web) para devolver a conversa ao robô na hora
const PALAVRA_DEVOLVER = /#rob[oô](?![a-z])/i;

const CONTEXTO_EXPIRA_MS = 2 * 3600000;

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Intencao =
  | "cardapio" | "horario" | "horario_almoco" | "endereco" | "happy_hour" | "reserva" | "minha_reserva" | "atendente"
  | "elogio" | "avaliacao" | "prato" | "pedido" | "status_pedido" | "outros" | CategoriaTriagem | "fallback";

// "1".."8" respondem ao menu numerado.
const OPCAO_NUMERICA: Record<string, Intencao> = {
  "1": "cardapio",
  "2": "reserva",
  "3": "endereco",
  "4": "horario",
  "5": "happy_hour",
  "6": "atendente",
  "7": "pedido",
  "8": "outros",
};

const MENU =
  "Como posso te ajudar? Responda com o número:\n1 - Cardápio\n2 - Reserva\n3 - Endereço\n4 - Horário\n5 - Happy hour\n6 - Falar com uma pessoa\n7 - Fazer um pedido\n8 - Outros assuntos (currículo, fornecedor, música ao vivo, nota fiscal…)";

// "Outros assuntos": lista com os temas da triagem (o cliente não precisa adivinhar a palavra certa)
const LISTA_ASSUNTOS: Saida = {
  tipo: "lista",
  texto: "Sobre qual assunto você quer falar?",
  botao: "Ver assuntos",
  secoes: [{
    titulo: "Assuntos",
    linhas: [
      { id: "tri:reclamacao", titulo: "Reclamação", descricao: "Algo não saiu como esperado" },
      { id: "tri:gerente", titulo: "Falar com a gerência" },
      { id: "tri:curriculo", titulo: "Trabalhe conosco", descricao: "Enviar currículo" },
      { id: "tri:fornecedor", titulo: "Sou fornecedor" },
      { id: "tri:artista", titulo: "Música ao vivo", descricao: "Artistas e bandas" },
      { id: "tri:parceria", titulo: "Parceria / divulgação" },
      { id: "tri:nota_fiscal", titulo: "Nota fiscal" },
    ],
  }],
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
  if (/\b(minhas? reservas?|status da reserva|reserva (ja )?(foi |esta )?confirmada)\b/.test(t)) return "minha_reserva";
  if (/\b(sou (musico|cantor|cantora|dj)|minha banda|nossa banda|tocar (ai|aqui|no bar|na casa)|musica ao vivo|show ao vivo|apresentacao musical|cache)\b/.test(t)) return "artista";
  // assuntos da gestão vêm antes de "pedido": "quero falar com o gerente" não é pedido de comida
  if (/gerente|falar com o dono|responsavel pelo restaurante/.test(t)) return "gerente";
  // "sem problema" / "nenhum problema" é concordância, não reclamação
  if (/reclama|(?<!sem |nenhum |nao tem |nao ha )\bproblemas?\b|insatisfeit|pessimo|decepcion/.test(t)) return "reclamacao";
  if (/emprego|curriculo|trabalhar (aqui|conosco|com voces|na equipe)|vagas? de (emprego|trabalho)/.test(t)) return "curriculo";
  if (/fornecedor|fornecimento|represent(o|amos) a empresa/.test(t)) return "fornecedor";
  if (/parceria|divulgacao|publicidade|permuta|influenciador/.test(t)) return "parceria";
  if (/nota fiscal|\bnf\b|cnpj|razao social/.test(t)) return "nota_fiscal";
  if (/\breserv|\bmesa\b/.test(t)) return "reserva";
  if (/happy ?hour|promoc|spaten|4[aª]? e do serra|terca delas|\bdelas\b/.test(t)) return "happy_hour";
  if (/cardapio|menu|\bmistura\b|almoco de hoje|o que tem (hoje|de almoco|pro almoco|no almoco)/.test(t)) return "cardapio";
  // palavras inteiras: "fechar o pedido" e "como funciona o pedido" não são pergunta de horário
  if (/\b(horarios?|funcionamento|que horas|abre|abrem|fecha|fecham|aberto|abertos)\b/.test(t)) return "horario";
  if (/endereco|localizacao|onde fica|como chegar|mapa/.test(t)) return "endereco";
  if (/\b(pedir|pedido|fazer (um )?pedido|delivery|encomendar|marmit|quero|me (ve|manda)|manda (um|uma|dois|duas))\b/.test(t)) return "pedido";
  if (/almoc/.test(t)) return "horario_almoco";

  if (/elogio|parabens|adorei|amei|maravilhoso|show de bola/.test(t)) return "elogio";
  if (/avali|deixar.*review|nota no google/.test(t)) return "avaliacao";
  if (/prato|quanto custa|preco|valor/.test(t)) return "prato";

  return "fallback";
}

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

async function responderCardapio(estabelecimentoId: string): Promise<string> {
  const doDia = await cardapioDoDia(sb, estabelecimentoId);
  const hoje = doDia ? `🍽️ *Almoço de hoje:*\n${doDia}\n\n` : "";
  return `${hoje}Confira nosso cardápio completo, com todas as opções e valores: ${CARDAPIO_URL}\n\nPara fazer um pedido por aqui, é só escrever *pedido*.`;
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
    return "Ainda não temos o horário de funcionamento cadastrado por aqui. Escreva *atendente* que alguém da equipe te passa certinho.";
  }
  return `Nosso horário de funcionamento:\n${linhas.join("\n")}`;
}

async function responderHorarioAlmoco(estabelecimentoId: string): Promise<string> {
  const horario = await buscarHorarioFuncionamento(estabelecimentoId);
  const uniforme = horarioUniformeSegSab(horario);
  if (!uniforme) return responderHorario(estabelecimentoId);
  const fechamentoDomingo = uniforme.domingoFechado ? " Aos domingos, não abrimos." : "";
  const doDia = await cardapioDoDia(sb, estabelecimentoId);
  const hoje = doDia ? `\n\n*Hoje no almoço:*\n${doDia}` : "";
  return `Nosso almoço é servido de segunda a sábado, das ${formatarHoraNatural(uniforme.almocoAbre)} às ${formatarHoraNatural(uniforme.almocoFecha)}. 🍽️${fechamentoDomingo}${hoje}\n\nPara ver o cardápio, escreva *cardápio*. Para pedir, escreva *pedido*.`;
}

async function responderEndereco(estabelecimento: { endereco: string | null }, estabelecimentoId: string): Promise<string> {
  const { data } = await sb.from("pagina_config").select("google_maps_url").eq("estabelecimento_id", estabelecimentoId).maybeSingle();
  if (!estabelecimento.endereco) {
    return "Ainda não temos o endereço cadastrado por aqui. Escreva *atendente* que alguém da equipe te passa certinho.";
  }
  const mapa = data?.google_maps_url ? `\n\n📍 Veja a localização e trace sua rota pelo Google Maps: ${data.google_maps_url}` : "";
  return `Estamos na ${estabelecimento.endereco}.${mapa}`;
}

// Promoções cadastradas no site (A 4ª é do Serra, Terça Delas, Chopp a R$ 7,90…). Só colunas públicas:
// a senha do cardápio da promoção nunca sai daqui.
const DIA_PROMO = ["todo domingo", "toda segunda", "toda terça", "toda quarta", "toda quinta", "toda sexta", "todo sábado"];
async function promocoesSalao(): Promise<string[]> {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const { data } = await sb.from("promocao").select("titulo, descricao, condicoes, dia_semana, hora_inicio, ordem, valido_de, valido_ate").eq("ativo", true);
  const { diaSemana } = obterAgoraLocal();
  return (data || [])
    .filter((p: any) => (!p.valido_de || p.valido_de <= hoje) && (!p.valido_ate || p.valido_ate >= hoje))
    .sort((a: any, b: any) => (a.dia_semana ?? 9) - (b.dia_semana ?? 9) || (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((p: any) => {
      const quando = p.dia_semana != null
        ? `${DIA_PROMO[p.dia_semana]}${p.hora_inicio ? `, a partir das ${formatarHoraNatural(p.hora_inicio)}` : ""}${p.dia_semana === diaSemana ? " (é hoje!)" : ""}`
        : "";
      return [`🔸 *${p.titulo}*${quando ? ` — ${quando}` : ""}`, p.descricao, p.condicoes ? `_${p.condicoes}_` : ""].filter(Boolean).join("\n");
    });
}

async function responderHappyHour(): Promise<string> {
  const { data } = await sb.from("happy_hour").select("descricao, dias_semana, horario_inicio, horario_fim, ativo").maybeSingle();
  const partes: string[] = [];
  if (data?.ativo) {
    const dias = formatarDiasSemana(data.dias_semana || []);
    const periodo = data.horario_inicio && data.horario_fim ? `, das ${formatarHoraNatural(data.horario_inicio)} às ${formatarHoraNatural(data.horario_fim)}` : "";
    partes.push(`Nosso Happy Hour acontece ${dias}${periodo}! 🍻\n\n${data.descricao || "confira com a equipe os detalhes!"}`);
  }
  partes.push(...(await promocoesSalao()));
  // só o que está cadastrado: nada de promessa que não esteja no banco
  if (!partes.length) return "No momento não temos promoção ativa, mas fique de olho — em breve tem novidade!";
  return `${partes.join("\n\n")}\n\n_Promoções válidas só para consumo no salão._`;
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

async function abertoAgora(estabelecimentoId: string): Promise<boolean> {
  const horario = await buscarHorarioFuncionamento(estabelecimentoId);
  return !horarioConfigurado(horario) || estaAbertoAgora(horario);
}

// Fora do horário o menu continua: o cliente pode adiantar reserva e outros assuntos à noite/de madrugada.
async function respostaFallback(estabelecimentoId: string): Promise<string> {
  if (!(await abertoAgora(estabelecimentoId))) {
    return `Estamos fora do horário de atendimento agora, mas por aqui você já pode adiantar reserva e outros assuntos. O que precisar de uma pessoa da equipe, respondemos assim que retomarmos.\n\n${MENU}`;
  }
  return MENU;
}

const AVISO_LGPD =
  "Oi! Seja bem-vindo(a) ao Serra Dourada Bar e Restaurante! 😊 Sou o assistente virtual da casa e estou aqui para agilizar seu atendimento. Para reservas e pedidos, usamos seu nome e telefone só para organizar e confirmar sua solicitação. Para falar com uma pessoa da equipe, é só escrever \"atendente\". Nossa política de privacidade: https://serradouradabar.com.br/privacidade.html";

async function gerarResposta(intencao: Intencao, estabelecimento: { id: string; endereco: string | null }, telefone: string): Promise<string> {
  switch (intencao) {
    case "cardapio": return responderCardapio(estabelecimento.id);
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
  const conteudo = recebida.midia
    ? `[${recebida.midia.tipo === "image" ? "foto" : "arquivo"}: ${recebida.midia.nome}]${recebida.texto ? " " + recebida.texto : ""}`
    : recebida.texto || `[${recebida.tipo}]`;
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

  const payload = JSON.parse(corpo);
  const recebidas = extrairRecebidas(payload);
  const ecos = extrairEcos(payload);
  if (!recebidas.length && !ecos.length) return new Response("ok", { status: 200 }); // só avisos de entrega/leitura

  const estabelecimento = await getEstabelecimento();
  for (const eco of ecos) {
    try {
      await registrarEco(estabelecimento.id, eco);
    } catch (e) {
      console.error("Erro ao registrar resposta da equipe:", e);
    }
  }
  // uma por vez, na ordem: a Meta pode juntar várias mensagens na mesma entrega
  for (const recebida of recebidas) {
    try {
      await processarMensagem(estabelecimento, recebida);
    } catch (e) {
      console.error("Erro ao processar mensagem do WhatsApp:", e);
    }
  }
  return new Response("ok", { status: 200 });
}

// A equipe respondeu pelo app do celular (coexistência): o robô fica em silêncio por 1 hora a partir
// da última resposta dela. Se a mensagem tiver #robo, a conversa volta para o robô na hora.
async function registrarEco(estabelecimentoId: string, eco: Eco): Promise<void> {
  // "#cardapio ..." mandado pelo próprio número do restaurante: vira o cardápio de hoje (não pausa conversa nenhuma)
  if (MARCA_CARDAPIO.test(eco.texto)) return salvarCardapioDia(sb, estabelecimentoId, eco.texto, eco.wamid);
  const { data: achada } = await sb.from("whatsapp_conversa").select("id").eq("estabelecimento_id", estabelecimentoId)
    .in("telefone", variantesTelefone(eco.para)).limit(1).maybeSingle();
  const conversaId = achada?.id || (await obterOuCriarConversa(estabelecimentoId, eco.para)).id;
  const r = await sb.from("whatsapp_mensagem").insert({
    conversa_id: conversaId, direcao: "saida", conteudo: "[equipe pelo celular] " + eco.texto, intencao: null, wamid: eco.wamid, envio_status: "enviado",
  });
  if (r.error?.code === "23505") return; // reentrega da Meta
  if (r.error) throw new Error("registrar eco: " + r.error.message);
  const devolver = PALAVRA_DEVOLVER.test(eco.texto);
  await sb.from("whatsapp_conversa").update(devolver
    ? { atendimento_humano_ate: null, atendimento_humano_por: null, aguardando_humano_desde: null, contexto: {}, atualizado_em: new Date().toISOString() }
    : { atendimento_humano_ate: new Date(Date.now() + HORAS_ATENDIMENTO_HUMANO * 3600000).toISOString(), aguardando_humano_desde: null, contexto: {}, atualizado_em: new Date().toISOString() },
  ).eq("id", conversaId);
}

async function processarMensagem(estabelecimento: { id: string; endereco: string | null }, recebida: Recebida): Promise<void> {
  const conversa = await obterOuCriarConversa(estabelecimento.id, recebida.telefone);

  const entradaId = await registrarEntrada(conversa.id, recebida);
  if (!entradaId) return; // reentrega da Meta

  const marcarIntencao = (intencao: Intencao) => sb.from("whatsapp_mensagem").update({ intencao }).eq("id", entradaId);

  // 2. Atendimento humano ativo: o robô não responde (a mensagem fica registrada para a equipe).
  if (conversa.humanoAte && new Date(conversa.humanoAte).getTime() > Date.now()) return;

  // Conversa em andamento (pedido, reserva, triagem) parada há mais de 2 h recomeça do zero.
  let contexto = conversa.contexto || {};
  if (contexto.tipo && (!contexto.atualizadoEm || Date.now() - Date.parse(contexto.atualizadoEm) > CONTEXTO_EXPIRA_MS)) contexto = {};
  // um "oi" depois de um protocolo é conversa nova, não complemento do atendimento
  if (contexto.tipo === "complemento" && /^(oi+|ola|opa|bom dia|boa tarde|boa noite|e ai)[!. ]*$/.test(normalizarTexto(recebida.texto))) contexto = {};
  const tipoFluxo: string | undefined = contexto?.tipo;
  // atalho numérico do menu vale fora de fluxo e logo depois de um protocolo ("2" = reserva, não complemento)
  const intencao = recebida.respostaId ? "fallback" : detectarIntencao(recebida.texto, !tipoFluxo || tipoFluxo === "complemento");
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
    saidas = [texto(await abertoAgora(estabelecimento.id)
      ? "Certo! Já chamei alguém da equipe para continuar o atendimento por aqui. Aguarde só um pouquinho. 🙏"
      : "Certo! Deixei avisado para a equipe. Estamos fora do horário agora, então a resposta chega por aqui assim que retomarmos o atendimento. 🙏")];
    novoContexto = {};
  } else if ((recebida.respostaId.startsWith("tri:") && DIRETO_GESTAO.has(recebida.respostaId.slice(4)))
    || (!recebida.respostaId && (!tipoFluxo || tipoFluxo === "complemento") && DIRETO_GESTAO.has(intencao))) {
    // currículo, fornecedor, artista e parceria: contato direto da gestão (decisão de 04/11)
    const categoria = recebida.respostaId.startsWith("tri:") ? recebida.respostaId.slice(4) : intencao;
    saidas = [await responderContatoGestao(sb, estabelecimento.id, categoria)];
    novoContexto = {};
    intencaoLog = categoria as CategoriaTriagem;
  } else if (recebida.respostaId.startsWith("tri:") && recebida.respostaId.slice(4) in TRIAGEM) {
    // tocou num assunto da lista "Outros assuntos"
    const r = iniciarTriagem(recebida.respostaId.slice(4) as CategoriaTriagem);
    saidas = r.saidas;
    novoContexto = r.contexto;
    intencaoLog = recebida.respostaId.slice(4) as CategoriaTriagem;
  } else if (tipoFluxo === "complemento" && intencao === "fallback" && !recebida.respostaId && !recebida.midia
    && /^(ok+|okay|obrigad[oa]s?|brigad[oa]|valeu|vlw|blz|beleza|certo|ta bom|tá bom|show|top|perfeito|👍|🙏)[!. ]*$/i.test(recebida.texto.trim())) {
    saidas = [texto("Por nada! Qualquer coisa, é só chamar. 😊")];
    novoContexto = {};
  } else if (tipoFluxo === "complemento" && intencao === "fallback" && !recebida.respostaId && (recebida.texto.trim() || recebida.midia)) {
    // logo depois de abrir um protocolo, o que o cliente escrever entra no mesmo atendimento
    const extra = recebida.midia ? `[arquivo enviado: ${recebida.midia.nome}] ${recebida.texto}`.trim() : recebida.texto.trim();
    if (extra) {
      await sb.from("atendimento_adm_evento").insert({ atendimento_id: contexto.atendimentoId, tipo: "nota", texto: ("Cliente acrescentou: " + extra).slice(0, 1000), ator: "cliente" });
      await sb.from("atendimento_adm").update({ atualizado_em: new Date().toISOString() }).eq("id", contexto.atendimentoId);
    }
    saidas = [texto(`📝 Acrescentei ao protocolo *${contexto.protocolo}*. A equipe vai ver junto com o resto.`)];
    intencaoLog = "fallback";
  } else if (!tipoFluxo && recebida.respostaId.startsWith("conf:")) {
    // tocou de novo em "Confirmar" de um pedido já fechado: não cria outro, só informa
    saidas = [texto(await responderStatusPedido(estabelecimento.id, recebida.telefone))];
    intencaoLog = "status_pedido";
  } else if (tipoFluxo === "pedido") {
    const r = await continuarPedido(sb, estabelecimento.id, contexto as ContextoPedido, entrada, textoHorario);
    saidas = r.saidas;
    novoContexto = r.contexto;
    intencaoLog = "pedido";
  } else if (tipoFluxo === "triagem") {
    // triagem em andamento: tudo que o cliente escreve é resposta (inclusive "o pedido veio frio")
    const r = await continuarTriagem(sb, estabelecimento.id, contexto as ContextoTriagem, { ...entrada, midia: recebida.midia }, segredo);
    saidas = r.saidas;
    novoContexto = r.contexto;
    intencaoLog = (contexto as ContextoTriagem).categoria;
  } else if (tipoFluxo === "reserva" && ((contexto as ContextoReserva).etapa !== "dados" || recebida.respostaId || intencao === "reserva" || intencao === "fallback")) {
    const r = await continuarReserva(sb, estabelecimento.id, contexto as ContextoReserva, entrada, segredo);
    saidas = r.saidas;
    novoContexto = r.contexto;
    intencaoLog = "reserva";
  } else if (intencao === "pedido") {
    const r = await iniciarPedido(sb, estabelecimento.id, entrada, textoHorario);
    saidas = r.saidas;
    novoContexto = r.contexto;
  } else if (intencao === "minha_reserva") {
    saidas = [texto(await responderMinhaReserva(sb, estabelecimento.id, recebida.telefone))];
    novoContexto = {};
  } else if (intencao === "reserva") {
    const r = await iniciarReserva(sb, estabelecimento.id, entrada);
    saidas = r.saidas;
    novoContexto = r.contexto;
  } else if (intencao === "outros") {
    saidas = [LISTA_ASSUNTOS];
    novoContexto = {};
  } else if (intencao in TRIAGEM) {
    const r = iniciarTriagem(intencao as CategoriaTriagem);
    saidas = r.saidas;
    novoContexto = r.contexto;
  } else if (recebida.tipo === "audio") {
    saidas = [texto("Por enquanto ainda não consigo ouvir áudios. 🙏 Pode me escrever o que precisa?")];
    novoContexto = {};
  } else {
    if (intencao === "fallback" || intencao === "prato") {
      // "tem feijoada hoje?": responde com o cardápio do dia
      const doDia = await cardapioDoDia(sb, estabelecimento.id);
      if (doDia && citaCardapio(recebida.texto, doDia)) {
        saidas = [texto(`😊 *Hoje no almoço temos:*\n${doDia}\n\nPara pedir, escreva *pedido*.`)];
        intencaoLog = "cardapio";
      }
    }
    if (!saidas.length && (intencao === "fallback" || intencao === "prato")) {
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
