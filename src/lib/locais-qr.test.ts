import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { gerarHashLocal, montarConteudoQr, slugificar } from "./locais-qr";

describe("slugificar", () => {
  it("remove acentos, espaços e símbolos", () => {
    expect(slugificar("Água Nativa — Portaria")).toBe("agua-nativa-portaria");
    expect(slugificar("  Santo Antônio!! ")).toBe("santo-antonio");
  });

  it("devolve vazio quando não há caracteres válidos", () => {
    expect(slugificar("—!!")).toBe("");
  });
});

describe("gerarHashLocal", () => {
  it("começa em 01 quando o prédio ainda não tem locais", () => {
    expect(gerarHashLocal("Dream Park", [])).toBe("dream-park-01");
  });

  it("usa o próximo número a seguir ao maior existente", () => {
    expect(gerarHashLocal("Samambaia", ["samambaia-01", "SAMAMBAIA-03", "boiforte-01"])).toBe(
      "samambaia-04",
    );
  });

  it("não colide com hashes de outros prédios", () => {
    const h = gerarHashLocal("OM", ["om-01", "om-02"]);
    expect(h).toBe("om-03");
  });

  it("usa 'local' como base se o prédio não gerar slug", () => {
    expect(gerarHashLocal("!!!", [])).toBe("local-01");
  });
});

describe("montarConteudoQr", () => {
  it("gera URL ?qr= em minúsculas e sem barra dupla", () => {
    expect(montarConteudoQr("Samambaia-01", "https://app.exemplo.com/")).toBe(
      "https://app.exemplo.com/?qr=samambaia-01",
    );
  });

  it("produz conteúdo codificável num QR válido", async () => {
    const svg = await QRCode.toString(montarConteudoQr("samambaia-01", "https://app.exemplo.com"), {
      type: "svg",
    });
    expect(svg).toContain("<svg");
  });
});
