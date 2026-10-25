import { describe, expect, it } from "vitest";
import {
  arredondarHoras,
  descricaoPontoComInstante,
  fundirMarcacoes,
  montarTurnos,
  proximoTipoPonto,
  tipoPontoDaDescricao,
  type MarcacaoPonto,
} from "@/lib/folha-ponto";
import { ehAdminSeguranca, rotuloGestor } from "@/lib/perfis";
import { empresaExistente } from "@/lib/empresas";

const marca = (tipo: "ENTRADA" | "SAIDA", iso: string, id = iso): MarcacaoPonto => ({
  id,
  seguranca: "Lucas",
  tipo,
  created_at: iso,
});

describe("arredondamento de 30 minutos", () => {
  it("descarta fracções abaixo de 30 minutos", () => {
    expect(arredondarHoras(8 * 60 + 20)).toBe(8);
    expect(arredondarHoras(12 * 60 + 29)).toBe(12);
  });

  it("arredonda para cima a partir de 30 minutos", () => {
    expect(arredondarHoras(8 * 60 + 30)).toBe(9);
    expect(arredondarHoras(12 * 60 + 35)).toBe(13);
  });

  it("trata valores vazios", () => {
    expect(arredondarHoras(0)).toBe(0);
    expect(arredondarHoras(-10)).toBe(0);
  });
});

describe("pares de entrada e saída", () => {
  it("infere a próxima marcação com base no turno aberto", () => {
    expect(proximoTipoPonto([])).toBe("ENTRADA");
    expect(proximoTipoPonto([marca("ENTRADA", "2026-10-01T08:00:00Z")])).toBe("SAIDA");
    expect(
      proximoTipoPonto([
        marca("ENTRADA", "2026-10-01T08:00:00Z"),
        marca("SAIDA", "2026-10-01T20:00:00Z"),
      ]),
    ).toBe("ENTRADA");
  });

  it("conta hora extra só depois da jornada base, já arredondada", () => {
    const turnos = montarTurnos(
      [
        marca("ENTRADA", "2026-10-01T07:00:00.000Z"),
        marca("SAIDA", "2026-10-01T19:35:00.000Z"),
      ],
      12,
    );
    expect(turnos).toHaveLength(1);
    expect(turnos[0].horasArredondadas).toBe(13);
    expect(turnos[0].horasExtras).toBe(1);
  });
});

describe("perfil gestor", () => {
  it("dá ao Supervisor as mesmas permissões de gestão que o Admin", () => {
    expect(ehAdminSeguranca("Falcon (Admin)")).toBe(true);
    expect(ehAdminSeguranca("Luiene", "Supervisor")).toBe(true);
    expect(ehAdminSeguranca("Lucas", "Vigilante")).toBe(false);
    expect(rotuloGestor("Luiene", "Supervisor")).toBe("Supervisor");
    expect(rotuloGestor("Supervisor Falcon", "Supervisor")).toBe("Supervisor");
    expect(rotuloGestor("Falcon (Admin)", "Administrador")).toBe("Admin");
  });
});

describe("empresas existentes", () => {
  it("reconhece o mesmo posto com digitação diferente", () => {
    expect(empresaExistente("dream park", ["Dream Park", "Samambaia"])).toBe("Dream Park");
    expect(empresaExistente("Novo Cliente", ["Dream Park"])).toBeNull();
  });
});

describe("folha offline e selfie", () => {
  it("funde marcações remotas com a fila pendente sem duplicar", () => {
    const remoto = [marca("ENTRADA", "2026-10-01T08:00:00.000Z", "remoto-1")];
    const pendentes = [
      { ...marca("ENTRADA", "2026-10-01T08:00:00.000Z", "remoto-1"), pendente: true },
      { ...marca("SAIDA", "2026-10-01T20:05:00.000Z", "fila-1"), pendente: true },
    ];
    const fundo = fundirMarcacoes(remoto, pendentes);
    expect(fundo).toHaveLength(2);
    expect(fundo[1].id).toBe("fila-1");
    expect(fundo[1].pendente).toBe(true);
    expect(fundo[1].created_at).toBe("2026-10-01T20:05:00.000Z");
  });

  it("preserva o instante original do ponto offline na ordenação da folha", () => {
    const agora = "2026-10-17T23:41:08.123Z";
    const fundo = fundirMarcacoes(
      [marca("ENTRADA", "2026-10-17T08:00:00.000Z", "a")],
      [{ ...marca("SAIDA", agora, "off"), pendente: true }],
    );
    expect(fundo[1].created_at).toBe(agora);
    expect(new Date(fundo[1].created_at).toISOString()).toBe(agora);
  });

  it("grava o instante original na descrição para sobreviver a um insert sem created_at", () => {
    const iso = "2026-10-17T23:41:08.123Z";
    const desc = descricaoPontoComInstante("ENTRADA", "Dream Park", "Portaria", iso);
    expect(desc).toContain("PONTO ENTRADA");
    expect(desc).toContain(iso);
    expect(tipoPontoDaDescricao(desc)).toBe("ENTRADA");
  });
});

describe("marcadores de ponto", () => {
  it("lê entrada e saída de ponto e de plantão", () => {
    expect(tipoPontoDaDescricao("⏱️ PONTO ENTRADA em Dream Park — Portaria")).toBe("ENTRADA");
    expect(tipoPontoDaDescricao("⏱️ PONTO SAÍDA em Dream Park — Portaria")).toBe("SAIDA");
    expect(tipoPontoDaDescricao("🚀 NOVO PLANTÃO PJ INICIADO")).toBe("ENTRADA");
    expect(tipoPontoDaDescricao("🏁 PLANTÃO FINALIZADO")).toBe("SAIDA");
    expect(tipoPontoDaDescricao("Anomalia na portaria")).toBeNull();
  });
});
