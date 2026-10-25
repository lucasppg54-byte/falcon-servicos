/** PIN numérico de 4 dígitos, sem zeros à esquerda, único na lista existente. */
export function gerarPinAcesso(pinsExistentes: string[] = []): string {
  const usados = new Set(pinsExistentes.map((p) => p.trim()));
  for (let i = 0; i < 80; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    if (!usados.has(pin)) return pin;
  }
  return String((Date.now() % 9000) + 1000);
}
