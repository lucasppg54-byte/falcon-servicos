import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { BUCKET_FOTOS, caminhoDaFotoNoBucket, normalizarCodigoQr } = await import("./rondas");
const { montarConteudoQr } = await import("./locais-qr");

describe("QR gerado pelo admin é lido pelo leitor", () => {
  it.each(["samambaia-01", "Agua-Nativa-02", "om-10"])("%s", (hash) => {
    expect(normalizarCodigoQr(montarConteudoQr(hash, "https://falcon-servicos.vercel.app"))).toBe(
      hash.toLowerCase(),
    );
  });

  it("continua a aceitar o hash simples (código manual)", () => {
    expect(normalizarCodigoQr("  SAMAMBAIA-01 ")).toBe("samambaia-01");
  });
});

describe("storage de fotos", () => {
  it("usa o bucket 'rondas'", () => {
    expect(BUCKET_FOTOS).toBe("rondas");
  });

  it("extrai o caminho do objeto a partir do URL público", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/rondas/anomalias/123-abc.jpg";
    expect(caminhoDaFotoNoBucket(url)).toBe("anomalias/123-abc.jpg");
  });

  it("ignora URLs de outros buckets", () => {
    expect(
      caminhoDaFotoNoBucket("https://x.supabase.co/storage/v1/object/public/rondas-fotos/a.jpg"),
    ).toBeNull();
  });
});
