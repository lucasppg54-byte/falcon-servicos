import { describe, expect, it } from "vitest";
import {
  caminhoNoBucket,
  ehUrlSelfiePonto,
  extrairFotos,
  fotosVisiveis,
  gerarCaminhoFoto,
  gerarCaminhoSelfiePonto,
  nomeFicheiroGaleria,
  serializarFotos,
} from "@/lib/fotos";
import { ehMarcacaoPlantao, podeExcluirRegistro } from "@/lib/marcacoes";

const BASE = "https://abc.supabase.co/storage/v1/object/public/rondas/";

describe("fotos múltiplas em foto_url", () => {
  it("lê registos antigos com uma única URL", () => {
    expect(extrairFotos(`${BASE}a.jpg`)).toEqual([`${BASE}a.jpg`]);
  });

  it("faz ida e volta com várias URLs", () => {
    const urls = [`${BASE}a.jpg`, `${BASE}b.jpg`, `${BASE}c.png`];
    expect(extrairFotos(serializarFotos(urls))).toEqual(urls);
  });

  it("trata vazios como sem fotos", () => {
    expect(extrairFotos(null)).toEqual([]);
    expect(extrairFotos("")).toEqual([]);
    expect(serializarFotos([])).toBeNull();
    expect(serializarFotos(["  "])).toBeNull();
  });
});

describe("caminhos no bucket rondas", () => {
  it("gera caminho por dia com a extensão do ficheiro", () => {
    const caminho = gerarCaminhoFoto({ name: "IMG_001.HEIC", type: "image/heic" }, new Date("2026-10-12T10:00:00Z"), 2);
    expect(caminho).toMatch(/^anomalias\/2026-10-12\/\d+-2-[a-z0-9]+\.heic$/);
  });

  it("usa o MIME type quando o nome não tem extensão", () => {
    expect(gerarCaminhoFoto({ name: "blob", type: "image/jpeg" })).toMatch(/\.jpg$/);
  });

  it("converte a URL pública de volta ao caminho", () => {
    expect(caminhoNoBucket(`${BASE}anomalias/2026-10-12/x.jpg`)).toBe("anomalias/2026-10-12/x.jpg");
    expect(caminhoNoBucket("https://outro.site/foto.jpg")).toBeNull();
  });

  it("guarda a selfie de ponto na pasta ponto/ com o dia e o vigilante", () => {
    const caminho = gerarCaminhoSelfiePonto(
      { name: "selfie.jpg", type: "image/jpeg" },
      "Lucas Silva",
      new Date("2026-10-17T12:00:00.000Z"),
    );
    expect(caminho).toMatch(/^ponto\/2026-10-17\/lucas-silva-\d+-[a-z0-9]+\.jpg$/);
  });

  it("esconde selfies de ponto de quem não é o colaborador nem gestor", () => {
    const selfie = `${BASE}ponto/2026-10-17/lucas.jpg`;
    const anomalia = `${BASE}anomalias/2026-10-17/x.jpg`;
    expect(ehUrlSelfiePonto(selfie)).toBe(true);
    expect(fotosVisiveis(`${selfie}\n${anomalia}`, false)).toEqual([anomalia]);
    expect(fotosVisiveis(`${selfie}\n${anomalia}`, true)).toEqual([selfie, anomalia]);
  });

  it("nomeia a cópia da galeria de forma legível", () => {
    const nome = nomeFicheiroGaleria({ name: "image.jpg", type: "image/jpeg" }, new Date("2026-10-12T09:05:07Z"), 0);
    expect(nome).toBe("falcon_20261012_090507_1.jpg");
  });
});

describe("exclusão de registos pelo vigilante", () => {
  const registo = (descricao: string | null, seguranca = "João") => ({ seguranca, descricao });

  it("identifica marcações de início e fim de plantão", () => {
    expect(ehMarcacaoPlantao("🚀 NOVO PLANTÃO PJ INICIADO na Base por João")).toBe(true);
    expect(ehMarcacaoPlantao("🏁 PLANTÃO FINALIZADO COM 0 PENDÊNCIAS.")).toBe(true);
    expect(ehMarcacaoPlantao("⏱️ PONTO ENTRADA em Dream Park — Portaria")).toBe(true);
    expect(ehMarcacaoPlantao("Vazamento na casa de máquinas")).toBe(false);
    expect(ehMarcacaoPlantao(null)).toBe(false);
  });

  it("permite ao vigilante apagar os seus próprios registos, sem limite de tempo", () => {
    expect(podeExcluirRegistro(registo(null), "João", false)).toBe(true);
    expect(podeExcluirRegistro(registo("⚠️ BAIXA MANUAL: sala trancada"), "João", false)).toBe(true);
  });

  it("nunca permite ao vigilante apagar marcações de plantão nem registos de outros", () => {
    expect(podeExcluirRegistro(registo("🚀 NOVO PLANTÃO / TURNO INICIADO"), "João", false)).toBe(false);
    expect(podeExcluirRegistro(registo("🏁 PLANTÃO FINALIZADO"), "João", false)).toBe(false);
    expect(podeExcluirRegistro(registo(null, "Maria"), "João", false)).toBe(false);
  });

  it("mantém o poder total do administrador", () => {
    expect(podeExcluirRegistro(registo("🏁 PLANTÃO FINALIZADO", "Maria"), "Admin", true)).toBe(true);
  });
});
