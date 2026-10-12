import { describe, expect, it } from "vitest";
import { gerarFolhaLoteHtml, gerarProximoCodigo, gerarQrVetorial, qrSvgString, slugPredio } from "@/lib/qr";

describe("slugPredio", () => {
  it("remove acentos, espaços e maiúsculas", () => {
    expect(slugPredio("Samambaia")).toBe("samambaia");
    expect(slugPredio("  MERCADÃO 44 ")).toBe("mercadao-44");
    expect(slugPredio("Edifício São João / Bloco B")).toBe("edificio-sao-joao-bloco-b");
  });

  it("devolve vazio quando não há caracteres válidos", () => {
    expect(slugPredio("  —  ")).toBe("");
  });
});

describe("gerarProximoCodigo", () => {
  it("começa em 01 quando o prédio não tem códigos", () => {
    expect(gerarProximoCodigo("Samambaia", [])).toBe("samambaia-01");
  });

  it("usa o maior número existente + 1, ignorando maiúsculas e outros prédios", () => {
    const existentes = ["samambaia-01", "SAMAMBAIA-03", "samambaia-norte-07", "PRD01-EXT-01"];
    expect(gerarProximoCodigo("Samambaia", existentes)).toBe("samambaia-04");
  });

  it("não confunde prédios com prefixo comum", () => {
    expect(gerarProximoCodigo("Samambaia Norte", ["samambaia-09", "samambaia-norte-01"])).toBe("samambaia-norte-02");
  });

  it("devolve vazio sem nome de prédio", () => {
    expect(gerarProximoCodigo("   ", ["x-01"])).toBe("");
  });
});

describe("QR vetorial", () => {
  it("gera um path SVG quadrado com margem", () => {
    const qr = gerarQrVetorial("samambaia-02", 2);
    // QR versão 1 tem 21 módulos; com margem 2 de cada lado → 25.
    expect(qr.tamanho).toBeGreaterThanOrEqual(25);
    expect(qr.path).toMatch(/^M\d+ \d+h1v1h-1z/);
  });

  it("produz SVG válido e determinístico", () => {
    const a = qrSvgString("samambaia-02");
    expect(a.startsWith("<svg")).toBe(true);
    expect(a).toBe(qrSvgString("samambaia-02"));
    expect(a).not.toBe(qrSvgString("samambaia-03"));
  });
});

describe("gerarFolhaLoteHtml", () => {
  const etiqueta = (n: number) => ({ codigo: `samambaia-${n}`, predio: "Samambaia", local: `Ponto ${n}` });

  it("divide em folhas A4 de 12 etiquetas", () => {
    const html = gerarFolhaLoteHtml(Array.from({ length: 13 }, (_, i) => etiqueta(i + 1)));
    expect(html.match(/class="folha"/g)).toHaveLength(2);
    expect(html.match(/class="etiqueta"/g)).toHaveLength(13);
    expect(html).toContain("size: A4");
  });

  it("escapa HTML nos textos das etiquetas", () => {
    const html = gerarFolhaLoteHtml([{ codigo: "x-01", predio: "<script>", local: "A & B" }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain("A &#38; B");
  });
});
