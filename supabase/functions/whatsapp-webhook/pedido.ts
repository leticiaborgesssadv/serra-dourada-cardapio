// Fluxo de pedido pelo WhatsApp. O carrinho guarda só os itens (id + quantidade + detalhe):
// preço, disponibilidade, taxas e total vêm SEMPRE do banco (calcular_pedido / criar_pedido).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Saida, LinhaLista } from "./whatsapp.ts";
import { interpretar, lerQuantidade, lerValor, normalizar, brl, type ItemCatalogo } from "./texto.ts";

type ItemCarrinho = { cardapio_id: string; nome: string; quantidade: number; detalhe?: string };

export type ContextoPedido = {
  tipo: "pedido";
  etapa: string;
  carrinho: ItemCarrinho[];
  grupo?: string;
  categoria?: string;
  pagina?: number;
  pendente?: { cardapio_id: string; nome: string; pergunta?: string | null; detalhe?: string; quantidade?: number };
  textoPendente?: string; // partes da mensagem ainda não resolvidas (retomadas depois de cada passo)
  duvida?: { quantidade: number; opcoes: { id: string; nome: string }[] };
  modalidade?: "retirada" | "entrega";
  endereco?: string;
  nome?: string;
  pagamento?: "pix" | "cartao" | "dinheiro";
  troco_para?: number | null;
  observacao?: string | null;
};

export type Entrada = { texto: string; respostaId: string; wamid: string; telefone: string; nomeContato: string; conversaId: string };
export type Resultado = { saidas: Saida[]; contexto: Record<string, unknown> };

const POR_PAGINA = 9;
const PALAVRAS_CANCELAR = ["cancelar", "cancela", "desisto", "sair"];

async function catalogo(sb: SupabaseClient, estab: string): Promise<ItemCatalogo[]> {
  const { data, error } = await sb.rpc("catalogo_pedido_agora", { p_estab: estab });
  if (error) throw new Error("catálogo: " + error.message);
  return (data || []).map((i: any) => ({ id: i.id, nome: i.nome, preco: Number(i.preco), categoria: i.categoria, grupo: i.grupo, pergunta: i.pergunta }));
}

async function config(sb: SupabaseClient, estab: string) {
  const { data } = await sb.from("pedido_config").select("*").eq("estabelecimento_id", estab).maybeSingle();
  return data;
}

async function calcular(sb: SupabaseClient, estab: string, ctx: ContextoPedido): Promise<any> {
  const { data, error } = await sb.rpc("calcular_pedido", { p_estab: estab, p_dados: dadosDoPedido(ctx, "") });
  if (error) throw new Error("cálculo: " + error.message);
  return data;
}

function dadosDoPedido(ctx: ContextoPedido, telefone: string) {
  return {
    cliente_nome: ctx.nome,
    cliente_telefone: telefone,
    modalidade: ctx.modalidade,
    endereco: ctx.endereco,
    pagamento: ctx.pagamento,
    troco_para: ctx.troco_para ?? null,
    observacao: ctx.observacao ?? null,
    itens: ctx.carrinho.map((i) => ({ cardapio_id: i.cardapio_id, quantidade: i.quantidade, detalhe: i.detalhe || null })),
  };
}

function novo(): ContextoPedido {
  return { tipo: "pedido", etapa: "grupos", carrinho: [] };
}

// ---------- telas ----------

function telaGrupos(itens: ItemCatalogo[]): Saida {
  const grupos: string[] = [];
  for (const i of itens) if (!grupos.includes(i.grupo)) grupos.push(i.grupo);
  return {
    tipo: "lista",
    texto: "O que você gostaria de pedir? Escolha uma seção do cardápio.\n\nSe preferir, escreva direto, por exemplo: _2 espetinhos de picanha e 1 coca lata_.",
    botao: "Ver cardápio",
    secoes: [{ titulo: "Cardápio", linhas: grupos.slice(0, 10).map((g) => ({ id: "g:" + g.slice(0, 180), titulo: g, descricao: `${itens.filter((i) => i.grupo === g).length} opções` })) }],
  };
}

