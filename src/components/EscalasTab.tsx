import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  HORARIOS_TURNO,
  JUSTIFICATIVAS_ESCALA,
  atualizarEscala,
  classificarEscala,
  excluirEscala,
  guardarEscala,
  hojeISO,
  listarEscalas,
  listarEscalasIntervalo,
  postosSemCobertura,
  textoObservacaoEscala,
  turnoAtivoAgora,
  type Escala,
  type LinhaEscalaRealtime,
  type TurnoEscala,
} from "@/lib/operacao";
import { diasDoMes, mesAtual, primeiroDiaMes, tipoPontoDaDescricao, ultimoDiaMes, type MarcacaoPonto } from "@/lib/folha-ponto";
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
  const [dataRealtime, setDataRealtime] = useState(hojeISO());
  const [mes, setMes] = useState(mesAtual());
  const [diaPlaneado, setDiaPlaneado] = useState(hojeISO());
  const [filtroCliente, setFiltroCliente] = useState("TODOS");
  const [filtroTurno, setFiltroTurno] = useState<"TODOS" | TurnoEscala>("TODOS");
  const [filtroColaborador, setFiltroColaborador] = useState("TODOS");
  const [escalasDia, setEscalasDia] = useState<Escala[]>([]);
  const [escalasMes, setEscalasMes] = useState<Escala[]>([]);
  const [marcacoes, setMarcacoes] = useState<MarcacaoPonto[]>([]);
  const [colaboradores, setColaboradores] = useState<string[]>([]);
  const [clientes, setClientes] = useState<string[]>([]);
  const [origem, setOrigem] = useState<"supabase" | "local">("supabase");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [novoCliente, setNovoCliente] = useState("");
  const [novoTurno, setNovoTurno] = useState<TurnoEscala>(turnoAtivoAgora());
  const [novaEntrada, setNovaEntrada] = useState(HORARIOS_TURNO.DIURNO.entrada);
  const [novaSaida, setNovaSaida] = useState(HORARIOS_TURNO.DIURNO.saida);
  const [cobertura, setCobertura] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (editandoId) return;
    const horas = HORARIOS_TURNO[novoTurno];
    setNovaEntrada(horas.entrada);
    setNovaSaida(horas.saida);
  }, [novoTurno, editandoId]);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const [{ itens, origem: src }, mesItens, regs, segs, locs] = await Promise.all([
        listarEscalas(dataRealtime),
        listarEscalasIntervalo(primeiroDiaMes(mes), ultimoDiaMes(mes)),
        listarRegistros(800, { dataInicial: dataRealtime, dataFinal: dataRealtime }),
        supabase.from("segurancas").select("nome").order("nome"),
        supabase.from("locais_ronda").select("predio"),
      ]);
      setEscalasDia(itens);
      setEscalasMes(mesItens.itens);
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
      const nomes = (segs.data || []).map((s: { nome: string }) => s.nome).filter(Boolean);
      const predios = Array.from(new Set((locs.data || []).map((l: { predio: string }) => l.predio).filter(Boolean))).sort();
      setColaboradores(nomes);
      setClientes(predios);
      const primeiroPosto = predios[0];
      const primeiroNome = nomes[0];
      if (!novoCliente && primeiroPosto) setNovoCliente(primeiroPosto);
      if (!novoNome && primeiroNome) setNovoNome(primeiroNome);
    } catch {
      setErro("Não foi possível carregar as escalas.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [dataRealtime, mes]);

  const linhasRealtime = useMemo(() => {
    return escalasDia
      .map((e) => classificarEscala(e, marcacoes))
      .filter((e) => (filtroCliente === "TODOS" ? true : e.predio === filtroCliente))
      .filter((e) => (filtroTurno === "TODOS" ? true : e.turno === filtroTurno))
      .filter((e) => (filtroColaborador === "TODOS" ? true : e.seguranca === filtroColaborador));
  }, [escalasDia, marcacoes, filtroCliente, filtroTurno, filtroColaborador]);

  const planeadas = useMemo(() => {
    return escalasMes
      .filter((e) => e.data === diaPlaneado)
      .filter((e) => (filtroCliente === "TODOS" ? true : e.predio === filtroCliente));
  }, [escalasMes, diaPlaneado, filtroCliente]);

  const diasMarcados = useMemo(() => new Set(escalasMes.map((e) => e.data)), [escalasMes]);
  const descobertos = postosSemCobertura(linhasRealtime);
  const noPosto = linhasRealtime.filter((l) => l.status === "NO_POSTO").length;
  const faltas = linhasRealtime.filter((l) => l.status === "FALTA").length;
  const previstos = linhasRealtime.filter((l) => l.status === "PREVISTO").length;

  function limparFormulario() {
    setEditandoId(null);
    setCobertura(false);
    setJustificativa("");
    setNovoTurno(turnoAtivoAgora());
  }

  function editar(linha: Escala) {
    setEditandoId(linha.id);
    setDiaPlaneado(linha.data);
    setNovoNome(linha.seguranca);
    setNovoCliente(linha.predio);
    setNovoTurno(linha.turno);
    setNovaEntrada(linha.hora_entrada);
    setNovaSaida(linha.hora_saida);
    setCobertura(!!linha.cobertura);
    setJustificativa(linha.justificativa || "");
  }

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    if (!novoNome || !novoCliente) {
      window.alert("Escolha o colaborador e o cliente/posto.");
      return;
    }
    setSalvando(true);
    try {
      const payload = {
        data: diaPlaneado,
        turno: novoTurno,
        hora_entrada: novaEntrada,
        hora_saida: novaSaida,
        predio: novoCliente,
        seguranca: novoNome,
        cobertura,
        justificativa: justificativa || null,
        created_by: gestor,
      };
      if (editandoId) await atualizarEscala(editandoId, payload);
      else await guardarEscala(payload);
      limparFormulario();
      await carregar();
    } catch (err: any) {
      window.alert(err?.message || "Não foi possível gravar a escala.");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    if (!window.confirm("Excluir esta linha da escala prevista?")) return;
    await excluirEscala(id);
    if (editandoId === id) limparFormulario();
    await carregar();
  }

  function escolherDia(dia: string) {
    setDiaPlaneado(dia);
    setMes(dia.slice(0, 7));
  }

  function imprimir() {
    const posto = filtroCliente === "TODOS" ? "Todos os postos" : filtroCliente;
    const linhas = escalasMes
      .filter((e) => (filtroCliente === "TODOS" ? true : e.predio === filtroCliente))
      .sort((a, b) => a.data.localeCompare(b.data) || a.seguranca.localeCompare(b.seguranca));
    const corpo = linhas
      .map(
        (e) => `<tr>
          <td>${new Date(`${e.data}T12:00:00`).toLocaleDateString("pt-BR")}</td>
          <td>${e.seguranca}</td>
          <td>${e.predio}</td>
          <td>${e.turno === "DIURNO" ? "Diurno" : "Noturno"}</td>
          <td>${e.hora_entrada}–${e.hora_saida}</td>
          <td>${e.cobertura ? "Sim" : "Não"}</td>
          <td>${e.justificativa || "—"}</td>
        </tr>`,
      )
      .join("");
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Escala — ${posto}</title>
      <style>
        body { font-family: Arial, sans-serif; color: #1c1a17; margin: 28px; }
        h1 { font-size: 22px; margin: 0; }
        p { color: #5a544c; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th, td { border: 1px solid #d9d2c6; padding: 8px; text-align: left; }
        th { background: #1c1a17; color: #fff; }
        @media print { .no-print { display: none; } }
      </style></head><body>
      <h1>Falcon Serviços — Relatório de Escalas</h1>
      <p>${posto} · competência ${mes}</p>
      <table><thead><tr><th>Data</th><th>Colaborador</th><th>Posto</th><th>Turno</th><th>Horário</th><th>Cobertura</th><th>Justificativa</th></tr></thead>
      <tbody>${corpo || `<tr><td colspan="7">Sem escalas neste recorte.</td></tr>`}</tbody></table>
      <p>Gerado em ${new Date().toLocaleString("pt-BR")} por ${gestor}.</p>
      <div class="no-print"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
      </body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    if (!window.open(url, "_blank")) window.alert("Permita os pop-ups para imprimir a escala.");
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-amber-500/30 shadow-xl sm:p-6">
        <h3 className="font-display text-[16px] font-bold text-amber-400 sm:text-[18px]">📅 Escalas</h3>
        <p className="mt-1 text-[13px] text-zinc-400">
          Tempo real e planeamento ficam separados. A justificativa da escala entra como observação na folha de ponto.
        </p>
        {origem === "local" && (
          <p className="mt-2 text-[12px] text-amber-300">
            A tabela de escalas ainda não está disponível no Supabase. O planeamento fica neste browser.
          </p>
        )}
      </div>

      <section className="space-y-4">
        <h4 className="font-display text-[15px] font-bold text-zinc-100">Tempo real</h4>
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
            <Campo label="Dia em monitoramento">
              <input type="date" value={dataRealtime} onChange={(e) => setDataRealtime(e.target.value)} className={inputCls} />
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
          <TabelaRealtime linhas={linhasRealtime} carregando={carregando} erro={erro} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-display text-[15px] font-bold text-zinc-100">Planeamento da escala prevista</h4>
          <button type="button" onClick={imprimir} className="rounded-xl bg-zinc-800 px-3 py-2 text-[12px] font-semibold text-zinc-100 ring-1 ring-zinc-700">
            Imprimir / Gerar Relatório de Escalas
          </button>
        </div>

        <CalendarioMes
          mes={mes}
          dia={diaPlaneado}
          marcados={diasMarcados}
          onMes={(valor) => {
            setMes(valor);
            setDiaPlaneado(`${valor}-01`);
          }}
          onDia={escolherDia}
        />

        <form onSubmit={adicionar} className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-6">
          <p className="text-[13px] font-semibold text-zinc-200">
            {editandoId ? "Editar linha prevista" : "+ Lançar escala prevista"} · {new Date(`${diaPlaneado}T12:00:00`).toLocaleDateString("pt-BR")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <select value={justificativa} onChange={(e) => setJustificativa(e.target.value)} className={inputCls}>
              <option value="">Justificativa / motivo</option>
              {JUSTIFICATIVAS_ESCALA.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-zinc-200">
            <span>Cobertura</span>
            <button type="button" onClick={() => setCobertura(true)} className={cobertura ? "rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-zinc-950" : "rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300"}>
              Sim
            </button>
            <button type="button" onClick={() => setCobertura(false)} className={!cobertura ? "rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-zinc-950" : "rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-300"}>
              Não
            </button>
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={salvando} className="rounded-xl bg-amber-500 px-4 py-2.5 text-[13px] font-bold text-zinc-950 disabled:opacity-50">
              {salvando ? "A gravar..." : editandoId ? "Guardar alteração" : "Adicionar à escala do dia"}
            </button>
            {editandoId && (
              <button type="button" onClick={limparFormulario} className="rounded-xl bg-zinc-800 px-4 py-2.5 text-[13px] font-semibold text-zinc-100">
                Cancelar edição
              </button>
            )}
          </div>
        </form>

        <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl sm:p-6">
          {planeadas.length === 0 ? (
            <p className="text-center text-[13px] text-zinc-500 py-6">Nenhuma escala prevista neste dia e posto.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="pb-2 pr-3">Colaborador</th>
                    <th className="pb-2 pr-3">Posto</th>
                    <th className="pb-2 pr-3">Turno</th>
                    <th className="pb-2 pr-3">Horário</th>
                    <th className="pb-2 pr-3">Cobertura</th>
                    <th className="pb-2 pr-3">Justificativa</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {planeadas.map((l) => (
                    <tr key={l.id} className="border-t border-zinc-800 text-zinc-200">
                      <td className="py-2.5 pr-3 font-semibold">{l.seguranca}</td>
                      <td className="py-2.5 pr-3 text-amber-400">{l.predio}</td>
                      <td className="py-2.5 pr-3">{l.turno === "DIURNO" ? "Diurno" : "Noturno"}</td>
                      <td className="py-2.5 pr-3 font-mono text-zinc-400">{l.hora_entrada}–{l.hora_saida}</td>
                      <td className="py-2.5 pr-3">{l.cobertura ? "Sim" : "Não"}</td>
                      <td className="py-2.5 pr-3 text-zinc-400">{textoObservacaoEscala(l) || "—"}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button type="button" onClick={() => editar(l)} className="mr-3 text-[11px] font-semibold text-amber-400">Editar</button>
                        <button type="button" onClick={() => remover(l.id)} className="text-[11px] font-semibold text-red-400">Excluir</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function TabelaRealtime({ linhas, carregando, erro }: { linhas: LinhaEscalaRealtime[]; carregando: boolean; erro: string }) {
  if (carregando) return <p className="text-center text-[13px] text-zinc-500 py-6">A cruzar escala e ponto...</p>;
  if (erro) return <p className="text-center text-[13px] text-red-400 py-6">{erro}</p>;
  if (linhas.length === 0) return <p className="text-center text-[13px] text-zinc-500 py-6">Nenhuma escala prevista para monitorizar neste dia.</p>;
  return (
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
            <th className="pb-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-t border-zinc-800 text-zinc-200">
              <td className="py-2.5 pr-3 font-semibold">{l.seguranca}</td>
              <td className="py-2.5 pr-3 text-amber-400">{l.predio}</td>
              <td className="py-2.5 pr-3">{l.turno === "DIURNO" ? "Diurno" : "Noturno"}</td>
              <td className="py-2.5 pr-3 font-mono text-zinc-400">{l.hora_entrada}–{l.hora_saida}</td>
              <td className="py-2.5 pr-3 font-mono text-emerald-400">{horaCurta(l.entradaReal)}</td>
              <td className="py-2.5 pr-3 font-mono text-zinc-300">{horaCurta(l.saidaReal)}</td>
              <td className="py-2.5">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ${ESTILO[l.status]}`}>{ROTULO[l.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalendarioMes({
  mes,
  dia,
  marcados,
  onMes,
  onDia,
}: {
  mes: string;
  dia: string;
  marcados: Set<string>;
  onMes: (mes: string) => void;
  onDia: (dia: string) => void;
}) {
  const dias = diasDoMes(mes);
  const inicio = new Date(`${mes}-01T12:00:00`).getDay();
  return (
    <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl sm:p-6">
      <label className="block text-[12px] font-semibold text-zinc-400">
        Competência
        <input type="month" value={mes} onChange={(e) => onMes(e.target.value)} className={`${inputCls} mt-1 max-w-xs`} />
      </label>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-zinc-500">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: inicio }, (_, i) => (
          <span key={`vazio-${i}`} />
        ))}
        {dias.map((d) => {
          const ativo = d === dia;
          const tem = marcados.has(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDia(d)}
              className={`rounded-lg py-2 text-[12px] font-semibold ${ativo ? "bg-amber-500 text-zinc-950" : "bg-zinc-950 text-zinc-200 ring-1 ring-zinc-800"}`}
            >
              {Number(d.slice(-2))}
              {tem && !ativo && <span className="mt-0.5 block text-[9px] text-amber-400">●</span>}
            </button>
          );
        })}
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
