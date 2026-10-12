export const BUCKET_FOTOS = "rondas";

// Várias fotos da mesma anomalia ficam guardadas em `foto_url`, uma URL por linha.
// Registos antigos (uma única URL) continuam a ser lidos sem alterações.
export function extrairFotos(fotoUrl: string | null | undefined): string[] {
  if (!fotoUrl) return [];
  return fotoUrl
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

export function serializarFotos(urls: string[]): string | null {
  const limpas = urls.map((u) => u.trim()).filter(Boolean);
  return limpas.length > 0 ? limpas.join("\n") : null;
}

function extensaoDe(file: { type: string; name: string }): string {
  const doNome = /\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1];
  if (doNome) return doNome.toLowerCase();
  const doTipo = file.type.split("/")[1];
  return doTipo ? doTipo.replace("jpeg", "jpg").toLowerCase() : "jpg";
}

export function gerarCaminhoFoto(file: { type: string; name: string }, agora = new Date(), indice = 0): string {
  const dia = agora.toISOString().slice(0, 10);
  const aleatorio = Math.random().toString(36).substring(2, 9);
  return `anomalias/${dia}/${agora.getTime()}-${indice}-${aleatorio}.${extensaoDe(file)}`;
}

// Converte a URL pública de volta ao caminho dentro do bucket (para remoção).
export function caminhoNoBucket(urlPublica: string, bucket = BUCKET_FOTOS): string | null {
  const marcador = `/storage/v1/object/public/${bucket}/`;
  const idx = urlPublica.indexOf(marcador);
  if (idx === -1) return null;
  return decodeURIComponent(urlPublica.slice(idx + marcador.length).split("?")[0] ?? "") || null;
}

export function nomeFicheiroGaleria(file: { type: string; name: string }, agora = new Date(), indice = 0): string {
  const carimbo = agora.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return `falcon_${carimbo}_${indice + 1}.${extensaoDe(file)}`;
}