function telaItens(itens: ItemCatalogo[], grupo: string, pagina: number): Saida {
  const doGrupo = itens.filter((i) => i.grupo === grupo);
  const inicio = pagina * POR_PAGINA;
  const pedaco = doGrupo.slice(inicio, inicio + POR_PAGINA);
  const linhas: LinhaLista[] = pedaco.map((i) => ({ id: "i:" + i.id, titulo: i.nome, descricao: `${brl(i.preco)}${i.categoria !== grupo ? " · " + i.categoria : ""}` }));
  if (inicio + POR_PAGINA < doGrupo.length) linhas.push({ id: "mais:" + (pagina + 1), titulo: "Ver mais opções", descricao: `Itens ${inicio + POR_PAGINA + 1} a ${Math.min(doGrupo.length, inicio + 2 * POR_PAGINA)}` });
  return {
    tipo: "lista",
    texto: `*${grupo}*${doGrupo.length > POR_PAGINA ? ` (página ${pagina + 1})` : ""}\nEscolha um item. Para voltar às seções, escreva *cardápio*.`,
    botao: "Escolher item",
    secoes: [{ titulo: grupo, linhas }],
  };
}

function telaQuantidade(nome: string): Saida {
  return {
    tipo: "botoes",
    texto: `*${nome}*\nQuantas unidades? Toque ou escreva o número.`,
    botoes: [{ id: "q:1", titulo: "1" }, { id: "q:2", titulo: "2" }, { id: "q:3", titulo: "3" }],
  };
}

function linhasCarrinho(calc: any): string {
  return (calc.itens || [])
    .map((i: any) => `• ${i.quantidade}x ${i.nome} — ${brl(i.valor_total)}${i.detalhe ? `\n   _${i.detalhe}_` : ""}`)
    .join("\n");
}

async function telaCarrinho(sb: SupabaseClient, estab: string, ctx: ContextoPedido, aviso = ""): Promise<Saida[]> {
  const calc = await calcular(sb, estab, ctx);
  const erros: string[] = (calc.erros || []).filter((e: string) => !e.startsWith("Falta"));
  const texto = `${aviso ? aviso + "\n\n" : ""}🛒 *Seu pedido até agora:*\n${linhasCarrinho(calc)}\n\n*Subtotal: ${brl(calc.subtotal)}*` +
    (erros.length ? `\n\n⚠️ ${erros.join("\n⚠️ ")}` : "");
  return [{
    tipo: "botoes",
    texto,
    botoes: [{ id: "car:add", titulo: "Adicionar mais" }, { id: "car:fim", titulo: "Finalizar pedido" }, { id: "car:rem", titulo: "Remover item" }],
  }];
}

function adicionar(ctx: ContextoPedido, item: { id: string; nome: string }, quantidade: number, detalhe?: string) {
  const igual = ctx.carrinho.find((c) => c.cardapio_id === item.id && (c.detalhe || "") === (detalhe || ""));
  if (igual) igual.quantidade = Math.min(50, igual.quantidade + quantidade);
  else ctx.carrinho.push({ cardapio_id: item.id, nome: item.nome, quantidade, detalhe });
}

// Depois de escolher o item: pergunta o detalhe (se a categoria pedir) e a quantidade.
function pedirDetalheOuQuantidade(ctx: ContextoPedido, item: ItemCatalogo, quantidade?: number): Saida[] {
  ctx.pendente = { cardapio_id: item.id, nome: item.nome, pergunta: item.pergunta, quantidade };
  if (item.pergunta) {
    ctx.etapa = "detalhe";
    return [{ tipo: "texto", texto: `*${item.nome}* — ${brl(item.preco)}\n${item.pergunta}` }];
  }
  ctx.etapa = "quantidade";
  return [telaQuantidade(item.nome)];
}

