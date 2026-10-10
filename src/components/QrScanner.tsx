import { useEffect, useRef, useState } from "react";
import { Flashlight, FlashlightOff } from "lucide-react";

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

// "torch" ainda não consta dos tipos DOM do TypeScript.
type CapacidadesComLanterna = MediaTrackCapabilities & { torch?: boolean };
type RestricaoLanterna = MediaTrackConstraintSet & { torch?: boolean };

function suportaLanterna(track: MediaStreamTrack): boolean {
  const caps = track.getCapabilities?.() as CapacidadesComLanterna | undefined;
  return caps?.torch === true;
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
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [cameraAtiva, setCameraAtiva] = useState(false);
  const [erroCamera, setErroCamera] = useState("");
  const [lanternaDisponivel, setLanternaDisponivel] = useState(false);
  const [lanternaLigada, setLanternaLigada] = useState(false);
  const [erroLanterna, setErroLanterna] = useState("");
  const ultimoLido = useRef<{ valor: string; em: number }>({ valor: "", em: 0 });

  // Refs para o intervalo de leitura usar sempre os valores atuais.
  const disabledRef = useRef(disabled);
  const onDetectRef = useRef(onDetect);
  disabledRef.current = disabled;
  onDetectRef.current = onDetect;

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
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Alguns Android só expõem a capacidade "torch" depois do vídeo arrancar.
        if (track) {
          if (suportaLanterna(track)) setLanternaDisponivel(true);
          else
            verificacaoLanterna = setTimeout(() => {
              if (!cancelado && suportaLanterna(track)) setLanternaDisponivel(true);
            }, 800);
        }

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
      // Parar a faixa desliga também o LED.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      trackRef.current = null;
      setLanternaDisponivel(false);
      setLanternaLigada(false);
      setErroLanterna("");
    };
  }, [cameraAtiva]);

  // Altera só a restrição da faixa ativa: a câmara continua a correr sem reiniciar.
  async function alternarLanterna() {
    const track = trackRef.current;
    if (!track) return;
    const ligar = !lanternaLigada;
    try {
      await track.applyConstraints({ advanced: [{ torch: ligar } as RestricaoLanterna] });
      setLanternaLigada(ligar);
      setErroLanterna("");
    } catch {
      setErroLanterna("Não foi possível controlar a lanterna neste dispositivo.");
    }
  }

  return (
    <div className="rounded-[20px] bg-zinc-950 p-3 ring-1 ring-zinc-800">
      <div className="flex items-center justify-between px-1 pb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Leitor de QR
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          {cameraAtiva ? (lanternaLigada ? "câmera · lanterna" : "câmera ativa") : "câmera parada"}
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
                aria-pressed={lanternaLigada}
                aria-label={lanternaLigada ? "Desligar lanterna" : "Ligar lanterna"}
                title={lanternaLigada ? "Desligar lanterna" : "Ligar lanterna"}
                className={
                  lanternaLigada
                    ? "absolute right-1/2 top-3 grid size-12 translate-x-1/2 place-items-center rounded-full bg-amber-400 text-zinc-950 shadow-[0_0_24px_rgba(251,191,36,0.7)] ring-2 ring-amber-200 active:scale-95"
                    : "absolute right-1/2 top-3 grid size-12 translate-x-1/2 place-items-center rounded-full bg-black/60 text-zinc-100 ring-1 ring-zinc-500 backdrop-blur active:scale-95"
                }
              >
                {lanternaLigada ? (
                  <Flashlight className="size-6" />
                ) : (
                  <FlashlightOff className="size-6" />
                )}
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
                  onClick={() => setCameraAtiva(true)}
                  className="mt-4 rounded-[12px] bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3 font-display text-[14px] font-bold text-zinc-950 shadow-md active:translate-y-0.5"
                >
                  Ativar câmera
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {erroLanterna && (
        <p className="mt-2 px-1 text-[12px] font-medium text-amber-400">{erroLanterna}</p>
      )}
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
