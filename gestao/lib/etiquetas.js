import { h } from "https://esm.sh/preact@10.19.6";
import { useEffect, useRef } from "https://esm.sh/preact@10.19.6/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import JsBarcode from "https://esm.sh/jsbarcode@3.11.6";
import { sb, getEstabelecimentoId, formatarMoeda, formatarData, formatarDataHora, horasAte } from "./supabase.js";

const html = htm.bind(h);

// Tamanhos comuns de etiqueta térmica. A Elgin L42 imprime até ~104mm de
// largura — confirme o tamanho do rolo comprado e ajuste aqui se preciso.
export const TAMANHOS = [
  { chave: "100x50", rotulo: "100 x 50 mm (balcão / balança)", largura: 100, altura: 50 },
  { chave: "80x50", rotulo: "80 x 50 mm", largura: 80, altura: 50 },
  { chave: "60x40", rotulo: "60 x 40 mm", largura: 60, altura: 40 },
  { chave: "50x30", rotulo: "50 x 30 mm (pequena)", largura: 50, altura: 30 },
];

export function somarHoras(datetimeLocal, horas) {
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + Number(horas || 0) * 3600000);
}

export function statusVencimento(dataValidadeISO) {
  const horas = horasAte(dataValidadeISO);
  if (horas == null) return { chave: "sem_validade", rotulo: "Sem validade", chip: "chip-neutro" };
  if (horas < 0) return { chave: "vencido", rotulo: "Vencido", chip: "chip-erro" };
  if (horas < 24) return { chave: "vence_hoje", rotulo: "Vence hoje", chip: "chip-alerta" };
  if (horas < 72) return { chave: "vence_breve", rotulo: "Vence em breve", chip: "chip-alerta" };
  return { chave: "ok", rotulo: "OK", chip: "chip-ok" };
}

export function CodigoBarras({ valor, largura }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (!valor || !valor.trim()) { ref.current.innerHTML = ""; return; }
    try {
      JsBarcode(ref.current, valor.trim(), { format: "CODE128", displayValue: true, fontSize: 12, height: 26, margin: 0, width: 1.4 });
    } catch (e) {
      ref.current.innerHTML = "";
    }
  }, [valor]);
  return html`<svg ref=${ref} style=${{ maxWidth: `${largura - 8}mm`, width: "100%" }}></svg>`;
}

export function ConteudoEtiqueta({ dados, tamanho }) {
  return html`
    <div class="etiqueta-conteudo" style=${{ width: `${tamanho.largura}mm`, height: `${tamanho.altura}mm` }}>
      ${dados.nomeEstabelecimento && html`<div class="etiqueta-cabecalho">${dados.nomeEstabelecimento}</div>`}
      <div class="etiqueta-nome">${dados.nome || "Nome do produto"}</div>

      ${dados.tipo === "preco" && html`
        <div class="etiqueta-preco">
          ${dados.pesado
            ? html`
                <span class="etiqueta-preco-total">${formatarMoeda(dados.precoTotal)}</span>
                <span class="etiqueta-preco-detalhe">${formatarMoeda(dados.precoPorKg)}/kg · ${dados.pesoGramas || 0} g</span>
              `
            : html`<span class="etiqueta-preco-total">${formatarMoeda(dados.precoTotal)}</span>`}
        </div>
        ${(dados.dataFabricacao || dados.dataValidade) && html`
          <div class="etiqueta-datas">
            ${dados.dataFabricacao && html`<span>Fab.: ${formatarData(dados.dataFabricacao)}</span>`}
            ${dados.dataValidade && html`<span>Val.: ${formatarData(dados.dataValidade)}</span>`}
          </div>
        `}
        ${dados.lote && html`<div class="etiqueta-lote">Lote: ${dados.lote}</div>`}
        ${dados.mostrarCodigoBarras && html`
          <div class="etiqueta-barras"><${CodigoBarras} valor=${dados.codigoBarras} largura=${tamanho.largura} /></div>
        `}
      `}

      ${dados.tipo === "manipulacao" && html`
        <div class="etiqueta-datas etiqueta-datas-manip">
          <span>Manipulado: ${formatarDataHora(dados.dataManipulacao)}</span>
          <span class="etiqueta-validade-destaque">Validade: ${formatarDataHora(dados.dataValidade)}</span>
        </div>
        <div class="etiqueta-responsavel">Responsável: ${dados.responsavelNome || "—"}</div>
        ${dados.lote && html`<div class="etiqueta-lote">Lote: ${dados.lote}</div>`}
      `}
    </div>
  `;
}

