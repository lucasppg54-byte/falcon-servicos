import { useEffect, useState } from "react";
import {
  EVENTO_FILA_PONTO,
  estaOnline,
  iniciarSincronizacaoAutomatica,
  listarPendentes,
  sincronizarFilaPonto,
} from "@/lib/ponto-offline";

export function IndicadorSincronizacao() {
  const [online, setOnline] = useState(estaOnline);
  const [pendentes, setPendentes] = useState(0);
  const [aSincronizar, setASincronizar] = useState(false);

  async function refrescar() {
    const fila = await listarPendentes();
    setPendentes(fila.length);
    setOnline(estaOnline());
  }

  useEffect(() => {
    void refrescar();
    const parar = iniciarSincronizacaoAutomatica();
    const onOnline = () => {
      setOnline(true);
      void refrescar();
    };
    const onOffline = () => setOnline(false);
    const onFila = () => void refrescar();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(EVENTO_FILA_PONTO, onFila);
    return () => {
      parar();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(EVENTO_FILA_PONTO, onFila);
    };
  }, []);

  async function sincronizarAgora() {
    setASincronizar(true);
    await sincronizarFilaPonto();
    await refrescar();
    setASincronizar(false);
  }

  return (
    <button
      type="button"
      onClick={() => void sincronizarAgora()}
      title={pendentes > 0 ? `${pendentes} ponto(s) por sincronizar` : online ? "Ligado à nuvem" : "Sem internet"}
      className="flex items-center gap-2 rounded-full bg-zinc-900 p-2 border border-zinc-800 sm:px-3.5 sm:py-1.5"
    >
      <span
        className={`size-2.5 rounded-full ${
          !online ? "bg-red-500" : pendentes > 0 ? "bg-amber-400" : "bg-emerald-500"
        } shadow-[0_0_0_3px_rgba(16,185,129,0.15)]`}
      />
      <span className="hidden text-[11px] font-semibold uppercase sm:inline">
        {!online
          ? pendentes > 0
            ? `Offline · ${pendentes} pendente${pendentes > 1 ? "s" : ""}`
            : "Offline"
          : aSincronizar
            ? "A sincronizar..."
            : pendentes > 0
              ? `${pendentes} pendente${pendentes > 1 ? "s" : ""}`
              : "Online"}
      </span>
    </button>
  );
}
