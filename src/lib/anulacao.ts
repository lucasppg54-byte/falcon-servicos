// Regras (puras) para o vigilante anular o seu último registo recente.

/** Minutos durante os quais o vigilante pode anular o seu último registo. */
export const JANELA_ANULACAO_MINUTOS = 15;

export interface RegistroAnulavel {
  id: string;
  seguranca: string;
  descricao: string | null;
  created_at: string;
}

/** Marcadores de início/fim de plantão não podem ser anulados pelo vigilante. */
export function ehMarcadorPlantao(descricao: string | null | undefined): boolean {
  if (!descricao) return false;
  return descricao.includes("PLANTÃO FINALIZADO") || descricao.includes("NOVO PLANTÃO");
}

/** Milissegundos restantes para anular (0 se já expirou). */
export function tempoRestanteAnulacao(createdAt: string, agora: number = Date.now()): number {
  const criado = new Date(createdAt).getTime();
  if (Number.isNaN(criado)) return 0;
  const limite = criado + JANELA_ANULACAO_MINUTOS * 60_000;
  return Math.max(0, limite - agora);
}

/**
 * Devolve o registo que o vigilante pode anular: apenas o seu registo mais
 * recente, se estiver dentro da janela e não for um marcador de plantão.
 */
export function encontrarRegistroAnulavel<T extends RegistroAnulavel>(
  registros: T[],
  seguranca: string,
  agora: number = Date.now(),
): T | null {
  const proprios = registros
    .filter((r) => r.seguranca === seguranca)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const ultimo = proprios[0];
  if (!ultimo) return null;
  if (ehMarcadorPlantao(ultimo.descricao)) return null;
  if (tempoRestanteAnulacao(ultimo.created_at, agora) <= 0) return null;
  return ultimo;
}
