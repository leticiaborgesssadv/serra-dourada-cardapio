// Triagem para a gestão: fornecedores, currículos, artistas, parcerias, reclamações, nota fiscal, gerente.
// O robô faz poucas perguntas (uma por vez), abre um atendimento com protocolo e avisa a gestão
// por mensagem modelo aprovada pela Meta, SEM dados pessoais do cliente. O cliente nunca recebe o número da gestão.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { baixarMidia, enviarModelo, type Midia, type Saida } from "./whatsapp.ts";
import { normalizar } from "./texto.ts";

export type CategoriaTriagem = "reclamacao" | "gerente" | "curriculo" | "fornecedor" | "artista" | "parceria" | "nota_fiscal";

type Pergunta = { rotulo: string; texto: string; opcional?: boolean; aceitaArquivo?: boolean };
type Definicao = { abertura: string; perguntas: Pergunta[]; fechamento: string };

export const TITULO_CATEGORIA: Record<string, string> = {
  reclamacao: "Reclamação",
  gerente: "Falar com a gerência",
  curriculo: "Currículo",
  fornecedor: "Fornecedor",
  artista: "Artista / música",
  parceria: "Parceria / divulgação",
  nota_fiscal: "Nota fiscal",
  reserva_especial: "Reserva especial",
  outro: "Outro assunto",
};

export const TRIAGEM: Record<CategoriaTriagem, Definicao> = {
  reclamacao: {
    abertura: "Sentimos muito que sua experiência não tenha sido como esperava. Queremos entender e resolver.",
    perguntas: [
      { rotulo: "O que aconteceu", texto: "Conte o que aconteceu, por favor." },
      { rotulo: "Quando", texto: "Qual foi a data e o horário da visita ou do pedido? (se não lembrar, escreva *pular*)", opcional: true },
    ],
    fechamento: "O responsável vai analisar e retornar por aqui.",
  },
  gerente: {
    abertura: "Certo, vou encaminhar para a gerência.",
    perguntas: [{ rotulo: "Assunto", texto: "Me conte, em poucas palavras, qual é o assunto." }],
    fechamento: "A gerência vai analisar e retornar por aqui.",
  },
  curriculo: {
    abertura: "Obrigado pelo interesse em trabalhar conosco!",
    perguntas: [
      { rotulo: "Nome", texto: "Qual é o seu nome completo?" },
      { rotulo: "Função desejada", texto: "Para qual função? (ex.: garçom, cozinha, caixa, bar)" },
      { rotulo: "Experiência", texto: "Conte resumidamente sua experiência. Se tiver o currículo em PDF ou foto, pode enviar aqui.", aceitaArquivo: true },
    ],
    fechamento: "Nossa equipe vai analisar e entra em contato se o seu perfil for selecionado.",
  },
  fornecedor: {
    abertura: "Olá! Vamos registrar sua apresentação para o setor de compras.",
    perguntas: [
      { rotulo: "Empresa", texto: "Qual é o nome da empresa?" },
      { rotulo: "Produtos ou serviços", texto: "Quais produtos ou serviços vocês oferecem? Se tiver catálogo, pode enviar o arquivo.", aceitaArquivo: true },
      { rotulo: "Contato", texto: "Com quem devemos falar e qual o melhor horário? (ou *pular*)", opcional: true },
    ],
    fechamento: "Se houver interesse, o setor responsável entra em contato.",
  },
  artista: {
    abertura: "Que bom! Adoramos música ao vivo. 🎶",
    perguntas: [
      { rotulo: "Artista e estilo", texto: "Qual o nome artístico e o estilo musical?" },
      { rotulo: "Link / material", texto: "Tem link do Instagram, YouTube ou portfólio? Pode mandar o link ou um arquivo. (ou *pular*)", opcional: true, aceitaArquivo: true },
      { rotulo: "Formação e cachê", texto: "Formação (solo, duo, banda) e valor do cachê, se quiser informar. (ou *pular*)", opcional: true },
    ],
    fechamento: "A gestão avalia a agenda e retorna se houver data disponível.",
  },
  parceria: {
    abertura: "Obrigado pelo contato!",
    perguntas: [
      { rotulo: "Empresa ou perfil", texto: "Qual é a empresa ou o perfil (ex.: @seuinstagram)?" },
      { rotulo: "Proposta", texto: "Qual é a proposta? Se tiver mídia kit, pode enviar o arquivo.", aceitaArquivo: true },
    ],
    fechamento: "A equipe responsável vai avaliar e retornar por aqui.",
  },
  nota_fiscal: {
    abertura: "Vamos registrar seu pedido de nota fiscal. Não envie dados bancários nem senhas por aqui.",
    perguntas: [
      { rotulo: "Compra", texto: "Qual foi a data e o valor aproximado da compra?" },
      { rotulo: "Dados para a nota", texto: "Nome ou razão social e CPF ou CNPJ para a nota." },
    ],
    fechamento: "A equipe vai emitir ou corrigir e retorna por aqui.",
  },
};

