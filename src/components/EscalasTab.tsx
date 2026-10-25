import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  HORARIOS_TURNO,
  classificarEscala,
  excluirEscala,
  guardarEscala,
  hojeISO,
  listarEscalas,
  postosSemCobertura,
  turnoAtivoAgora,
  type Escala,
  type LinhaEscalaRealtime,
  type TurnoEscala,
} from "@/lib/operacao";
import { tipoPontoDaDescricao, type MarcacaoPonto } from "@/lib/folha-ponto";
import { listarRegistros } from "@/lib/rondas";
import { supabase } from "@/integrations/supabase/client";

function horaCurta(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const ESTILO: Record<LinhaEscalaRealtime["status"], string> = {
  NO_POSTO: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  SAIU: "bg-zinc-700/40 text-zinc-300 ring-zinc-600",
  FALTA: "bg-red-500/15 text-red-400 ring-red-500/30",
  PREVISTO: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
};

const ROTULO = {
  NO_POSTO: "No posto",
  SAIU: "Já saiu",
  FALTA: "Falta / sem entrada",
  PREVISTO: "Previsto",
};

export function EscalasTab({ gestor }: { gestor: string }) {
  const [data, setData] = useState(hojeISO);
  const [filtroCliente, setFiltroCliente] = useState("TODOS");
  const [filtroTurno, setFiltroTurno] = useState<"TODOS" | TurnoEscala>("TODOS");
  const [filtroColaborador, setFiltroColaborador] = useState("TODOS");
  const [escalas, setEscalas] = useState<Escala[]>([]);
  const [marcacoes, setMarcacoes] = useState<MarcacaoPonto[]>([]);
  const [colaboradores, setColaboradores] = useState<string[]>([]);
  const [clientes, setClientes] = useState<string[]>([]);
  const [origem, setOrigem] = useState<"supabase" | "local">("supabase");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [novoNome, setNovoNome] = useState("");
  const [novoCliente, setNovoCliente] = useState("");
  const [novoTurno, setNovoTurno] = useState<TurnoEscala>(turnoAtivoAgora());
  const [novaEntrada, setNovaEntrada] = useState(HORARIOS_TURNO.DIURNO.entrada);
  const [novaSaida, setNovaSaida] = useState(HORARIOS_TURNO.DIURNO.saida);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const horas = HORARIOS_TURNO[novoTurno];
    setNovaEntrada(horas.entrada);
    setNovaSaida(horas.saida);
  }, [novoTurno]);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const [{ itens, origem: src }, regs, segs, locs] = await Promise.all([
        listarEscalas(data),
        listarRegistros(800, { dataInicial: data, dataFinal: data }),
        supabase.from("segurancas").select("nome").eq("ativo", true).order("nome"),
        supabase.from("locais_ronda").select("predio"),
      ]);
      setEscalas(itens);
      setOrigem(src);
      setMarcacoes(
        regs
          .map((r) => {
            const tipo = tipoPontoDaDescricao(r.descricao);
            if (!tipo) return null;
            return { id: r.id, seguranca: r.seguranca, tipo, created_at: r.created_at, predio: r.locais_ronda?.predio };
          })
          .filter((m): m is MarcacaoPonto => !!m),
      );
      setColaboradores((segs.data || []).map((s: { nome: string }) => s.nome));
      setClientes(Array.from(new Set((locs.data || []).map((l: { predio: string }) => l.predio).filter(Boolean))).sort());
      if (!novoCliente && (locs.data || [])[0]) setNovoCliente((locs.data || [])[0].predio);
      if (!novoNome && (segs.data || [])[0]) setNovoNome((segs.data || [])[0].nome);
    } catch {
      setErro("Não foi possível carregar as escalas.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [data]);

  const linhas = useMemo(() => {
    return escalas
      .map((e) => classificarEscala(e, marcacoes))
      .filter((e) => (filtroCliente === "TODOS" ? true : e.predio === filtroCliente))
      .filter((e) => (filtroTurno === "TODOS" ? true : e.turno === filtroTurno))
      .filter((e) => (filtroColaborador === "TODOS" ? true : e.seguranca === filtroColaborador));
  }, [escalas, marcacoes, filtroCliente, filtroTurno, filtroColaborador]);

  const descobertos = postosSemCobertura(linhas);
  const noPosto = linhas.filter((l) => l.status === "NO_POSTO").length;
  const faltas = linhas.filter((l) => l.status === "FALTA").length;
  const previstos = linhas.filter((l) => l.status === "PREVISTO").length;

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    if (!novoNome || !novoCliente) {
      window.alert("Escolha o colaborador e o cliente/posto.");
      return;
    }
    setSalvando(true);
    try {
      await guardarEscala({
        data,
        turno: novoTurno,
        hora_entrada: novaEntrada,
        hora_saida: novaSaida,
        predio: novoCliente,
        seguranca: novoNome,
        created_by: gestor,
      });
      await carregar();
    } catch (err: any) {
      window.alert(err?.message || "Não foi possível gravar a escala.");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    if (!window.confirm("Remover esta linha da escala prevista?")) return;
    await excluirEscala(id);
    await carregar();
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-amber-500/30 shadow-xl sm:p-6">
        <h3 className="font-display text-[16px] font-bold text-amber-400 sm:text-[18px]">📅 Escalas — Prevista vs Tempo Real</h3>
        <p className="mt-1 text-[13px] text-zinc-400">
          Quem deveria estar a trabalhar, quem já entrou, quem saiu e que postos estão sem cobertura.
        </p>
        {origem === "local" && (
          <p className="mt-2 text-[12px] text-amber-300">
            A tabela `escalas` ainda não existe no Supabase. A escala está a ser guardada neste browser até correr a migration da Fase 2.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cartao resumo="Previstos" valor={previstos} cor="text-amber-400" />
        <Cartao resumo="No posto" valor={noPosto} cor="text-emerald-400" />
        <Cartao resumo="Faltas" valor={faltas} cor="text-red-400" />
        <Cartao resumo="Sem cobertura" valor={descobertos.length} cor="text-red-300" />
      </div>

      {descobertos.length > 0 && (
        <div className="rounded-xl bg-red-950/50 p-3 ring-1 ring-red-500/40 text-[13px] text-red-200">
          Postos sem cobertura neste recorte: <span className="font-semibold">{descobertos.join(", ")}</span>
        </div>
      )}

      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Campo label="Data">
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Cliente / posto">
            <select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} className={inputCls}>
              <option value="TODOS">Todos</option>
              {clientes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Turno">
            <select value={filtroTurno} onChange={(e) => setFiltroTurno(e.target.value as "TODOS" | TurnoEscala)} className={inputCls}>
              <option value="TODOS">Todos</option>
              <option value="DIURNO">Diurno</option>
              <option value="NOTURNO">Noturno</option>
            </select>
          </Campo>
          <Campo label="Colaborador">
            <select value={filtroColaborador} onChange={(e) => setFiltroColaborador(e.target.value)} className={inputCls}>
              <option value="TODOS">Todos</option>
              {colaboradores.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </Campo>
          <div className="flex items-end">
            <button type="button" onClick={carregar} className="w-full rounded-xl bg-zinc-800 py-3 text-[13px] font-semibold text-zinc-100">
              Atualizar
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={adicionar} className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-6">
        <p className="text-[13px] font-semibold text-zinc-200">+ Lançar escala prevista</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className={inputCls}>
            <option value="">Colaborador</option>
            {colaboradores.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select value={novoCliente} onChange={(e) => setNovoCliente(e.target.value)} className={inputCls}>
            <option value="">Cliente / posto</option>
            {clientes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={novoTurno} onChange={(e) => setNovoTurno(e.target.value as TurnoEscala)} className={inputCls}>
            <option value="DIURNO">{HORARIOS_TURNO.DIURNO.label}</option>
            <option value="NOTURNO">{HORARIOS_TURNO.NOTURNO.label}</option>
          </select>
          <input type="time" value={novaEntrada} onChange={(e) => setNovaEntrada(e.target.value)} className={inputCls} />
          <input type="time" value={novaSaida} onChange={(e) => setNovaSaida(e.target.value)} className={inputCls} />
        </div>
        <button disabled={salvando} className="rounded-xl bg-amber-500 px-4 py-2.5 text-[13px] font-bold text-zinc-950 disabled:opacity-50">
          {salvando ? "A gravar..." : "Adicionar à escala do dia"}
        </button>
      </form>

      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl sm:p-6">
        {carregando ? (
          <p className="text-center text-[13px] text-zinc-500 py-6">A cruzar escala e ponto...</p>
        ) : erro ? (
          <p className="text-center text-[13px] text-red-400 py-6">{erro}</p>
        ) : linhas.length === 0 ? (
          <p className="text-center text-[13px] text-zinc-500 py-6">Nenhuma escala prevista para este filtro. Lance a escala acima.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="pb-2 pr-3">Colaborador</th>
                  <th className="pb-2 pr-3">Posto</th>
                  <th className="pb-2 pr-3">Turno</th>
                  <th className="pb-2 pr-3">Previsto</th>
                  <th className="pb-2 pr-3">Entrada real</th>
                  <th className="pb-2 pr-3">Saída real</th>
                  <th className="pb-2 pr-3">Estado</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id} className="border-t border-zinc-800 text-zinc-200">
                    <td className="py-2.5 pr-3 font-semibold">{l.seguranca}</td>
                    <td className="py-2.5 pr-3 text-amber-400">{l.predio}</td>
                    <td className="py-2.5 pr-3">{l.turno === "DIURNO" ? "Diurno" : "Noturno"}</td>
                    <td className="py-2.5 pr-3 font-mono text-zinc-400">
                      {l.hora_entrada}–{l.hora_saida}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-emerald-400">{horaCurta(l.entradaReal)}</td>
                    <td className="py-2.5 pr-3 font-mono text-zinc-300">{horaCurta(l.saidaReal)}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ${ESTILO[l.status]}`}>{ROTULO[l.status]}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => remover(l.id)} className="text-[11px] font-semibold text-red-400">
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500";

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[12px] font-semibold text-zinc-400">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Cartao({ resumo, valor, cor }: { resumo: string; valor: number; cor: string }) {
  return (
    <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{resumo}</p>
      <p className={`mt-1 font-display text-[22px] font-bold ${cor}`}>{valor}</p>
    </div>
  );
}
