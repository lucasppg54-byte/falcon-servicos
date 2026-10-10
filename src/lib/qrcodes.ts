import QRCode from "qrcode";
import { escapeHtml } from "@/lib/html";
import { montarConteudoQr } from "@/lib/locais-qr";
import type { LocalRonda } from "@/lib/rondas";

// Correção de erro "M" tolera ~15% de dano (etiquetas riscadas/sujas em campo).
const OPCOES_BASE = { errorCorrectionLevel: "M" as const, margin: 2 };

export function gerarQrDataUrl(conteudo: string, largura = 512): Promise<string> {
  return QRCode.toDataURL(conteudo, { ...OPCOES_BASE, width: largura });
}

export function gerarQrSvg(conteudo: string): Promise<string> {
  return QRCode.toString(conteudo, { ...OPCOES_BASE, type: "svg" });
}

/** Descarrega o QR de um local como PNG em alta resolução. */
export async function baixarQrPng(local: LocalRonda): Promise<void> {
  const dataUrl = await gerarQrDataUrl(montarConteudoQr(local.qr_code_hash), 1024);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `qr-${local.qr_code_hash}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export type ColunasImpressao = 2 | 3 | 4;

/**
 * Abre uma folha A4 pronta para impressão/PDF com os QR codes (vetoriais) de
 * todos os locais indicados, agrupados por prédio e com linhas de corte.
 * A janela é aberta de forma síncrona para não ser bloqueada como pop-up.
 */
export async function abrirFolhaQrCodes(
  locais: LocalRonda[],
  colunas: ColunasImpressao = 3,
): Promise<void> {
  if (locais.length === 0) return;

  const janela = window.open("", "_blank");
  if (!janela) {
    window.alert("Permita os pop-ups no navegador para gerar a folha de QR codes.");
    return;
  }
  janela.document.write("<p style='font-family:Arial;padding:24px'>A gerar QR codes…</p>");

  const ordenados = [...locais].sort(
    (a, b) => a.predio.localeCompare(b.predio, "pt-BR") || a.local.localeCompare(b.local, "pt-BR"),
  );
  const svgs = await Promise.all(
    ordenados.map((l) => gerarQrSvg(montarConteudoQr(l.qr_code_hash))),
  );

  const cartoes = ordenados
    .map(
      (l, i) => `<div class="cartao">
        <p class="empresa">Falcon Serviços · Ponto de Ronda</p>
        <div class="qr">${svgs[i]}</div>
        <p class="predio">${escapeHtml(l.predio)}</p>
        <p class="local">${escapeHtml(l.local)}</p>
        <p class="hash">${escapeHtml(l.qr_code_hash)}</p>
      </div>`,
    )
    .join("");

  const totalPredios = new Set(ordenados.map((l) => l.predio)).size;
  const geradoEm = new Date().toLocaleString("pt-BR");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QR Codes de Ronda — Falcon Serviços</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, sans-serif; color: #111; margin: 20px; }
  .topo { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; border-bottom: 3px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  .topo h1 { font-size: 20px; margin: 0; }
  .topo p { margin: 2px 0 0; font-size: 12px; color: #555; }
  .grelha { display: grid; grid-template-columns: repeat(${colunas}, 1fr); gap: 0; }
  .cartao { border: 1px dashed #999; padding: 5mm 4mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .cartao .empresa { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: #555; margin: 0 0 4px; }
  .cartao .qr svg { width: 100%; max-width: ${colunas === 2 ? 60 : colunas === 3 ? 46 : 36}mm; height: auto; display: block; margin: 0 auto; }
  .cartao .predio { font-size: ${colunas === 4 ? 11 : 13}px; font-weight: 700; margin: 4px 0 0; }
  .cartao .local { font-size: ${colunas === 4 ? 10 : 12}px; margin: 2px 0 0; }
  .cartao .hash { font-family: monospace; font-size: 10px; color: #444; margin: 3px 0 0; }
  .acoes { margin: 0 0 16px; text-align: center; }
  .acoes button { padding: 10px 24px; font-size: 14px; font-weight: 700; background: #111; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
  @media print { body { margin: 0; } .no-print { display: none !important; } }
</style>
</head>
<body>
  <div class="topo">
    <div>
      <h1>Falcon Serviços — QR Codes dos Pontos de Ronda</h1>
      <p>${ordenados.length} QR code(s) · ${totalPredios} posto(s) · gerado em ${escapeHtml(geradoEm)}</p>
    </div>
  </div>
  <div class="acoes no-print"><button onclick="window.print()">Imprimir / Salvar PDF para a gráfica</button></div>
  <div class="grelha">${cartoes}</div>
</body>
</html>`;

  janela.document.open();
  janela.document.write(html);
  janela.document.close();
}
