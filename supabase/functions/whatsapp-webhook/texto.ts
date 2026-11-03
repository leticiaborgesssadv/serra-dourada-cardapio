// Entende pedidos escritos livremente, sem IA: "quero dois espetinhos de picanha e uma coca".
// Só sugere itens do cardápio cadastrado; quando há dúvida, devolve as opções para o cliente escolher.

export function normalizar(t: string): string {
  return (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const NUMEROS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  meia: 6, duzia: 12,
};

// palavras que não ajudam a achar o item
const IGNORAR = new Set([
  "quero", "queria", "gostaria", "pedir", "pedido", "manda", "mande", "me", "ve", "vê", "traz", "por", "favor", "pf", "pfv",
  "de", "da", "do", "das", "dos", "com", "sem", "um", "uma", "uns", "umas", "o", "a", "os", "as", "pra", "para", "mais",
  "e", "tambem", "ai", "aí", "oi", "ola", "boa", "bom", "dia", "tarde", "noite", "porcao", "porcoes", "unidade", "unidades",
]);

// reduz plural simples: espetinhos -> espetinho, latas -> lata
function raiz(p: string): string {
  if (p.length > 4 && p.endsWith("oes")) return p.slice(0, -3) + "ao";
  if (p.length > 4 && p.endsWith("s")) return p.slice(0, -1);
  return p;
}

function palavras(t: string): string[] {
  return normalizar(t).split(" ").filter((p) => p.length >= 3 && !IGNORAR.has(p) && !(p in NUMEROS) && !/^\d+$/.test(p)).map(raiz);
}

export type ItemCatalogo = { id: string; nome: string; preco: number; categoria: string; grupo: string; pergunta: string | null };

export type Interpretacao = {
  certos: { item: ItemCatalogo; quantidade: number; trecho: string }[];
  duvidas: { quantidade: number; trecho: string; opcoes: ItemCatalogo[] }[];
  naoEntendidos: string[];
};

// pontos: quão parecido; cobertas: quantas palavras do cliente aparecem no nome do item
function pontuar(trecho: string[], item: ItemCatalogo): { pontos: number; cobertas: number } {
  const doItem = palavras(item.nome);
  let pontos = 0;
  let cobertas = 0;
  if (!doItem.length) return { pontos, cobertas };
  for (const p of trecho) {
    if (doItem.some((q) => q === p)) { pontos += 2; cobertas++; }
    else if (p.length >= 4 && doItem.some((q) => q.startsWith(p) || p.startsWith(q))) { pontos += 1; cobertas++; }
  }
  return { pontos, cobertas };
}

export function interpretar(texto: string, catalogo: ItemCatalogo[]): Interpretacao {
  const r: Interpretacao = { certos: [], duvidas: [], naoEntendidos: [] };
  const trechos = normalizar(texto).split(/,| e | mais | \+ |;/).map((s) => s.trim()).filter(Boolean);

  for (const trecho of trechos) {
    // quantidade: primeiro número (dígito ou por extenso) do trecho
    let quantidade = 1;
    const m = trecho.match(/\b(\d{1,2})\b/);
    if (m) quantidade = Number(m[1]);
    else {
      const w = trecho.split(" ").find((p) => p in NUMEROS);
      if (w) quantidade = NUMEROS[w];
    }
    quantidade = Math.min(Math.max(quantidade, 1), 50);

    const chave = palavras(trecho);
    if (!chave.length) continue;

    const pontuados = catalogo.map((item) => ({ item, ...pontuar(chave, item) })).filter((x) => x.pontos > 0);
    if (!pontuados.length) {
      r.naoEntendidos.push(trecho);
      continue;
    }
    const melhor = Math.max(...pontuados.map((x) => x.pontos));
    const empatados = pontuados.filter((x) => x.pontos === melhor);

    // Só decide sozinho quando há UM item melhor e ele tem TODAS as palavras que o cliente usou.
    // Ex.: "coca lata" com a lata esgotada NÃO vira "coca 600 ml" sem perguntar.
    if (empatados.length === 1 && melhor >= 2 && empatados[0].cobertas === chave.length) {
      r.certos.push({ item: empatados[0].item, quantidade, trecho });
    } else {
      const opcoes = pontuados.sort((a, b) => b.pontos - a.pontos).map((x) => x.item);
      r.duvidas.push({ quantidade, trecho, opcoes: opcoes.slice(0, 30) });
    }
  }
  return r;
}

// Lê um número de uma resposta curta ("2", "duas", "quero 3").
export function lerQuantidade(texto: string): number | null {
  const t = normalizar(texto);
  const m = t.match(/\b(\d{1,3})\b/);
  if (m) return Number(m[1]);
  const w = t.split(" ").find((p) => p in NUMEROS);
  return w ? NUMEROS[w] : null;
}

// Lê um valor em reais ("100", "100,00", "R$ 50").
export function lerValor(texto: string): number | null {
  const m = (texto || "").replace(/\./g, "").match(/\d+(,\d{1,2})?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

export function brl(v: number): string {
  return "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
