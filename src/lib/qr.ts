import QRCode from "qrcode";

/* ---------------- Geração automática de códigos QR a partir do prédio ---------------- */

export function slugPredio(predio: string): string {
  return predio
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Ex.: "Samambaia" com ["samambaia-01"] existente → "samambaia-02"
export function gerarProximoCodigo(predio: string, codigosExistentes: string[]): string {
  const base = slugPredio(predio);
  if (!base) return "";

  const padrao = new RegExp(`^${base}-(\\d+)$`);
  const maior = codigosExistentes.reduce((max, codigo) => {
    const m = padrao.exec(codigo.trim().toLowerCase());
    return m?.[1] ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);

  return `${base}-${String(maior + 1).padStart(2, "0")}`;
}

/* ---------------- QR vetorial (SVG) gerado de forma síncrona ---------------- */

export interface QrVetorial {
  tamanho: number; // módulos + margem, usado no viewBox
  path: string;
}

export function gerarQrVetorial(texto: string, margem = 2): QrVetorial {
  const { modules } = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let path = "";
  for (let linha = 0; linha < n; linha++) {
    for (let coluna = 0; coluna < n; coluna++) {
      if (modules.get(linha, coluna)) path += `M${coluna + margem} ${linha + margem}h1v1h-1z`;
    }
  }
  return { tamanho: n + margem * 2, path };
}

export function qrSvgString(texto: string, margem = 2): string {
  const { tamanho, path } = gerarQrVetorial(texto, margem);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tamanho} ${tamanho}" shape-rendering="crispEdges"><rect width="${tamanho}" height="${tamanho}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/* ---------------- Folha A4 para impressão em lote ---------------- */

export interface EtiquetaQr {
  codigo: string;
  predio: string;
  local: string;
}

const ETIQUETAS_POR_FOLHA = 12; // 3 colunas × 4 linhas

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function gerarFolhaLoteHtml(etiquetas: EtiquetaQr[]): string {
  const folhas: EtiquetaQr[][] = [];
  for (let i = 0; i < etiquetas.length; i += ETIQUETAS_POR_FOLHA) {
    folhas.push(etiquetas.slice(i, i + ETIQUETAS_POR_FOLHA));
  }

  const htmlFolhas = folhas
    .map(
      (folha) => `<section class="folha">${folha
        .map(
          (e) => `<div class="etiqueta">
  <p class="predio">${escapar(e.predio)}</p>
  <div class="qr">${qrSvgString(e.codigo)}</div>
  <p class="local">${escapar(e.local)}</p>
  <p class="codigo">${escapar(e.codigo)}</p>
</div>`,
        )
        .join("")}</section>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QR Codes em lote — Falcon Serviços</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; color: #111; background: #e5e5e5; }
  .folha { width: 190mm; height: 277mm; margin: 10mm auto; background: #fff; display: grid;
    grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(4, 1fr);
    page-break-after: always; break-after: page; }
  .folha:last-of-type { page-break-after: auto; break-after: auto; }
  .etiqueta { border: 0.3mm dashed #999; padding: 4mm; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; overflow: hidden; }
  .qr { width: 40mm; height: 40mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .predio { margin: 0 0 2mm; font-size: 10pt; font-weight: 700; text-transform: uppercase; }
  .local { margin: 2mm 0 0; font-size: 9pt; }
  .codigo { margin: 1mm 0 0; font-family: "Courier New", monospace; font-size: 9pt; font-weight: 700; }
  .barra { position: sticky; top: 0; padding: 10px; text-align: center; background: #111; color: #fff; font-size: 13px; }
  .barra button { margin-left: 10px; padding: 8px 18px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; }
  @media print { body { background: #fff; } .folha { margin: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="barra no-print">
    ${etiquetas.length} QR code${etiquetas.length === 1 ? "" : "s"} · ${folhas.length} folha${folhas.length === 1 ? "" : "s"} A4 — recorte pelas linhas tracejadas.
    <button onclick="window.print()">Imprimir / Salvar PDF</button>
  </div>
  ${htmlFolhas}
</body>
</html>`;
}

/* ---------------- Exportação PNG (com legenda) ---------------- */

export function gerarQrPngDataUrl(etiqueta: EtiquetaQr, larguraPx = 1024): string {
  const { modules } = QRCode.create(etiqueta.codigo, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const margemModulos = 4;
  const escala = Math.floor(larguraPx / (n + margemModulos * 2));
  const ladoQr = escala * (n + margemModulos * 2);
  const alturaLegenda = Math.round(ladoQr * 0.22);

  const canvas = document.createElement("canvas");
  canvas.width = ladoQr;
  canvas.height = ladoQr + alturaLegenda;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível neste navegador.");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  for (let linha = 0; linha < n; linha++) {
    for (let coluna = 0; coluna < n; coluna++) {
      if (modules.get(linha, coluna)) {
        ctx.fillRect((coluna + margemModulos) * escala, (linha + margemModulos) * escala, escala, escala);
      }
    }
  }

  ctx.textAlign = "center";
  const centro = canvas.width / 2;
  const base = ladoQr - escala * 2;
  ctx.font = `bold ${Math.round(alturaLegenda * 0.26)}px Arial`;
  ctx.fillText(`${etiqueta.predio} — ${etiqueta.local}`, centro, base + alturaLegenda * 0.35, canvas.width * 0.92);
  ctx.font = `bold ${Math.round(alturaLegenda * 0.24)}px "Courier New", monospace`;
  ctx.fillText(etiqueta.codigo, centro, base + alturaLegenda * 0.72, canvas.width * 0.92);

  return canvas.toDataURL("image/png");
}

export function baixarQrPng(etiqueta: EtiquetaQr) {
  const a = document.createElement("a");
  a.href = gerarQrPngDataUrl(etiqueta);
  a.download = `qr_${etiqueta.codigo}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function imprimirQrEmLote(etiquetas: EtiquetaQr[]) {
  if (etiquetas.length === 0) return;
  const blob = new Blob([gerarFolhaLoteHtml(etiquetas)], { type: "text/html;charset=utf-8" });
  const janela = window.open(URL.createObjectURL(blob), "_blank");
  if (!janela) window.alert("Permita os pop-ups no navegador para gerar a folha de impressão.");
}
