import { useEffect, useState } from "react";
import { CapturaSelfie } from "@/components/CapturaSelfie";
import { proximoTipoPonto, tipoPontoDaDescricao, type MarcacaoPonto, type TipoPonto } from "@/lib/folha-ponto";
import {
  EVENTO_FILA_PONTO,
  listarPendentes,
  precacheLocaisPonto,
  registarPontoCampo,
  resolverLocalDoPosto,
  type PontoPendente,
} from "@/lib/ponto-offline";
import { listarRegistros } from "@/lib/rondas";

export function BaterPontoPanel({
  seguranca,
  postoAtribuido,
  onRegistado,
}: {
  seguranca: string;
  postoAtribuido: string;
  onRegistado?: () => void;
}) {
  const [selfie, setSelfie] = useState<File | null>(null);
  const [cicloSelfie, setCicloSelfie] = useState(0);
  const [tipo, setTipo] = useState<TipoPonto>("ENTRADA");
  const [pendentes, setPendentes] = useState<PontoPendente[]>([]);
  const [registando, setRegistando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  async function refrescarContexto() {
    const fila = (await listarPendentes()).filter((p) => p.seguranca === seguranca);
    setPendentes(fila);
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const regs = await listarRegistros(200, { dataInicial: hoje, dataFinal: hoje });
      const marcas: MarcacaoPonto[] = [
        ...regs
          .filter((r) => r.seguranca === seguranca)
          .map((r) => {
            const t = tipoPontoDaDescricao(r.descricao);
            if (!t) return null;
            return { id: r.id, seguranca: r.seguranca, tipo: t, created_at: r.created_at };
          })
          .filter((m): m is MarcacaoPonto => !!m),
        ...fila.map((p) => ({ id: p.id, seguranca: p.seguranca, tipo: p.tipo, created_at: p.created_at })),
      ];
      setTipo(proximoTipoPonto(marcas));
    } catch {
      setTipo(proximoTipoPonto(fila.map((p) => ({ id: p.id, seguranca: p.seguranca, tipo: p.tipo, created_at: p.created_at }))));
    }
  }

  useEffect(() => {
    void precacheLocaisPonto();
    void refrescarContexto();
    const ouvir = () => void refrescarContexto();
    window.addEventListener(EVENTO_FILA_PONTO, ouvir);
    return () => window.removeEventListener(EVENTO_FILA_PONTO, ouvir);
  }, [seguranca]);

  async function bater() {
    if (!selfie) {
      setErro("Capture a selfie antes de registar o ponto.");
      return;
    }
    setRegistando(true);
    setErro("");
    setOk("");
    try {
      const local = await resolverLocalDoPosto(postoAtribuido);
      if (!local) {
        setErro(`Não há posto em cache para "${postoAtribuido}". Abra a aplicação online uma vez para guardar os locais.`);
        return;
      }
      const resultado = await registarPontoCampo({ local, seguranca, tipo, selfie });
      setSelfie(null);
      setCicloSelfie((n) => n + 1);
      if (resultado.modo === "offline") {
        setOk(`Ponto de ${tipo === "ENTRADA" ? "entrada" : "saída"} guardado offline às ${new Date(resultado.created_at).toLocaleTimeString("pt-BR")}. Será enviado automaticamente.`);
      } else {
        setOk(`${tipo === "ENTRADA" ? "Entrada" : "Saída"} registada com selfie em ${local.predio}.`);
      }
      await refrescarContexto();
      onRegistado?.();
    } catch (err: any) {
      setErro(err?.message || "Não foi possível registar o ponto.");
    } finally {
      setRegistando(false);
    }
  }

  return (
    <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-display text-[15px] font-bold text-zinc-100">Ponto — {seguranca}</p>
          <p className="text-[12px] text-zinc-400">
            Selfie obrigatória no posto {postoAtribuido || "atribuído"}. A câmara fecha depois da captura.
          </p>
        </div>
        <span className={`rounded-md px-2 py-1 text-[11px] font-bold ring-1 ${tipo === "ENTRADA" ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" : "bg-amber-500/15 text-amber-400 ring-amber-500/30"}`}>
          Próxima: {tipo === "ENTRADA" ? "ENTRADA" : "SAÍDA"}
        </span>
      </div>

      <CapturaSelfie key={cicloSelfie} onCapturar={setSelfie} disabled={registando} />

      <button
        type="button"
        disabled={registando || !selfie}
        onClick={() => void bater()}
        className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-[13px] font-bold text-zinc-950 disabled:opacity-50"
      >
        {registando ? "A gravar..." : "Registar ponto"}
      </button>
      {erro && <p className="text-[13px] font-medium text-red-400">{erro}</p>}
      {ok && <p className="text-[13px] font-medium text-emerald-400">{ok}</p>}

      {pendentes.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/30 space-y-1.5">
          <p className="text-[12px] font-bold text-amber-300">{pendentes.length} ponto(s) à espera de sincronizar</p>
          {pendentes.map((p) => (
            <p key={p.id} className="text-[12px] text-amber-100/90">
              {p.tipo} · {p.predio} · {new Date(p.created_at).toLocaleString("pt-BR")}
              {p.ultimoErro ? ` · ${p.ultimoErro}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
