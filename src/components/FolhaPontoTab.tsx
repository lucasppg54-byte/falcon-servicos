import { useEffect, useMemo, useState } from "react";
import { BaterPontoPanel } from "@/components/BaterPontoPanel";
import {
  JORNADA_BASE_PADRAO,
  fundirMarcacoes,
  gravarValorHoraExtra,
  lerValoresHoraExtra,
  mesAtual,
  montarTurnos,
  primeiroDiaMes,
  tipoPontoDaDescricao,
  ultimoDiaMes,
  type MarcacaoPonto,
} from "@/lib/folha-ponto";
import { EVENTO_FILA_PONTO, listarPendentes } from "@/lib/ponto-offline";
import { listarRegistros } from "@/lib/rondas";
import { supabase } from "@/integrations/supabase/client";

interface Colaborador {
  id: string;
  nome: string;
  cargo: string;
  tipo_contrato?: string | null;
  valor_hora_extra?: number | null;
}

function formatarHora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function dinheiro(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function FolhaPontoTab() {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [funcionarioId, setFuncionarioId] = useState("");
  const [anoMes, setAnoMes] = useState(mesAtual);
  const [jornadaBase, setJornadaBase] = useState(JORNADA_BASE_PADRAO);
  const [valorHoraExtra, setValorHoraExtra] = useState(0);
  const [marcacoes, setMarcacoes] = useState<MarcacaoPonto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const funcionario = colaboradores.find((c) => c.id === funcionarioId);

  useEffect(() => {
    async function carregarEquipa() {
      try {
        const { data } = await supabase.from("segurancas").select("*").order("nome");
        const lista = ((data || []) as Colaborador[]).filter((c) => (c as Colaborador & { ativo?: boolean }).ativo !== false);
        setColaboradores(lista);
        if (lista[0]) setFuncionarioId((atual) => atual || lista[0].id);
      } catch {
        setColaboradores([]);
      }
    }
    carregarEquipa();
  }, []);

  useEffect(() => {
    if (!funcionarioId) return;
    const guardados = lerValoresHoraExtra();
    const daBase = colaboradores.find((c) => c.id === funcionarioId)?.valor_hora_extra;
    setValorHoraExtra(Number(guardados[funcionarioId] ?? daBase ?? 0));
  }, [funcionarioId, colaboradores]);

  async function carregarMarcacoes() {
    if (!funcionario) {
      setMarcacoes([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro("");
    try {
      const regs = await listarRegistros(2000, {
        dataInicial: primeiroDiaMes(anoMes),
        dataFinal: ultimoDiaMes(anoMes),
      });
      const remoto = regs
        .filter((r) => r.seguranca === funcionario.nome)
        .map((r) => {
          const tipo = tipoPontoDaDescricao(r.descricao);
          if (!tipo) return null;
          return {
            id: r.id,
            seguranca: r.seguranca,
            tipo,
            created_at: r.created_at,
            predio: r.locais_ronda?.predio,
            local: r.locais_ronda?.local,
            foto_url: r.foto_url,
          } satisfies MarcacaoPonto;
        })
        .filter((m): m is MarcacaoPonto => !!m);
      const fila = (await listarPendentes())
        .filter((p) => p.seguranca === funcionario.nome && p.created_at.slice(0, 7) === anoMes)
        .map((p) => ({
          id: p.id,
          seguranca: p.seguranca,
          tipo: p.tipo,
          created_at: p.created_at,
          predio: p.predio,
          local: p.local,
          pendente: true,
        } satisfies MarcacaoPonto));
      setMarcacoes(fundirMarcacoes(remoto, fila));
    } catch {
      const fila = (await listarPendentes())
        .filter((p) => p.seguranca === funcionario.nome && p.created_at.slice(0, 7) === anoMes)
        .map((p) => ({
          id: p.id,
          seguranca: p.seguranca,
          tipo: p.tipo,
          created_at: p.created_at,
          predio: p.predio,
          local: p.local,
          pendente: true,
        } satisfies MarcacaoPonto));
      setMarcacoes(fila);
      setErro(fila.length > 0 ? "Sem ligação. A mostrar só os pontos ainda por sincronizar." : "Não foi possível carregar a folha de ponto.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarMarcacoes();
    const ouvir = () => void carregarMarcacoes();
    window.addEventListener(EVENTO_FILA_PONTO, ouvir);
    return () => window.removeEventListener(EVENTO_FILA_PONTO, ouvir);
  }, [funcionario?.nome, anoMes]);

  const turnos = useMemo(() => montarTurnos(marcacoes, jornadaBase), [marcacoes, jornadaBase]);
  const totalHoras = turnos.reduce((acc, t) => acc + t.horasArredondadas, 0);
  const totalExtras = turnos.reduce((acc, t) => acc + t.horasExtras, 0);
  const totalPagarExtras = totalExtras * valorHoraExtra;

  function persistirValorHe(valor: number) {
    setValorHoraExtra(valor);
    if (!funcionarioId) return;
    gravarValorHoraExtra(funcionarioId, valor);
    supabase.from("segurancas").update({ valor_hora_extra: valor }).eq("id", funcionarioId).then(() => undefined);
  }

  function imprimirFolha() {
    if (!funcionario) return;
    const [ano, mes] = anoMes.split("-");
    const competencia = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
    const linhas = turnos
      .map((t, i) => {
        const sitio = t.entrada.predio ? `${t.entrada.predio}${t.entrada.local ? ` — ${t.entrada.local}` : ""}` : "—";
        return `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${formatarData(t.entrada.created_at)}</td>
          <td>${formatarHora(t.entrada.created_at)}</td>
          <td>${t.saida ? formatarHora(t.saida.created_at) : "Em aberto"}</td>
          <td>${sitio}</td>
          <td style="text-align:center">${t.saida ? t.horasArredondadas : "—"}</td>
          <td style="text-align:center">${t.saida ? t.horasExtras : "—"}</td>
          <td style="text-align:right">${t.saida ? dinheiro(t.horasExtras * valorHoraExtra) : "—"}</td>
        </tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Folha de Ponto — ${funcionario.nome}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #1c1a17; margin: 28px; }
  .cabecalho { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1c1a17; padding-bottom: 12px; margin-bottom: 16px; }
  .cabecalho h1 { font-size: 22px; margin: 0; }
  .cabecalho p { margin: 4px 0 0; font-size: 13px; color: #5a544c; }
  .badge { background: #1c1a17; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: bold; text-align: right; }
  .resumo { display: flex; gap: 12px; margin-bottom: 16px; font-size: 13px; flex-wrap: wrap; }
  .resumo span { background: #f3eee5; padding: 6px 12px; border-radius: 8px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 18px; }
  th, td { border: 1px solid #d9d2c6; padding: 8px 10px; text-align: left; }
  th { background: #1c1a17; color: #fff; font-size: 11px; text-transform: uppercase; }
  tr:nth-child(even) td { background: #faf7f1; }
  .nota { font-size: 11px; color: #5a544c; }
  .rodape { margin-top: 18px; font-size: 11px; color: #7a736a; border-top: 1px solid #d9d2c6; padding-top: 10px; }
  @media print { body { margin: 14px; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="cabecalho">
    <div>
      <h1>Falcon Serviços — Folha de Ponto</h1>
      <p>${funcionario.nome} · ${funcionario.cargo} · ${funcionario.tipo_contrato || "CLT"}</p>
      <p>Competência: ${competencia}</p>
    </div>
    <div class="badge">Hora extra: ${dinheiro(valorHoraExtra)}</div>
  </div>
  <div class="resumo">
    <span>Turnos: ${turnos.length}</span>
    <span>Horas (arredondadas): ${totalHoras}h</span>
    <span>Horas extras: ${totalExtras}h</span>
    <span>Total HE: ${dinheiro(totalPagarExtras)}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px;text-align:center">#</th>
        <th>Data</th>
        <th>Entrada</th>
        <th>Saída</th>
        <th>Posto</th>
        <th style="text-align:center">Horas</th>
        <th style="text-align:center">Extras</th>
        <th style="text-align:right">Valor HE</th>
      </tr>
    </thead>
    <tbody>${linhas || `<tr><td colspan="8" style="text-align:center">Sem marcações neste mês.</td></tr>`}</tbody>
  </table>
  <p class="nota">Regra de tolerância: fracções abaixo de 30 minutos são desconsideradas; a partir de 30 minutos a hora é arredondada para cima. Jornada-base: ${jornadaBase}h.</p>
  <p class="rodape">Documento gerado em ${new Date().toLocaleString("pt-BR")} pelo aplicativo Falcon Serviços.</p>
  <div class="no-print" style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="padding:10px 24px;font-size:14px;font-weight:700;background:#1c1a17;color:#fff;border:none;border-radius:8px;cursor:pointer">Imprimir / Salvar PDF</button>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const janela = window.open(url, "_blank");
    if (!janela) window.alert("Permita os pop-ups no navegador para imprimir a folha de ponto.");
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-amber-500/30 shadow-xl sm:p-6">
        <h3 className="font-display text-[16px] font-bold text-amber-400 sm:text-[18px]">🕒 Folha de Ponto</h3>
        <p className="mt-1 text-[13px] text-zinc-400 sm:text-[14px]">
          Entrada e saída com selfie obrigatória e QR do posto. Funciona offline: a hora original é guardada e sincronizada depois. Tolerância de 30 minutos para PJ.
        </p>
      </div>

      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-4 sm:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-[12px] font-semibold text-zinc-400">
            Funcionário
            <select
              value={funcionarioId}
              onChange={(e) => setFuncionarioId(e.target.value)}
              className="mt-1 w-full rounded-xl bg-zinc-950 p-3 text-[14px] font-medium text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
            >
              {colaboradores.length === 0 ? (
                <option value="">Nenhum colaborador ativo</option>
              ) : (
                colaboradores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.tipo_contrato || "CLT"})
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block text-[12px] font-semibold text-zinc-400">
            Competência
            <input
              type="month"
              value={anoMes}
              onChange={(e) => setAnoMes(e.target.value)}
              className="mt-1 w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
          <label className="block text-[12px] font-semibold text-zinc-400">
            Jornada-base (h)
            <input
              type="number"
              min={1}
              max={24}
              value={jornadaBase}
              onChange={(e) => setJornadaBase(Number(e.target.value) || JORNADA_BASE_PADRAO)}
              className="mt-1 w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
          <label className="block text-[12px] font-semibold text-zinc-400">
            Valor da hora extra (R$)
            <input
              type="number"
              min={0}
              step="0.01"
              value={valorHoraExtra}
              onChange={(e) => persistirValorHe(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={imprimirFolha}
            disabled={!funcionario}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-100 ring-1 ring-zinc-700 disabled:opacity-50"
          >
            Imprimir / Exportar mês
          </button>
        </div>
        {funcionario && <BaterPontoPanel seguranca={funcionario.nome} onRegistado={() => void carregarMarcacoes()} />}
        {erro && <p className="text-[13px] font-medium text-red-400">{erro}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResumoPonto rotulo="Turnos" valor={String(turnos.length)} />
        <ResumoPonto rotulo="Horas (30 min)" valor={`${totalHoras}h`} />
        <ResumoPonto rotulo="Horas extras" valor={`${totalExtras}h`} />
        <ResumoPonto rotulo="Total HE" valor={dinheiro(totalPagarExtras)} destaque />
      </div>

      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl sm:p-6">
        {carregando ? (
          <p className="text-center text-[13px] text-zinc-500 py-6">A carregar marcações...</p>
        ) : turnos.length === 0 ? (
          <p className="text-center text-[13px] text-zinc-500 py-6">
            {marcacoes.some((m) => m.pendente)
              ? "O ponto pendente está na fila acima. O turno completo aparece quando a entrada e a saída estiverem ambas disponíveis."
              : "Sem entradas ou saídas neste mês."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="pb-2 pr-3">Data</th>
                  <th className="pb-2 pr-3">Entrada</th>
                  <th className="pb-2 pr-3">Saída</th>
                  <th className="pb-2 pr-3">Selfie</th>
                  <th className="pb-2 pr-3">Posto</th>
                  <th className="pb-2 pr-3 text-center">Horas</th>
                  <th className="pb-2 pr-3 text-center">Extras</th>
                  <th className="pb-2 text-right">Valor HE</th>
                </tr>
              </thead>
              <tbody>
                {turnos.map((t) => (
                  <tr key={t.entrada.id} className="border-t border-zinc-800 text-zinc-200">
                    <td className="py-2.5 pr-3 whitespace-nowrap">{formatarData(t.entrada.created_at)}</td>
                    <td className="py-2.5 pr-3 font-mono text-emerald-400">
                      {formatarHora(t.entrada.created_at)}
                      {t.entrada.pendente && <span className="ml-1 text-[10px] font-bold uppercase text-amber-400">pendente</span>}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-amber-400">
                      {t.saida ? formatarHora(t.saida.created_at) : "Aberto"}
                      {t.saida?.pendente && <span className="ml-1 text-[10px] font-bold uppercase text-amber-400">pendente</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex gap-1">
                        <MiniSelfie url={t.entrada.foto_url} rotulo="Entrada" />
                        <MiniSelfie url={t.saida?.foto_url} rotulo="Saída" />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-zinc-400">{t.entrada.predio || "—"}</td>
                    <td className="py-2.5 pr-3 text-center">{t.saida ? `${t.horasArredondadas}h` : "—"}</td>
                    <td className="py-2.5 pr-3 text-center">{t.saida ? `${t.horasExtras}h` : "—"}</td>
                    <td className="py-2.5 text-right text-amber-300">
                      {t.saida ? dinheiro(t.horasExtras * valorHoraExtra) : "—"}
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

function MiniSelfie({ url, rotulo }: { url?: string | null; rotulo: string }) {
  if (!url) return <span className="text-[10px] text-zinc-600">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={`Selfie de ${rotulo}`}>
      <img src={url} alt={`Selfie de ${rotulo}`} className="size-9 rounded-full object-cover ring-1 ring-zinc-700" />
    </a>
  );
}

function ResumoPonto({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{rotulo}</p>
      <p className={`mt-1 font-display text-[22px] font-bold ${destaque ? "text-amber-400" : "text-zinc-100"}`}>{valor}</p>
    </div>
  );
}
