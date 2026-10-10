// Utilitários puros (sem Supabase) para gestão de locais e conteúdo dos QR codes.

/** URL pública usada nos QR impressos. Pode ser sobrescrita por VITE_PUBLIC_APP_URL. */
export const URL_PUBLICA_PADRAO = "https://falcon-servicos.vercel.app";

export function obterUrlPublica(): string {
  const env = import.meta.env["VITE_PUBLIC_APP_URL"] as string | undefined;
  return (env?.trim() || URL_PUBLICA_PADRAO).replace(/\/+$/, "");
}

/** "Água Nativa — Portaria" -> "agua-nativa-portaria" */
export function slugificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * Gera um hash legível e único para um novo local, no formato "<predio>-NN"
 * (ex.: "samambaia-03"), usando o próximo número livre para o prédio.
 */
export function gerarHashLocal(predio: string, hashesExistentes: string[]): string {
  const base = slugificar(predio) || "local";
  const existentes = new Set(hashesExistentes.map((h) => h.trim().toLowerCase()));
  const padrao = new RegExp(`^${base}-(\\d+)$`);

  let maior = 0;
  for (const h of existentes) {
    const m = padrao.exec(h);
    if (m?.[1]) maior = Math.max(maior, Number(m[1]));
  }

  let n = maior + 1;
  let candidato = `${base}-${String(n).padStart(2, "0")}`;
  while (existentes.has(candidato)) {
    n += 1;
    candidato = `${base}-${String(n).padStart(2, "0")}`;
  }
  return candidato;
}

/** Conteúdo gravado no QR: URL da app com ?qr=<hash> (lida por normalizarCodigoQr). */
export function montarConteudoQr(hash: string, baseUrl: string = obterUrlPublica()): string {
  return `${baseUrl.replace(/\/+$/, "")}/?qr=${encodeURIComponent(hash.trim().toLowerCase())}`;
}
