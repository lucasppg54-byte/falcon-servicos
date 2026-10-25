function normalizarEmpresa(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Devolve o nome canónico da lista se o texto já existir (ignora acentos e maiúsculas). */
export function empresaExistente(nome: string, lista: string[]): string | null {
  const alvo = normalizarEmpresa(nome);
  if (!alvo) return null;
  return lista.find((item) => normalizarEmpresa(item) === alvo) ?? null;
}
