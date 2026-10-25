import { useEffect, useState } from "react";
import { CapturaSelfie } from "@/components/CapturaSelfie";
import { QrScanner } from "@/components/QrScanner";
import { proximoTipoPonto, tipoPontoDaDescricao, type MarcacaoPonto, type TipoPonto } from "@/lib/folha-ponto";
import {
  EVENTO_FILA_PONTO,
  listarPendentes,
  precacheLocaisPonto,
  registarPontoCampo,
  resolverLocalPonto,
  type PontoPendente,
} from "@/lib/ponto-offline";
import { listarRegistros, normalizarCodigoQr } from "@/lib/rondas";

export function BaterPontoPanel({
  seguranca,
  onRegistado,
}: {
  seguranca: string;
  onRegistado?: () => void;
}) {
  const [selfie, setSelfie] = useState<File | null>(null);
  const [cicloSelfie, setCicloSelfie] = useState(0);
  const [codigo, setCodigo] = useState("");
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

  async function bater(codigoBruto: string) {
    if (!selfie) {
      setErro("Capture a selfie antes de ler o QR ou confirmar o ponto.");
      return;
    }
    const codigoLimpo = normalizarCodigoQr(codigoBruto);
    if (!codigoLimpo) return;
    setRegistando(true);
    setErro("");
    setOk("");
    try {
      const local = await resolverLocalPonto(codigoLimpo);
      if (!local) {
        setErro(`QR "${codigoLimpo}" não encontrado (nem no posto nem no cache offline).`);
        return;
      }
      const resultado = await registarPontoCampo({ local, seguranca, tipo, selfie });
      setCodigo("");
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
          <p className="font-display text-[15px] font-bold text-zinc-100">Bater ponto — {seguranca}</p>
          <p className="text-[12px] text-zinc-400">Selfie + QR do posto. Funciona sem internet; a hora original é preservada.</p>
        </div>
        <span className={`rounded-md px-2 py-1 text-[11px] font-bold ring-1 ${tipo === "ENTRADA" ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" : "bg-amber-500/15 text-amber-400 ring-amber-500/30"}`}>
          Próxima: {tipo === "ENTRADA" ? "ENTRADA" : "SAÍDA"}
        </span>
      </div>

      <CapturaSelfie key={cicloSelfie} onCapturar={setSelfie} disabled={registando} />

      <QrScanner disabled={registando || !selfie} onDetect={(valor) => void bater(valor)} />

      <div className="flex gap-2">
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void bater(codigo)}
          placeholder="Ou digite o código QR do posto"
          className="flex-1 rounded-xl bg-zinc-950 p-3 font-mono text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="button"
          disabled={registando || !selfie || !codigo.trim()}
          onClick={() => void bater(codigo)}
          className="rounded-xl bg-amber-500 px-4 py-2 text-[13px] font-bold text-zinc-950 disabled:opacity-50"
        >
          {registando ? "A gravar..." : "Registar"}
        </button>
      </div>
      {!selfie && <p className="text-[12px] text-amber-300">A câmara do QR só fica ativa depois da selfie.</p>}
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
