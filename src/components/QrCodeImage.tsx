import { useEffect, useState } from "react";
import { gerarQrDataUrl } from "@/lib/qrcodes";

export function QrCodeImage({
  conteudo,
  tamanho = 160,
  className = "",
}: {
  conteudo: string;
  tamanho?: number;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    if (!conteudo) {
      setSrc(null);
      return;
    }
    // Gera ao dobro da resolução para ficar nítido em ecrãs retina.
    gerarQrDataUrl(conteudo, tamanho * 2)
      .then((url) => ativo && setSrc(url))
      .catch(() => ativo && setSrc(null));
    return () => {
      ativo = false;
    };
  }, [conteudo, tamanho]);

  return (
    <div
      className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white ${className}`}
      style={{ width: tamanho, height: tamanho }}
    >
      {src ? (
        <img src={src} alt={`QR code: ${conteudo}`} width={tamanho} height={tamanho} />
      ) : (
        <span className="text-[10px] text-zinc-400">…</span>
      )}
    </div>
  );
}