// Depois de colocar um item no carrinho: se sobrou algo da mensagem original, continua por ali.
async function aposAdicionar(sb: SupabaseClient, estab: string, ctx: ContextoPedido, itens: ItemCatalogo[], aviso: string): Promise<Saida[]> {
  if (ctx.textoPendente) {
    const resto = ctx.textoPendente;
    ctx.textoPendente = undefined;
    const r = await tentarTextoLivre(sb, estab, ctx, resto, itens, aviso);
    if (r) return r;
  }
  ctx.etapa = "carrinho";
  return telaCarrinho(sb, estab, ctx, aviso);
}

// Texto livre: tenta reconhecer itens. Retorna null se não reconheceu nada.
// Resolve uma pendência por vez (detalhe ou dúvida); o resto fica em ctx.textoPendente.
async function tentarTextoLivre(sb: SupabaseClient, estab: string, ctx: ContextoPedido, texto: string, itens: ItemCatalogo[], avisoAnterior = ""): Promise<Saida[] | null> {
  const r = interpretar(texto, itens);
  if (!r.certos.length && !r.duvidas.length) return null;

  const semDetalhe = r.certos.filter((c) => !c.item.pergunta);
  for (const c of semDetalhe) adicionar(ctx, c.item, c.quantidade);
  const avisos: string[] = avisoAnterior ? [avisoAnterior] : [];
  if (semDetalhe.length) avisos.push("Anotei: " + semDetalhe.map((c) => `${c.quantidade}x ${c.item.nome}`).join(", ") + ".");
  if (r.naoEntendidos.length) avisos.push(`Não encontrei no cardápio de agora: _${r.naoEntendidos.join(", ")}_.`);

  const comDetalhe = r.certos.filter((c) => c.item.pergunta);
  const pendentes = [...comDetalhe.slice(1).map((c) => c.trecho), ...r.duvidas.map((d) => d.trecho)];

  // item que precisa de detalhe (ex.: almoço): pergunta antes de seguir
  if (comDetalhe.length) {
    ctx.textoPendente = pendentes.join(", ") || undefined;
    const s = pedirDetalheOuQuantidade(ctx, comDetalhe[0].item, comDetalhe[0].quantidade);
    return avisos.length ? [{ tipo: "texto", texto: avisos.join("\n") }, ...s] : s;
  }

  if (r.duvidas.length) {
    const d = r.duvidas[0];
    ctx.textoPendente = r.duvidas.slice(1).map((x) => x.trecho).join(", ") || undefined;
    ctx.duvida = { quantidade: d.quantidade, opcoes: d.opcoes.slice(0, 10).map((o) => ({ id: o.id, nome: o.nome })) };
    ctx.etapa = "duvida";
    const extra = d.opcoes.length > 10 ? "\n(Mostrando 10. Se não estiver aqui, escreva o nome mais completo.)" : "";
    return [
      ...(avisos.length ? [{ tipo: "texto", texto: avisos.join("\n") } as Saida] : []),
      {
        tipo: "lista",
        texto: `Sobre "_${d.trecho}_": qual destes?${extra}`,
        botao: "Escolher",
        secoes: [{ titulo: "Opções", linhas: d.opcoes.slice(0, 10).map((o) => ({ id: "i:" + o.id, titulo: o.nome, descricao: brl(o.preco) })) }],
      },
    ];
  }

  ctx.etapa = "carrinho";
  return telaCarrinho(sb, estab, ctx, avisos.join("\n"));
}

// ---------- etapas finais ----------

async function perguntarModalidade(sb: SupabaseClient, estab: string, ctx: ContextoPedido): Promise<Saida[]> {
  const cfg = await config(sb, estab);
  const entrega = cfg?.entrega_ativa && cfg?.taxa_entrega != null;
  const retirada = cfg?.retirada_ativa;
  if (retirada && !entrega) {
    ctx.modalidade = "retirada";
    return perguntarNome(ctx, "No momento, os pedidos pelo WhatsApp são para *retirar no balcão*.");
  }
  if (entrega && !retirada) {
    ctx.modalidade = "entrega";
    ctx.etapa = "endereco";
    return [{ tipo: "texto", texto: `Os pedidos de agora são para *entrega* (taxa ${brl(cfg.taxa_entrega)}).\nQual o endereço completo? Rua, número, bairro e um ponto de referência.` }];
  }
  ctx.etapa = "modalidade";
  return [{
    tipo: "botoes",
    texto: "Vai ser para entrega ou para retirar no balcão?",
    botoes: [{ id: "mod:retirada", titulo: "Retirar no balcão" }, { id: "mod:entrega", titulo: `Entrega (${brl(cfg.taxa_entrega)})` }],
  }];
}