export async function registrarRastreabilidade(dados) {
  try {
    const estabelecimento_id = await getEstabelecimentoId();
    await sb.from("etiqueta_impressa").insert({
      estabelecimento_id,
      tipo: dados.tipo,
      nome: dados.nome,
      insumo_id: dados.insumo_id || null,
      produto_id: dados.produto_id || null,
      preco_total: dados.preco_total ?? null,
      preco_por_kg: dados.preco_por_kg ?? null,
      peso_gramas: dados.peso_gramas ?? null,
      data_manipulacao: dados.data_manipulacao || null,
      data_validade: dados.data_validade || null,
      responsavel_funcionario_id: dados.responsavel_funcionario_id || null,
      lote: dados.lote || null,
      codigo_barras: dados.codigo_barras || null,
      quantidade_copias: dados.quantidade_copias || 1,
    });
  } catch (e) {
    // Falha ao registrar rastreabilidade não deve bloquear a impressão.
  }
}

export function estiloImpressaoEtiqueta(tamanho) {
  return `
    @page { size: ${tamanho.largura}mm ${tamanho.altura}mm; margin: 0; }
    @media print {
      body * { visibility: hidden; }
      #area-impressao-etiquetas, #area-impressao-etiquetas * { visibility: visible; }
      #area-impressao-etiquetas { position: absolute; left: 0; top: 0; }
      .etiqueta-pagina { page-break-after: always; }
      .etiqueta-pagina:last-child { page-break-after: auto; }
    }
  `;
}

export const CSS_ETIQUETA = `
  .etiqueta-preview-wrap { display: flex; justify-content: center; padding: 20px; background: var(--fundo-input); border: 1px solid var(--borda); border-radius: 10px; }
  .etiqueta-conteudo {
    background: #fff; color: #000; padding: 3mm; box-sizing: border-box; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center; gap: 1.5mm;
    font-family: Arial, Helvetica, sans-serif; border: 1px solid #ccc;
  }
  .etiqueta-cabecalho { font-size: 2.2mm; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #333; }
  .etiqueta-nome { font-size: 3.4mm; font-weight: 700; line-height: 1.15; overflow-wrap: break-word; }
  .etiqueta-preco { display: flex; align-items: baseline; gap: 2mm; flex-wrap: wrap; }
  .etiqueta-preco-total { font-size: 6mm; font-weight: 800; }
  .etiqueta-preco-detalhe { font-size: 2.6mm; color: #333; }
  .etiqueta-datas { display: flex; gap: 3mm; font-size: 2.4mm; color: #222; flex-wrap: wrap; }
  .etiqueta-datas-manip { flex-direction: column; gap: 0.8mm; font-size: 2.8mm; }
  .etiqueta-validade-destaque { font-weight: 800; font-size: 3.2mm; }
  .etiqueta-responsavel { font-size: 2.4mm; color: #222; }
  .etiqueta-lote { font-size: 2.2mm; color: #444; }
  .etiqueta-barras { display: flex; justify-content: center; margin-top: 1mm; }
  #area-impressao-etiquetas { display: none; }
  @media print {
    #area-impressao-etiquetas { display: block; }
    .etiqueta-conteudo { border: none; }
  }
`;
