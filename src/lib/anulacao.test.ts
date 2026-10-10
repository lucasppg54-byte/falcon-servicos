import { describe, expect, it } from "vitest";
import {
  encontrarRegistroAnulavel,
  ehMarcadorPlantao,
  JANELA_ANULACAO_MINUTOS,
  tempoRestanteAnulacao,
} from "./anulacao";

const AGORA = new Date("2026-10-10T22:00:00Z").getTime();
const haMinutos = (m: number) => new Date(AGORA - m * 60_000).toISOString();

function reg(id: string, seguranca: string, minutosAtras: number, descricao: string | null = null) {
  return { id, seguranca, descricao, created_at: haMinutos(minutosAtras) };
}

describe("ehMarcadorPlantao", () => {
  it("reconhece início e fim de plantão", () => {
    expect(ehMarcadorPlantao("🏁 PLANTÃO FINALIZADO COM 0 PENDÊNCIAS")).toBe(true);
    expect(ehMarcadorPlantao("🚀 NOVO PLANTÃO PJ INICIADO")).toBe(true);
    expect(ehMarcadorPlantao("Vazamento no hall")).toBe(false);
    expect(ehMarcadorPlantao(null)).toBe(false);
  });
});

describe("tempoRestanteAnulacao", () => {
  it("é positivo dentro da janela e zero depois", () => {
    expect(tempoRestanteAnulacao(haMinutos(5), AGORA)).toBe((JANELA_ANULACAO_MINUTOS - 5) * 60_000);
    expect(tempoRestanteAnulacao(haMinutos(JANELA_ANULACAO_MINUTOS + 1), AGORA)).toBe(0);
    expect(tempoRestanteAnulacao("data-invalida", AGORA)).toBe(0);
  });
});

describe("encontrarRegistroAnulavel", () => {
  it("devolve apenas o registo mais recente do próprio vigilante", () => {
    const lista = [reg("b", "Ana", 2), reg("a", "Ana", 8), reg("c", "Bruno", 1)];
    expect(encontrarRegistroAnulavel(lista, "Ana", AGORA)?.id).toBe("b");
  });

  it("ignora a ordem da lista recebida", () => {
    const lista = [reg("antigo", "Ana", 10), reg("novo", "Ana", 1)];
    expect(encontrarRegistroAnulavel(lista, "Ana", AGORA)?.id).toBe("novo");
  });

  it("não permite anular fora da janela", () => {
    expect(
      encontrarRegistroAnulavel([reg("x", "Ana", JANELA_ANULACAO_MINUTOS + 1)], "Ana", AGORA),
    ).toBeNull();
  });

  it("não permite anular marcadores de plantão nem saltar para registos anteriores", () => {
    const lista = [
      reg("fecho", "Ana", 1, "🏁 PLANTÃO FINALIZADO COM 0 PENDÊNCIAS"),
      reg("ronda", "Ana", 3),
    ];
    expect(encontrarRegistroAnulavel(lista, "Ana", AGORA)).toBeNull();
  });

  it("devolve null quando o vigilante não tem registos", () => {
    expect(encontrarRegistroAnulavel([reg("c", "Bruno", 1)], "Ana", AGORA)).toBeNull();
  });
});