function perguntarNome(ctx: ContextoPedido, prefixo = ""): Saida[] {
  ctx.etapa = "nome";
  return [{ tipo: "texto", texto: `${prefixo ? prefixo + "\n\n" : ""}Em nome de quem fica o pedido?` }];
}

function perguntarPagamento(ctx: ContextoPedido): Saida[] {
  ctx.etapa = "pagamento";
  return [{
    tipo: "botoes",
    texto: "Como prefere pagar?",
    botoes: [{ id: "pag:pix", titulo: "Pix" }, { id: "pag:cartao", titulo: "Cartão" }, { id: "pag:dinheiro", titulo: "Dinheiro" }],
  }];
}

function perguntarObservacao(ctx: ContextoPedido): Saida[] {
  ctx.etapa = "observacao";
  return [{ tipo: "botoes", texto: "Alguma observação para a cozinha? Escreva aqui ou toque abaixo.", botoes: [{ id: "obs:nao", titulo: "Sem observação" }] }];
}

async function telaResumo(sb: SupabaseClient, estab: string, ctx: ContextoPedido): Promise<Saida[]> {
  const calc = await calcular(sb, estab, ctx);
  if (!calc.ok) {
    ctx.etapa = "carrinho";
    return telaCarrinho(sb, estab, ctx, "Não consegui fechar o pedido assim:");
  }
  ctx.etapa = "confirmar";
  const pag = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" }[ctx.pagamento!];
  const linhas = [
    "📝 *Confira seu pedido*",
    "",
    linhasCarrinho(calc),
    "",
    `Subtotal: ${brl(calc.subtotal)}`,
    ...(Number(calc.taxa_entrega) > 0 ? [`Taxa de entrega: ${brl(calc.taxa_entrega)}`] : []),
    `*Total: ${brl(calc.total)}*`,
    "",
    ctx.modalidade === "entrega" ? `🛵 Entrega em: ${ctx.endereco}` : "🏪 Retirada no balcão",
    `👤 ${ctx.nome}`,
    `💳 ${pag}${ctx.troco_para ? ` (troco para ${brl(ctx.troco_para)})` : ""}`,
    ...(ctx.observacao ? [`💬 ${ctx.observacao}`] : []),
    "",
    "O pedido só vai para a cozinha depois que você confirmar.",
  ];
  return [{
    tipo: "botoes",
    texto: linhas.join("\n"),
    botoes: [{ id: "conf:sim", titulo: "Confirmar pedido" }, { id: "conf:alterar", titulo: "Alterar" }, { id: "conf:cancelar", titulo: "Cancelar" }],
  }];
}

