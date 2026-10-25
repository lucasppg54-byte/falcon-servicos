import { describe, expect, it } from "vitest";
import {
  classificarEscala,
  janelaEscala,
  postosSemCobertura,
  turnoAtivoAgora,
  type Escala,
} from "@/lib/operacao";
import type { MarcacaoPonto } from "@/lib/folha-ponto";

const escala = (parcial: Partial<Escala> = {}): Escala => ({
  id: "e1",
  data: "2026-10-25",
  turno: "DIURNO",
  hora_entrada: "07:00",
  hora_saida: "19:00",
  predio: "Dream Park",
  seguranca: "Lucas",
  ...parcial,
});

const marca = (tipo: "ENTRADA" | "SAIDA", iso: string): MarcacaoPonto => ({
  id: iso,
  seguranca: "Lucas",
  tipo,
  created_at: iso,
});

describe("janela de turno", () => {
  it("estende o noturno para o dia seguinte", () => {
    const { inicio, fim } = janelaEscala(escala({ turno: "NOTURNO", hora_entrada: "19:00", hora_saida: "07:00" }));
    expect(fim.getTime()).toBeGreaterThan(inicio.getTime());
    expect(fim.getDate()).not.toBe(inicio.getDate());
  });
});

describe("escala prevista vs tempo real", () => {
  const meioTurno = new Date(2026, 9, 25, 12, 0, 0);

  it("marca previsto antes do início", () => {
    const cedo = new Date(2026, 9, 25, 5, 0, 0);
    expect(classificarEscala(escala(), [], cedo).status).toBe("PREVISTO");
  });

  it("marca no posto quando há entrada aberta", () => {
    const linha = classificarEscala(escala(), [marca("ENTRADA", "2026-10-25T10:00:00.000Z")], meioTurno);
    expect(linha.status).toBe("NO_POSTO");
  });

  it("marca saída quando o par está fechado", () => {
    const linha = classificarEscala(
      escala(),
      [marca("ENTRADA", "2026-10-25T10:00:00.000Z"), marca("SAIDA", "2026-10-25T20:00:00.000Z")],
      meioTurno,
    );
    expect(linha.status).toBe("SAIU");
  });

  it("marca falta se o turno já começou e não há ponto", () => {
    expect(classificarEscala(escala(), [], meioTurno).status).toBe("FALTA");
  });

  it("lista postos sem ninguém no posto", () => {
    const falta = { ...classificarEscala(escala(), [], meioTurno) };
    expect(postosSemCobertura([falta], meioTurno)).toEqual(["Dream Park"]);
    const noPosto = { ...classificarEscala(escala(), [marca("ENTRADA", "2026-10-25T10:00:00.000Z")], meioTurno) };
    expect(postosSemCobertura([noPosto], meioTurno)).toEqual([]);
  });
});

describe("turno ativo", () => {
  it("distingue diurno e noturno", () => {
    expect(turnoAtivoAgora(new Date(2026, 9, 25, 10, 0, 0))).toBe("DIURNO");
    expect(turnoAtivoAgora(new Date(2026, 9, 25, 22, 0, 0))).toBe("NOTURNO");
  });
});
