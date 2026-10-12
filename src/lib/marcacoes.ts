// Marcações de início/fim de plantão sustentam a contagem de horas (Financeiro PJ)
// e a abertura/fecho do checklist — nunca podem ser apagadas pelo vigilante.
export function ehMarcacaoPlantao(descricao: string | null | undefined): boolean {
  if (!descricao) return false;
  return descricao.includes("NOVO PLANTÃO") || descricao.includes("PLANTÃO FINALIZADO");
}

export function podeExcluirRegistro(
  registro: { seguranca: string; descricao: string | null },
  segurancaAtual: string,
  admin: boolean,
): boolean {
  if (admin) return true;
  return registro.seguranca === segurancaAtual && !ehMarcacaoPlantao(registro.descricao);
}