export type ContextoTriagem = {
  tipo: "triagem";
  categoria: CategoriaTriagem;
  passo: number;
  dados: Record<string, string>;
  anexos: Midia[];
};

export type EntradaTriagem = { texto: string; wamid: string; telefone: string; nomeContato: string; conversaId: string; midia: Midia | null };
type Resultado = { saidas: Saida[]; contexto: Record<string, unknown> };

const texto = (t: string): Saida => ({ tipo: "texto", texto: t });
const PULAR = ["pular", "pula", "nao", "nao tenho", "nenhum", "sem", "-"];
const CANCELAR = ["cancelar", "cancela", "desisto", "sair"];

function pergunta(def: Definicao, passo: number): string {
  return def.perguntas[passo].texto;
}

export function iniciarTriagem(categoria: CategoriaTriagem): Resultado {
  const def = TRIAGEM[categoria];
  const ctx: ContextoTriagem = { tipo: "triagem", categoria, passo: 0, dados: {}, anexos: [] };
  return { saidas: [texto(`${def.abertura}\n\n${pergunta(def, 0)}\n\n_Para desistir, escreva *cancelar*._`)], contexto: ctx };
}

// Aviso à gestão: só protocolo, assunto e prioridade (nada de nome ou telefone do cliente).
export async function avisarGestao(
  sb: SupabaseClient, estab: string, segredo: (n: string) => Promise<string>,
  at: { id: string; protocolo: string; prioridade: string }, categoria: string,
): Promise<string> {
  const { data: cfg } = await sb.from("triagem_config").select("telefone_gestao, modelo_aviso, modelo_idioma").eq("estabelecimento_id", estab).maybeSingle();
  const token = await segredo("WHATSAPP_TOKEN");
  const phoneId = await segredo("WHATSAPP_PHONE_NUMBER_ID");
  let status = "nao_configurado";
  let erro: string | null = null;
  if (cfg?.telefone_gestao && cfg?.modelo_aviso && token && phoneId) {
    const r = await enviarModelo(token, phoneId, cfg.telefone_gestao, cfg.modelo_aviso, cfg.modelo_idioma,
      [at.protocolo, TITULO_CATEGORIA[categoria] || categoria, at.prioridade.toUpperCase()]);
    status = r.status === "enviado" ? "enviado" : "falhou";
    erro = r.erro || null;
  }
  await sb.rpc("registrar_aviso_gestao", { p_id: at.id, p_status: status, p_erro: erro });
  return status;
}

