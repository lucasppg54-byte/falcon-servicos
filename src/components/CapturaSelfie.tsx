import { useEffect, useRef, useState } from "react";

export function CapturaSelfie({
  onCapturar,
  disabled,
}: {
  onCapturar: (file: File | null) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aCapturar, setACapturar] = useState(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function ligarCamera() {
    setErro("");
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (videoRef.current.readyState < 2) {
          await new Promise<void>((resolve) => {
            const video = videoRef.current;
            if (!video) {
              resolve();
              return;
            }
            video.onloadeddata = () => resolve();
            window.setTimeout(resolve, 800);
          });
        }
      }
      setACapturar(true);
    } catch {
      setErro("Não foi possível abrir a câmara frontal. Permita o acesso à câmara.");
    }
  }

  async function captar() {
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
    const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(url);
    onCapturar(file);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setACapturar(false);
  }

  function repetir() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onCapturar(null);
    void ligarCamera();
  }

  return (
    <div className="rounded-xl bg-zinc-900 p-3 ring-1 ring-zinc-800 space-y-2">
      <p className="text-[12px] font-semibold text-zinc-300">Selfie obrigatória no momento do ponto</p>
      {preview ? (
        <img src={preview} alt="Selfie capturada" className="mx-auto size-40 rounded-full object-cover ring-2 ring-amber-500/50" />
      ) : (
        <video
          ref={videoRef}
          playsInline
          muted
          className={`mx-auto aspect-square w-full max-w-[220px] rounded-xl bg-black object-cover ${aCapturar ? "" : "hidden"}`}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {!preview && !aCapturar && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void ligarCamera()}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-[12px] font-semibold text-zinc-100 disabled:opacity-50"
          >
            Abrir câmara frontal
          </button>
        )}
        {aCapturar && (
          <button type="button" onClick={() => void captar()} className="rounded-lg bg-amber-500 px-3 py-2 text-[12px] font-bold text-zinc-950">
            Captar selfie agora
          </button>
        )}
        {preview && (
          <button type="button" onClick={repetir} className="rounded-lg bg-zinc-800 px-3 py-2 text-[12px] font-semibold text-zinc-100">
            Tirar outra
          </button>
        )}
        <label className="cursor-pointer rounded-lg bg-zinc-800 px-3 py-2 text-[12px] font-semibold text-zinc-100">
          {preview ? "Substituir ficheiro" : "Câmara / ficheiro"}
          <input
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (preview) URL.revokeObjectURL(preview);
              streamRef.current?.getTracks().forEach((t) => t.stop());
              setACapturar(false);
              setPreview(URL.createObjectURL(file));
              setErro("");
              onCapturar(file);
            }}
          />
        </label>
      </div>
      {erro && <p className="text-[12px] text-red-400">{erro}</p>}
    </div>
  );
}
