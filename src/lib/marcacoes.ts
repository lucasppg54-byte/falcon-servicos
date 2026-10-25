import { ehMarcacaoPonto } from "@/lib/folha-ponto";

// Marcações de início/fim de plantão e de ponto sustentam a contagem de horas
// — nunca podem ser apagadas pelo vigilante.
export function ehMarcacaoPlantao(descricao: string | null | undefined): boolean {
  if (!descricao) return false;
  return descricao.includes("NOVO PLANTÃO") || descricao.includes("PLANTÃO FINALIZADO") || ehMarcacaoPonto(descricao);
}

export function podeExcluirRegistro(
  registro: { seguranca: string; descricao: string | null },
  segurancaAtual: string,
  admin: boolean,
): boolean {
  if (admin) return true;
  return registro.seguranca === segurancaAtual && !ehMarcacaoPlantao(registro.descricao);
}