// Guarda os arquivos num bucket privado. Sem token da Meta, fica só o registro (status "pendente").
async function salvarAnexos(sb: SupabaseClient, segredo: (n: string) => Promise<string>, atendimentoId: string, anexos: Midia[]) {
  const token = await segredo("WHATSAPP_TOKEN");
  for (const a of anexos) {
    const { data: reg } = await sb.from("atendimento_adm_anexo")
      .insert({ atendimento_id: atendimentoId, meta_media_id: a.id, tipo: a.tipo, mime: a.mime, nome_arquivo: a.nome })
      .select("id").single();
    if (!reg || !token) continue;
    try {
      const { bytes, mime } = await baixarMidia(token, a.id);
      const caminho = `${atendimentoId}/${reg.id}-${a.nome.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("triagem").upload(caminho, bytes, { contentType: mime, upsert: false });
      if (up.error) throw new Error(up.error.message);
      await sb.from("atendimento_adm_anexo").update({ status: "salvo", storage_path: caminho }).eq("id", reg.id);
    } catch (e) {
      await sb.from("atendimento_adm_anexo").update({ status: "falhou", erro: String(e).slice(0, 300) }).eq("id", reg.id);
    }
  }
}

export async function continuarTriagem(
  sb: SupabaseClient, estab: string, ctx: ContextoTriagem, e: EntradaTriagem, segredo: (n: string) => Promise<string>,
): Promise<Resultado> {
  const def = TRIAGEM[ctx.categoria];
  if (!def) return { saidas: [], contexto: {} };
  const t = normalizar(e.texto);
  if (CANCELAR.includes(t)) return { saidas: [texto("Tudo bem, não registrei nada. Se precisar, é só chamar! 😊")], contexto: {} };

  const p = def.perguntas[ctx.passo];
  let resposta = e.texto.trim();

  if (e.midia) {
    if (ctx.anexos.length < 5) ctx.anexos.push(e.midia);
    if (!p.aceitaArquivo && !resposta) {
      return { saidas: [texto(`Recebi o arquivo 📎 e vou anexar ao atendimento.\n\n${pergunta(def, ctx.passo)}`)], contexto: ctx };
    }
    if (!resposta) resposta = `[arquivo enviado: ${e.midia.nome}]`;
  } else if (p.opcional && PULAR.includes(t)) {
    resposta = "";
  } else if (resposta.length < 2) {
    return { saidas: [texto(pergunta(def, ctx.passo))], contexto: ctx };
  }

  if (resposta) ctx.dados[p.rotulo] = resposta.slice(0, 1000);
  ctx.passo++;
  if (ctx.passo < def.perguntas.length) return { saidas: [texto(pergunta(def, ctx.passo))], contexto: ctx };

  // fim das perguntas: abre o atendimento (idempotente pelo id da mensagem)
  const primeira = def.perguntas.map((q) => ctx.dados[q.rotulo]).find(Boolean) || "";
  const { data, error } = await sb.rpc("abrir_atendimento_adm", {
    p_estab: estab, p_chave: "wa:" + e.wamid, p_conversa: e.conversaId,
    p_dados: { categoria: ctx.categoria, nome: e.nomeContato, telefone: e.telefone, resumo: primeira.slice(0, 200), dados: ctx.dados },
  });
  if (error) throw new Error("abrir_atendimento_adm: " + error.message);

  if (!data.duplicado) {
    if (ctx.anexos.length) await salvarAnexos(sb, segredo, data.id, ctx.anexos);
    if (data.avisar) await avisarGestao(sb, estab, segredo, data, ctx.categoria);
  }

  const urgente = data.prioridade === "urgente" || data.prioridade === "alta";
  const linhas = [
    `✅ Recebido! Seu protocolo é *${data.protocolo}*.`,
    def.fechamento,
    ...(urgente ? ["Sua mensagem foi marcada como *prioridade* para a gestão."] : []),
    ...(ctx.anexos.length ? [`📎 ${ctx.anexos.length} arquivo(s) anexado(s).`] : []),
    "\nSe quiser complementar, é só citar o protocolo.",
  ];
  return { saidas: [texto(linhas.join("\n"))], contexto: {} };
}
