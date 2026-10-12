import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import type { LocalRonda } from "@/lib/rondas";
import { baixarQrPng, gerarQrVetorial, imprimirQrEmLote, type EtiquetaQr } from "@/lib/qr";

/* ---------------- Pré-visualização vetorial de um QR ---------------- */

export function QrPreview({ codigo, className }: { codigo: string; className?: string }) {
  const qr = useMemo(() => (codigo.trim() ? gerarQrVetorial(codigo.trim()) : null), [codigo]);
  if (!qr) return null;
  return (
    <svg
      viewBox={`0 0 ${qr.tamanho} ${qr.tamanho}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code ${codigo}`}
      className={className}
    >
      <rect width={qr.tamanho} height={qr.tamanho} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

function paraEtiqueta(l: LocalRonda): EtiquetaQr {
  return { codigo: l.qr_code_hash, predio: l.predio, local: l.local };
}

/* ---------------- Lista de locais com QR, download e impressão em lote ---------------- */

export function LocaisQrSection({
  locais,
  onEditar,
  onExcluir,
}: {
  locais: LocalRonda[];
  onEditar: (local: LocalRonda) => void;
  onExcluir: (id: string) => void;
}) {
  const [filtroPredio, setFiltroPredio] = useState("TODOS");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const predios = useMemo(() => Array.from(new Set(locais.map((l) => l.predio))).sort(), [locais]);
  const visiveis = filtroPredio === "TODOS" ? locais : locais.filter((l) => l.predio === filtroPredio);
  const selecionadosVisiveis = visiveis.filter((l) => selecionados.has(l.id));
  const todosMarcados = visiveis.length > 0 && selecionadosVisiveis.length === visiveis.length;

  function alternar(id: string) {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarTodos() {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      for (const l of visiveis) {
        if (todosMarcados) novo.delete(l.id);
        else novo.add(l.id);
      }
      return novo;
    });
  }

  // Sem seleção, imprime todos os locais visíveis no filtro.
  const paraImprimir = selecionadosVisiveis.length > 0 ? selecionadosVisiveis : visiveis;

  return (
    <div className="border-t border-zinc-800 pt-5 mt-5 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] font-semibold text-zinc-300">Locais Cadastrados ({locais.length})</p>
        <select
          value={filtroPredio}
          onChange={(e) => setFiltroPredio(e.target.value)}
          className="rounded-[10px] bg-zinc-950 px-2.5 py-2 text-[13px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="TODOS">🏢 Todos os prédios</option>
          {predios.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {locais.length === 0 ? (
        <p className="text-[13px] text-zinc-600">Nenhum local cadastrado ainda.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-[13px] text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} className="size-4 accent-amber-500" />
              Selecionar todos ({visiveis.length})
            </label>
            <button
              type="button"
              onClick={() => imprimirQrEmLote(paraImprimir.map(paraEtiqueta))}
              disabled={paraImprimir.length === 0}
              className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-[13px] font-bold text-zinc-950 shadow-md disabled:opacity-50 active:translate-y-0.5 sm:ml-auto"
            >
              <Printer className="size-4" />
              Imprimir em lote ({paraImprimir.length}) — A4
            </button>
          </div>

          <div className="space-y-2.5 max-h-[28rem] overflow-y-auto pr-1">
            {visiveis.map((l) => (
              <div
                key={l.id}
                className="flex flex-col gap-3 rounded-xl bg-zinc-950 p-3 text-[14px] ring-1 ring-zinc-800 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selecionados.has(l.id)}
                    onChange={() => alternar(l.id)}
                    aria-label={`Selecionar ${l.predio} — ${l.local}`}
                    className="size-4 shrink-0 accent-amber-500"
                  />
                  <QrPreview codigo={l.qr_code_hash} className="size-14 shrink-0 rounded-md" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-200">
                      {l.predio} — {l.local}
                    </p>
                    <p className="truncate text-[12px] text-zinc-500">
                      <code className="font-mono">{l.qr_code_hash}</code>
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => baixarQrPng(paraEtiqueta(l))}
                    className="flex items-center justify-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 ring-1 ring-zinc-700"
                  >
                    <Download className="size-3.5" /> PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditar(l)}
                    className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-[12px] font-semibold text-amber-400 ring-1 ring-amber-500/30"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onExcluir(l.id)}
                    className="rounded-lg bg-red-950 px-3 py-1.5 text-[12px] font-semibold text-red-400 ring-1 ring-red-500/30"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