async function confirmar(sb: SupabaseClient, estab: string, ctx: ContextoPedido, e: Entrada): Promise<Resultado> {
  const { data, error } = await sb.rpc("criar_pedido", {
    p_estab: estab,
    p_chave: "wa:" + e.wamid,
    p_conversa: e.conversaId,
    p_dados: dadosDoPedido(ctx, e.telefone),
  });
  if (error) throw new Error("criar_pedido: " + error.message);
  if (!data?.ok) {
    ctx.etapa = "carrinho";
    return { saidas: await telaCarrinho(sb, estab, ctx, "⚠️ " + (data?.erros || []).join("\n⚠️ ")), contexto: ctx };
  }
  const cfg = await config(sb, estab);
  const numero = String(data.numero).padStart(3, "0");
  const linhas = [
    `✅ *Pedido #${numero} confirmado!*`,
    `Total: *${brl(data.total)}*`,
    ctx.modalidade === "entrega"
      ? `🛵 ${cfg?.tempo_entrega ? "Previsão de entrega: " + cfg.tempo_entrega : "Avisamos aqui quando sair para entrega."}`
      : `🏪 ${cfg?.tempo_retirada ? "Fica pronto em " + cfg.tempo_retirada + "." : "Avisamos aqui quando estiver pronto."}`,
  ];
  if (ctx.pagamento === "pix") {
    linhas.push(cfg?.chave_pix
      ? `\n🔑 Chave Pix: *${cfg.chave_pix}*\nDepois de pagar, envie o comprovante aqui. A equipe confere o pagamento antes de liberar.`
      : "\n🔑 A equipe vai te enviar a chave Pix por aqui. O pagamento é conferido antes de liberar o pedido.");
  }
  linhas.push("\nObrigado! Te avisamos por aqui quando estiver pronto.");
  return { saidas: [{ tipo: "texto", texto: linhas.join("\n") }], contexto: {} };
}

// ---------- entrada principal ----------

export async function iniciarPedido(sb: SupabaseClient, estab: string, e: Entrada, textoHorario: () => Promise<string>): Promise<Resultado> {
  const cfg = await config(sb, estab);
  const itens = cfg?.aceitando_pedidos ? await catalogo(sb, estab) : [];
  if (!cfg?.aceitando_pedidos || !itens.length) {
    return { saidas: [{ tipo: "texto", texto: `No momento não estamos recebendo pedidos pelo WhatsApp.\n\n${await textoHorario()}` }], contexto: {} };
  }
  const ctx = novo();
  // a própria mensagem já pode trazer itens ("quero 2 espetinhos de picanha")
  const livre = await tentarTextoLivre(sb, estab, ctx, e.texto, itens);
  if (livre) return { saidas: livre, contexto: ctx };
  // o cliente citou algo que não está no cardápio deste horário (ex.: espetinho no almoço)
  const citouItem = interpretar(e.texto, itens).naoEntendidos.length > 0;
  const aviso: Saida[] = citouItem ? [{ tipo: "texto", texto: "Esse item não está disponível neste horário. Veja o que temos agora:" }] : [];
  return { saidas: [...aviso, telaGrupos(itens)], contexto: ctx };
}

