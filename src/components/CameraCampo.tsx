import { useEffect, useRef, useState } from "react";
import { Flashlight, FlashlightOff } from "lucide-react";
import type { TipoPonto } from "@/lib/folha-ponto";

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

type CapacidadesComTorch = MediaTrackCapabilities & { torch?: boolean };
export type ModoCampo = "ponto" | "ronda";

function suportaLanterna(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== "function") return false;
  return !!(track.getCapabilities() as CapacidadesComTorch).torch;
}

export function CameraCampo({
  modo,
  onModo,
  tipoPonto,
  disabled,
  onQr,
  portariaOk,
  selfiePronta,
  onSelfie,
}: {
  modo: ModoCampo;
  onModo: (modo: ModoCampo) => void;
  tipoPonto: TipoPonto;
  disabled: boolean;
  onQr: (codigo: string) => void;
  portariaOk: boolean;
  selfiePronta: boolean;
  onSelfie: (file: File | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onQrRef = useRef(onQr);
  const ultimoLido = useRef<{ valor: string; em: number }>({ valor: "", em: 0 });
  onQrRef.current = onQr;

  const [ligada, setLigada] = useState(false);
  const [erro, setErro] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [lanternaDisponivel, setLanternaDisponivel] = useState(false);
  const [lanternaLigada, setLanternaLigada] = useState(false);

  const lendoQr = modo === "ronda" || !portariaOk;
  const aSelfie = modo === "ponto" && portariaOk && !selfiePronta;

  useEffect(() => {
    if (selfiePronta) return;
    setPreview((atual) => {
      if (atual) URL.revokeObjectURL(atual);
      return null;
    });
  }, [selfiePronta]);

  useEffect(() => {
    if (disabled && ligada) setLigada(false);
  }, [disabled, ligada]);

  useEffect(() => {
    if (!ligada || (modo === "ponto" && portariaOk && selfiePronta)) return;
    let cancelado = false;
    let intervalo: ReturnType<typeof setInterval> | undefined;
    const frontal = modo === "ponto" && portariaOk;

    async function iniciar() {
      if (!frontal && (!("BarcodeDetector" in window) || !window.BarcodeDetector)) {
        setErro("Este navegador não tem leitor de QR nativo. Na ronda, use o código manual.");
        setLigada(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: frontal
            ? { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }
            : { facingMode: "environment" },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const track = stream.getVideoTracks()[0];
        setLanternaDisponivel(!frontal && suportaLanterna(track));
        if (frontal || !window.BarcodeDetector) return;
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        intervalo = setInterval(async () => {
          if (!videoRef.current) return;
          try {
            const codigos = await detector.detect(videoRef.current);
            const valor = codigos[0]?.rawValue?.trim();
            if (!valor) return;
            const agora = Date.now();
            if (valor === ultimoLido.current.valor && agora - ultimoLido.current.em < 4000) return;
            ultimoLido.current = { valor, em: agora };
            if (modo === "ronda") setLigada(false);
            onQrRef.current(valor);
          } catch {
            /* frame sem QR */
          }
        }, 500);
      } catch {
        if (!cancelado) {
          setErro(frontal ? "Não foi possível abrir a câmara frontal." : "Não foi possível abrir a câmara.");
          setLigada(false);
        }
      }
    }

    void iniciar();
    return () => {
      cancelado = true;
      if (intervalo) clearInterval(intervalo);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLanternaDisponivel(false);
      setLanternaLigada(false);
    };
  }, [ligada, modo, portariaOk, selfiePronta]);

  function escolher(proximo: ModoCampo) {
    if (disabled) return;
    setErro("");
    ultimoLido.current = { valor: "", em: 0 };
    onModo(proximo);
    setLigada(true);
  }

  async function captarSelfie() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setErro("A câmara ainda está a iniciar. Tente captar de novo.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob || blob.size < 800) {
      setErro("Selfie inválida. Tente novamente.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(blob));
    onSelfie(new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" }));
    setLigada(false);
    setErro("");
  }

  async function alternarLanterna() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const novoEstado = !lanternaLigada;
    try {
      await track.applyConstraints({ advanced: [{ torch: novoEstado } as MediaTrackConstraintSet] });
      setLanternaLigada(novoEstado);
    } catch {
      setLanternaDisponivel(false);
      setLanternaLigada(false);
    }
  }

  const dica = modo === "ronda"
    ? "Enquadre o QR do local da ronda."
    : portariaOk
      ? "Capture a selfie frontal para concluir o ponto."
      : "Enquadre o QR da portaria.";

  return (
    <div className="rounded-[20px] bg-zinc-950 p-3 ring-1 ring-zinc-800">
      <div className="grid grid-cols-2 gap-2 pb-3">
        <button
          type="button"
          onClick={() => escolher("ponto")}
          className={`rounded-xl px-3 py-2 text-left ring-1 ${modo === "ponto" ? "bg-amber-500 text-zinc-950 ring-amber-400" : "bg-zinc-900 text-zinc-300 ring-zinc-700"}`}
        >
          <span className="block text-[13px] font-bold">Registar Ponto</span>
          <span className={`mt-0.5 block text-[11px] font-semibold ${modo === "ponto" ? "text-zinc-800" : "text-emerald-400"}`}>
            Próxima: {tipoPonto === "ENTRADA" ? "ENTRADA" : "SAÍDA"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => escolher("ronda")}
          className={`rounded-xl px-3 py-2 text-left text-[13px] font-bold ring-1 ${modo === "ronda" ? "bg-amber-500 text-zinc-950 ring-amber-400" : "bg-zinc-900 text-zinc-300 ring-zinc-700"}`}
        >
          Registar Ronda
        </button>
      </div>

      <p className="px-1 pb-2 text-[12px] text-zinc-400">{dica}</p>

      <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-black">
        {preview && modo === "ponto" ? (
          <img src={preview} alt="Selfie capturada" className="size-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className={`size-full object-cover ${ligada ? "" : "hidden"}`}
          />
        )}
        {ligada && lendoQr && (
          <>
            <span className="absolute left-4 top-4 size-7 border-l-[3px] border-t-[3px] border-amber-500" />
            <span className="absolute right-4 top-4 size-7 border-r-[3px] border-t-[3px] border-amber-500" />
            <span className="absolute bottom-4 left-4 size-7 border-b-[3px] border-l-[3px] border-amber-500" />
            <span className="absolute bottom-4 right-4 size-7 border-b-[3px] border-r-[3px] border-amber-500" />
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">
              Enquadre o código
            </span>
            {lanternaDisponivel && (
              <button
                type="button"
                onClick={() => void alternarLanterna()}
                aria-label={lanternaLigada ? "Desligar lanterna" : "Ligar lanterna"}
                className="absolute right-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-zinc-100 ring-1 ring-white/30"
              >
                {lanternaLigada ? <Flashlight className="size-6" /> : <FlashlightOff className="size-6" />}
              </button>
            )}
          </>
        )}
        {!ligada && !preview && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              {erro || "Escolha Ponto ou Ronda para ligar a câmara"}
            </p>
          </div>
        )}
        {ligada && aSelfie && (
          <button
            type="button"
            onClick={() => void captarSelfie()}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-amber-500 px-4 py-2 text-[12px] font-bold text-zinc-950"
          >
            Captar selfie agora
          </button>
        )}
      </div>

      <div className="mt-2.5 flex gap-2">
        {ligada && (
          <button
            type="button"
            onClick={() => setLigada(false)}
            className="w-full rounded-[12px] bg-zinc-900 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-400 ring-1 ring-zinc-800"
          >
            Desligar câmara
          </button>
        )}
        {modo === "ponto" && selfiePronta && (
          <button
            type="button"
            onClick={() => {
              onSelfie(null);
              setLigada(true);
            }}
            className="w-full rounded-[12px] bg-zinc-900 py-2.5 text-[12px] font-semibold text-zinc-200 ring-1 ring-zinc-800"
          >
            Tirar outra selfie
          </button>
        )}
      </div>
      {erro && ligada && <p className="mt-2 text-[12px] text-red-400">{erro}</p>}
    </div>
  );
}
