import { nomeFicheiroGaleria } from "@/lib/fotos";

// Um site não consegue escrever diretamente na galeria do telemóvel. As duas vias possíveis:
//  - Android/desktop: descarregar o ficheiro (fica em "Transferências", visível no Google Fotos/Galeria).
//  - iOS: folha de partilha nativa, onde o utilizador toca em "Guardar imagem" (vai para Fotos).

export function ehIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function renomear(files: File[]): File[] {
  const agora = new Date();
  return files.map((f, i) => new File([f], nomeFicheiroGaleria(f, agora, i), { type: f.type || "image/jpeg" }));
}

function descarregar(files: File[]) {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export type ResultadoGaleria = "partilhado" | "descarregado" | "cancelado";

// Deve ser chamado a partir de um gesto do utilizador (toque), por causa da API de partilha.
export async function guardarNaGaleria(files: File[]): Promise<ResultadoGaleria> {
  if (files.length === 0) return "cancelado";
  const nomeados = renomear(files);

  if (ehIos() && typeof navigator.canShare === "function" && navigator.canShare({ files: nomeados })) {
    try {
      await navigator.share({ files: nomeados, title: "Fotos da ronda — Falcon Serviços" });
      return "partilhado";
    } catch {
      return "cancelado";
    }
  }

  descarregar(nomeados);
  return "descarregado";
}

const CHAVE_AUTO = "galeria_auto";

export function lerPreferenciaGaleria(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(CHAVE_AUTO) !== "false";
}

export function gravarPreferenciaGaleria(ativo: boolean) {
  localStorage.setItem(CHAVE_AUTO, String(ativo));
}
