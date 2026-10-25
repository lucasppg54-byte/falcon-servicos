import { useEffect, useRef, useState } from "react";
import { Flashlight, FlashlightOff } from "lucide-react";

/* ---------------- QR Scanner Nativo (BarcodeDetector) com Lanterna ---------------- */

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

type CapacidadesComTorch = MediaTrackCapabilities & { torch?: boolean };

function suportaLanterna(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== "function") return false;
  return !!(track.getCapabilities() as CapacidadesComTorch).torch;
}

export function QrScanner({
  onDetect,
  disabled,
}: {
  onDetect: (codigo: string) => void;
  disabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraAtiva, setCameraAtiva] = useState(false);
  const [erroCamera, setErroCamera] = useState("");
  const [lanternaDisponivel, setLanternaDisponivel] = useState(false);
  const [lanternaLigada, setLanternaLigada] = useState(false);
  const ultimoLido = useRef<{ valor: string; em: number }>({ valor: "", em: 0 });

  // Refs evitam que o intervalo de leitura use valores antigos sem reiniciar a câmara.
  const disabledRef = useRef(disabled);
  const onDetectRef = useRef(onDetect);
  disabledRef.current = disabled;
  onDetectRef.current = onDetect;

  useEffect(() => {
    if (disabled && cameraAtiva) setCameraAtiva(false);
  }, [disabled, cameraAtiva]);

  useEffect(() => {
    if (!cameraAtiva) return;
    let cancelado = false;
    let intervalo: ReturnType<typeof setInterval> | undefined;
    let verificacaoLanterna: ReturnType<typeof setTimeout> | undefined;

    async function iniciar() {
      if (!("BarcodeDetector" in window) || !window.BarcodeDetector) {
        setErroCamera("Este navegador não tem leitor de QR nativo. Use o código manual abaixo.");
        setCameraAtiva(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
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

        // Alguns Android só expõem a capacidade "torch" depois de o vídeo arrancar.
        const track = stream.getVideoTracks()[0];
        setLanternaDisponivel(suportaLanterna(track));
        verificacaoLanterna = setTimeout(() => {
          if (!cancelado) setLanternaDisponivel(suportaLanterna(track));
        }, 800);

        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        intervalo = setInterval(async () => {
          if (!videoRef.current || disabledRef.current) return;
          try {
            const codigos = await detector.detect(videoRef.current);
            const valor = codigos[0]?.rawValue?.trim();
            if (!valor) return;
            const agora = Date.now();
            if (valor === ultimoLido.current.valor && agora - ultimoLido.current.em < 4000) return;
            ultimoLido.current = { valor, em: agora };

            setCameraAtiva(false);
            onDetectRef.current(valor);
          } catch {
            /* frame sem QR */
          }
        }, 500);
      } catch {
        if (!cancelado) {
          setErroCamera("Não foi possível acessar a câmera. Use o código manual abaixo.");
          setCameraAtiva(false);
        }
      }
    }

    iniciar();
    return () => {
      cancelado = true;
      if (intervalo) clearInterval(intervalo);
      if (verificacaoLanterna) clearTimeout(verificacaoLanterna);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLanternaDisponivel(false);
      setLanternaLigada(false);
    };
  }, [cameraAtiva]);

  async function alternarLanterna() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const novoEstado = !lanternaLigada;
    try {
      // Aplica a restrição na faixa ativa: o LED muda sem reiniciar a câmara.
      await track.applyConstraints({ advanced: [{ torch: novoEstado } as MediaTrackConstraintSet] });
      setLanternaLigada(novoEstado);
    } catch {
      setLanternaDisponivel(false);
      setLanternaLigada(false);
    }
  }

  return (
    <div className="rounded-[20px] bg-zinc-950 p-3 ring-1 ring-zinc-800">
      <div className="flex items-center justify-between px-1 pb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Leitor de QR
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          {cameraAtiva ? "câmera ativa" : "câmera parada"}
        </span>
      </div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-black">
        {cameraAtiva ? (
          <>
            <video ref={videoRef} playsInline muted className="size-full object-cover" />
            <span className="absolute left-4 top-4 size-7 border-l-[3px] border-t-[3px] border-amber-500"></span>
            <span className="absolute right-4 top-4 size-7 border-r-[3px] border-t-[3px] border-amber-500"></span>
            <span className="absolute bottom-4 left-4 size-7 border-b-[3px] border-l-[3px] border-amber-500"></span>
            <span className="absolute bottom-4 right-4 size-7 border-b-[3px] border-r-[3px] border-amber-500"></span>
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">
              Enquadre o código
            </span>
            {lanternaDisponivel && (
              <button
                type="button"
                onClick={alternarLanterna}
                aria-label={lanternaLigada ? "Desligar lanterna" : "Ligar lanterna"}
                aria-pressed={lanternaLigada}
                className={
                  lanternaLigada
                    ? "absolute right-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-amber-400 text-zinc-950 shadow-[0_0_24px_rgba(251,191,36,0.6)] ring-2 ring-amber-200 active:scale-95"
                    : "absolute right-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-zinc-100 ring-1 ring-white/30 backdrop-blur active:scale-95"
                }
              >
                {lanternaLigada ? <Flashlight className="size-6" /> : <FlashlightOff className="size-6" />}
              </button>
            )}
          </>
        ) : (
          <div className="grid size-full place-items-center p-6 text-center">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                {erroCamera || "Câmera desligada"}
              </p>
              {!erroCamera && (
                <button
                  disabled={disabled}
                  onClick={() => setCameraAtiva(true)}
                  className="mt-4 rounded-[12px] bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3 font-display text-[14px] font-bold text-zinc-950 shadow-md active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Ativar câmera
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {cameraAtiva && (
        <button
          onClick={() => setCameraAtiva(false)}
          className="mt-2.5 w-full rounded-[12px] bg-zinc-900 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-400 ring-1 ring-zinc-800"
        >
          Desligar câmera
        </button>
      )}
    </div>
  );
}