export async function continuarPedido(sb: SupabaseClient, estab: string, ctx: ContextoPedido, e: Entrada, textoHorario: () => Promise<string>): Promise<Resultado> {
  const id = e.respostaId;
  const t = normalizar(e.texto);
  const pronto = (saidas: Saida[]) => ({ saidas, contexto: ctx });

  if (PALAVRAS_CANCELAR.includes(t) || id === "conf:cancelar") {
    return { saidas: [{ tipo: "texto", texto: "Pedido cancelado. Quando quiser, é só chamar! 😊" }], contexto: {} };
  }

  const itens = await catalogo(sb, estab);
  if (!itens.length) {
    return { saidas: [{ tipo: "texto", texto: `O horário de pedidos encerrou. Seu carrinho não foi enviado.\n\n${await textoHorario()}` }], contexto: {} };
  }
  const porId = (cid: string) => itens.find((i) => i.id === cid);

  // atalhos que valem em qualquer etapa
  if (t === "cardapio" || t === "menu" || t === "voltar" || id === "car:add") {
    ctx.etapa = "grupos";
    return pronto([telaGrupos(itens)]);
  }
  if (id.startsWith("g:")) {
    ctx.grupo = id.slice(2);
    ctx.pagina = 0;
    ctx.etapa = "itens";
    return pronto([telaItens(itens, ctx.grupo, 0)]);
  }
  if (id.startsWith("mais:") && ctx.grupo) {
    ctx.pagina = Number(id.slice(5)) || 0;
    return pronto([telaItens(itens, ctx.grupo, ctx.pagina)]);
  }
  if (id.startsWith("i:")) {
    const item = porId(id.slice(2));
    if (!item) return pronto([{ tipo: "texto", texto: "Esse item não está disponível agora." }, telaGrupos(itens)]);
    const qtdDuvida = ctx.etapa === "duvida" ? ctx.duvida?.quantidade : undefined;
    ctx.duvida = undefined;
    if (qtdDuvida && !item.pergunta) {
      // o cliente já tinha dito a quantidade na mensagem ("duas coca"): não pergunta de novo
      adicionar(ctx, item, qtdDuvida);
      return pronto(await aposAdicionar(sb, estab, ctx, itens, `👍 ${qtdDuvida}x ${item.nome} adicionado.`));
    }
    return pronto(pedirDetalheOuQuantidade(ctx, item, qtdDuvida));
  }

  switch (ctx.etapa) {
    case "detalhe": {
      if (!ctx.pendente || e.texto.trim().length < 2) return pronto([{ tipo: "texto", texto: ctx.pendente?.pergunta || "Pode detalhar, por favor?" }]);
      ctx.pendente.detalhe = e.texto.trim().slice(0, 200);
      if (ctx.pendente.quantidade) {
        const q = ctx.pendente.quantidade;
        const nome = ctx.pendente.nome;
        adicionar(ctx, { id: ctx.pendente.cardapio_id, nome }, q, ctx.pendente.detalhe);
        ctx.pendente = undefined;
        return pronto(await aposAdicionar(sb, estab, ctx, itens, `👍 ${q}x ${nome} anotado.`));
      }
      ctx.etapa = "quantidade";
      return pronto([telaQuantidade(ctx.pendente.nome)]);
    }

    case "quantidade": {
      const q = id.startsWith("q:") ? Number(id.slice(2)) : lerQuantidade(e.texto);
      if (!q || q < 1 || q > 50 || !ctx.pendente) return pronto([{ tipo: "texto", texto: "Me diga a quantidade em número, de 1 a 50." }]);
      adicionar(ctx, { id: ctx.pendente.cardapio_id, nome: ctx.pendente.nome }, q, ctx.pendente.detalhe);
      const nome = ctx.pendente.nome;
      ctx.pendente = undefined;
      return pronto(await aposAdicionar(sb, estab, ctx, itens, `👍 ${q}x ${nome} adicionado.`));
    }

    case "carrinho": {
      if (id === "car:fim" || t === "finalizar" || t === "fechar") {
        if (!ctx.carrinho.length) {
          ctx.etapa = "grupos";
          return pronto([{ tipo: "texto", texto: "Seu carrinho está vazio." }, telaGrupos(itens)]);
        }
        return pronto(await perguntarModalidade(sb, estab, ctx));
      }
      if (id === "car:rem") {
        ctx.etapa = "remover";
        return pronto([{
          tipo: "lista",
          texto: "Qual item você quer tirar?",
          botao: "Remover",
          secoes: [{ titulo: "Seu pedido", linhas: ctx.carrinho.slice(0, 10).map((c, n) => ({ id: "rem:" + n, titulo: c.nome, descricao: `${c.quantidade}x${c.detalhe ? " · " + c.detalhe : ""}` })) }],
        }]);
      }
      const livre = await tentarTextoLivre(sb, estab, ctx, e.texto, itens);
      if (livre) return pronto(livre);
      return pronto(await telaCarrinho(sb, estab, ctx, "Não entendi. Use os botões ou escreva o item que quer adicionar."));
    }

    case "remover": {
      if (id.startsWith("rem:")) {
        const n = Number(id.slice(4));
        const [tirado] = ctx.carrinho.splice(n, 1);
        if (!ctx.carrinho.length) {
          ctx.etapa = "grupos";
          return pronto([{ tipo: "texto", texto: `Removi ${tirado?.nome}. Seu carrinho ficou vazio.` }, telaGrupos(itens)]);
        }
        ctx.etapa = "carrinho";
        return pronto(await telaCarrinho(sb, estab, ctx, `🗑️ Removi ${tirado?.nome}.`));
      }
      ctx.etapa = "carrinho";
      return pronto(await telaCarrinho(sb, estab, ctx));
    }

    case "modalidade": {
      if (id === "mod:retirada" || t.includes("retir") || t.includes("balcao")) {
        ctx.modalidade = "retirada";
        ctx.endereco = undefined;
        return pronto(perguntarNome(ctx));
      }
      if (id === "mod:entrega" || t.includes("entreg")) {
        ctx.modalidade = "entrega";
        ctx.etapa = "endereco";
        return pronto([{ tipo: "texto", texto: "Qual o endereço completo? Rua, número, bairro e um ponto de referência." }]);
      }
      return pronto(await perguntarModalidade(sb, estab, ctx));
    }

    case "endereco": {
      if (e.texto.trim().length < 8) return pronto([{ tipo: "texto", texto: "Preciso do endereço completo: rua, número, bairro e um ponto de referência." }]);
      ctx.endereco = e.texto.trim().slice(0, 250);
      return pronto(perguntarNome(ctx));
    }

    case "nome": {
      const nome = e.texto.trim();
      if (nome.length < 2 || nome.length > 60) return pronto([{ tipo: "texto", texto: "Qual nome devo colocar no pedido?" }]);
      ctx.nome = nome;
      return pronto(perguntarPagamento(ctx));
    }

    case "pagamento": {
      const escolha = id.startsWith("pag:") ? id.slice(4) : t.includes("pix") ? "pix" : t.includes("cart") ? "cartao" : t.includes("dinheiro") ? "dinheiro" : "";
      if (!["pix", "cartao", "dinheiro"].includes(escolha)) return pronto(perguntarPagamento(ctx));
      ctx.pagamento = escolha as ContextoPedido["pagamento"];
      ctx.troco_para = null;
      if (escolha === "dinheiro") {
        ctx.etapa = "troco";
        const calc = await calcular(sb, estab, ctx);
        return pronto([{ tipo: "botoes", texto: `Total: *${brl(calc.total)}*\nVai precisar de troco? Escreva para quanto (ex.: 100).`, botoes: [{ id: "troco:nao", titulo: "Não preciso" }] }]);
      }
      return pronto(perguntarObservacao(ctx));
    }

    case "troco": {
      if (id === "troco:nao" || t === "nao" || t === "n" || t.includes("sem troco")) {
        ctx.troco_para = null;
        return pronto(perguntarObservacao(ctx));
      }
      const v = lerValor(e.texto);
      const calc = await calcular(sb, estab, ctx);
      if (!v || v < Number(calc.total)) {
        return pronto([{ tipo: "botoes", texto: `O valor precisa ser maior que o total (${brl(calc.total)}). Para quanto é o troco?`, botoes: [{ id: "troco:nao", titulo: "Não preciso" }] }]);
      }
      ctx.troco_para = v;
      return pronto(perguntarObservacao(ctx));
    }

    case "observacao": {
      ctx.observacao = id === "obs:nao" || ["nao", "n", "nada", "nenhuma", "sem"].includes(t) ? null : e.texto.trim().slice(0, 300);
      return pronto(await telaResumo(sb, estab, ctx));
    }

    case "confirmar": {
      if (id === "conf:sim" || t === "confirmar" || t === "sim" || t === "confirmo") return confirmar(sb, estab, ctx, e);
      if (id === "conf:alterar" || t.includes("alterar")) {
        ctx.etapa = "carrinho";
        return pronto(await telaCarrinho(sb, estab, ctx));
      }
      return pronto(await telaResumo(sb, estab, ctx));
    }

    default: {
      // "grupos", "itens", "duvida": tenta entender texto livre; senão mostra o cardápio
      const livre = await tentarTextoLivre(sb, estab, ctx, e.texto, itens);
      if (livre) return pronto(livre);
      ctx.etapa = "grupos";
      return pronto([{ tipo: "texto", texto: "Não encontrei esse item no cardápio de agora." }, telaGrupos(itens)]);
    }
  }
}
