import { useEffect, useMemo, useState, type FormEvent } from "react";
import { tipoPontoDaDescricao, type MarcacaoPonto } from "@/lib/folha-ponto";
import {
  criarAjuste,
  decidirAjuste,
  descricaoPontoAjuste,
  encontrarMarcacaoOriginal,
  hojeISO,
  isoDoPedido,
  listarAjustes,
  listarEscalas,
  type Escala,
  type SolicitacaoAjuste,
  type TipoPontoAjuste,
} from "@/lib/operacao";
import { listarRegistros } from "@/lib/rondas";
import { supabase } from "@/integrations/supabase/client";

export function AjustesPontoTab({ seguranca, admin }: { seguranca: string; admin: boolean }) {
  const [pedidos, setPedidos] = useState<SolicitacaoAjuste[]>([]);
  const [escalas, setEscalas] = useState<Escala[]>([]);
  const [marcacoes, setMarcacoes] = useState<MarcacaoPonto[]>([]);
  const [origem, setOrigem] = useState<"supabase" | "local">("supabase");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  const [data, setData] = useState(hojeISO);
  const [horario, setHorario] = useState("07:00");
  const [tipo, setTipo] = useState<TipoPontoAjuste>("ENTRADA");
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const [{ itens, origem: src }, regs, esc] = await Promise.all([
        listarAjustes(admin ? undefined : seguranca),
        listarRegistros(800, { dataInicial: data, dataFinal: data }),
        listarEscalas(data),
      ]);
      setPedidos(itens);
      setOrigem(src);
      setEscalas(esc.itens);
      setMarcacoes(
        regs
          .map((r) => {
            const t = tipoPontoDaDescricao(r.descricao);
            if (!t) return null;
            return {
              id: r.id,
              seguranca: r.seguranca,
              tipo: t,
              created_at: r.created_at,
              predio: r.locais_ronda?.predio,
              local: r.locais_ronda?.local,
            };
          })
          .filter((m): m is MarcacaoPonto => !!m),
      );
    } catch {
      setErro("Não foi possível carregar os pedidos de ajuste.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [admin, seguranca, data]);

  const pendentes = pedidos.filter((p) => p.status === "PENDENTE");
  const meus = pedidos.filter((p) => p.seguranca === seguranca);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (justificativa.trim().length < 8) {
      setErro("Descreva a justificativa com pelo menos 8 caracteres.");
      return;
    }
    setEnviando(true);
    setErro("");
    setOk("");
    try {
      const original = encontrarMarcacaoOriginal(marcacoes, { seguranca, data, tipo });
      await criarAjuste({
        seguranca,
        data,
        horario_pretendido: horario,
        tipo,
        justificativa: justificativa.trim(),
        marcacao_original_id: original?.id ?? null,
        predio: original?.predio ?? null,
      });
      setJustificativa("");
      setOk("Pedido enviado. O Admin/Supervisor vai analisar e a marcação original não será apagada.");
      await carregar();
    } catch (err: any) {
      setErro(err?.message || "Não foi possível enviar o pedido.");
    } finally {
      setEnviando(false);
    }
  }

  async function recusar(pedido: SolicitacaoAjuste) {
    const motivo = window.prompt("Motivo da recusa (obrigatório):")?.trim();
    if (!motivo) return;
    await decidirAjuste(pedido.id, { status: "RECUSADO", decidido_por: seguranca, motivo_recusa: motivo });
    await carregar();
  }

  async function aprovar(pedido: SolicitacaoAjuste) {
    if (!window.confirm("Aprovar este ajuste? A marcação original fica no histórico; será criado um novo ponto de auditoria.")) {
      return;
    }
    const original = encontrarMarcacaoOriginal(marcacoes, pedido);
    let localId: string | null = null;
    let predio = pedido.predio || original?.predio || "Ajuste administrativo";
    let localNome = original?.local || "Folha de ponto";

    const { data: locais } = await supabase.from("locais_ronda").select("id, predio, local").limit(20);
    const doPosto = (locais || []).find((l) => l.predio === predio) || (locais || [])[0];
    if (doPosto) {
      localId = doPosto.id;
      predio = doPosto.predio;
      localNome = doPosto.local;
    }
    if (!localId) {
      window.alert("Cadastre um local de ronda para gravar o ponto aprovado.");
      return;
    }

    const { data: inserido, error } = await supabase
      .from("registros_rondas")
      .insert([
        {
          local_id: localId,
          seguranca: pedido.seguranca,
          status: "OK",
          gravidade: "MODERADA",
          descricao: descricaoPontoAjuste(pedido.tipo, predio, localNome, pedido.id, seguranca),
          created_at: isoDoPedido(pedido.data, pedido.horario_pretendido),
        },
      ])
      .select("id")
      .single();

    if (error) {
      window.alert(error.message || "Não foi possível gravar o ponto aprovado.");
      return;
    }

    await decidirAjuste(pedido.id, {
      status: "APROVADO",
      decidido_por: seguranca,
      marcacao_ajuste_id: inserido?.id,
      marcacao_original_id: original?.id ?? pedido.marcacao_original_id ?? undefined,
    });
    await carregar();
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-amber-500/30 shadow-xl sm:p-6">
        <h3 className="font-display text-[16px] font-bold text-amber-400 sm:text-[18px]">✍️ Ajustes de Ponto</h3>
        <p className="mt-1 text-[13px] text-zinc-400">
          {admin
            ? "Analise pedidos pendentes, cruze com a escala e decida. A aprovação cria um novo registo e mantém o original."
            : "Peça correção de entrada ou saída. O pedido fica pendente até o Admin ou Supervisor decidir."}
        </p>
        {origem === "local" && (
          <p className="mt-2 text-[12px] text-amber-300">
            A tabela de solicitações ainda não existe no Supabase. Os pedidos ficam neste browser até correr a migration da Fase 2.
          </p>
        )}
      </div>

      <form onSubmit={enviar} className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-6">
        <p className="text-[13px] font-semibold text-zinc-200">Nova solicitação — {seguranca}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-[12px] font-semibold text-zinc-400">
            Data
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
          </label>
          <label className="text-[12px] font-semibold text-zinc-400">
            Horário pretendido
            <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} className={inputCls} />
          </label>
          <label className="text-[12px] font-semibold text-zinc-400">
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoPontoAjuste)} className={inputCls}>
              <option value="ENTRADA">Entrada</option>
              <option value="SAIDA">Saída</option>
            </select>
          </label>
        </div>
        <textarea
          rows={3}
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder="Justificativa (esqueci de bater o ponto, QR falhou, cobertura, etc.)"
          className={inputCls}
        />
        {erro && <p className="text-[13px] text-red-400">{erro}</p>}
        {ok && <p className="text-[13px] text-emerald-400">{ok}</p>}
        <button disabled={enviando} className="rounded-xl bg-amber-500 px-4 py-2.5 text-[13px] font-bold text-zinc-950 disabled:opacity-50">
          {enviando ? "A enviar..." : "Enviar pedido"}
        </button>
      </form>

      {admin && (
        <PainelAnalise
          pedidos={pendentes}
          escalas={escalas}
          marcacoes={marcacoes}
          carregando={carregando}
          onAprovar={aprovar}
          onRecusar={recusar}
        />
      )}

      <ListaPedidos titulo={admin ? "Histórico e trilha de auditoria" : "Os seus pedidos"} pedidos={admin ? pedidos : meus} />
    </div>
  );
}

function PainelAnalise({
  pedidos,
  escalas,
  marcacoes,
  carregando,
  onAprovar,
  onRecusar,
}: {
  pedidos: SolicitacaoAjuste[];
  escalas: Escala[];
  marcacoes: MarcacaoPonto[];
  carregando: boolean;
  onAprovar: (p: SolicitacaoAjuste) => void;
  onRecusar: (p: SolicitacaoAjuste) => void;
}) {
  return (
    <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl space-y-3 sm:p-6">
      <p className="text-[13px] font-semibold text-zinc-200">Pendentes para análise ({pedidos.length})</p>
      {carregando ? (
        <p className="text-[13px] text-zinc-500">A carregar...</p>
      ) : pedidos.length === 0 ? (
        <p className="text-[13px] text-zinc-500">Não há pedidos pendentes.</p>
      ) : (
        <div className="space-y-3">
          {pedidos.map((p) => {
            const escala = escalas.find((e) => e.seguranca === p.seguranca);
            const pontos = marcacoes.filter((m) => m.seguranca === p.seguranca);
            return (
              <div key={p.id} className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-zinc-100">{p.seguranca}</p>
                    <p className="text-[12px] text-amber-400">
                      {p.tipo} pretendida em {p.data} às {p.horario_pretendido}
                    </p>
                  </div>
                  <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300 ring-1 ring-amber-500/30">
                    PENDENTE
                  </span>
                </div>
                <p className="text-[13px] text-zinc-300">{p.justificativa}</p>
                <p className="text-[12px] text-zinc-500">
                  Escala do dia: {escala ? `${escala.predio} · ${escala.hora_entrada}–${escala.hora_saida}` : "sem escala lançada"}
                  {" · "}
                  Pontos já existentes:{" "}
                  {pontos.length === 0
                    ? "nenhum"
                    : pontos.map((m) => `${m.tipo} ${new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`).join(", ")}
                </p>
                {p.marcacao_original_id && (
                  <p className="text-[11px] text-zinc-500">Marcação original a preservar: {p.marcacao_original_id.slice(0, 8)}</p>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => onAprovar(p)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white">
                    Aprovar
                  </button>
                  <button type="button" onClick={() => onRecusar(p)} className="rounded-lg bg-red-950 px-3 py-1.5 text-[12px] font-semibold text-red-300 ring-1 ring-red-500/30">
                    Recusar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListaPedidos({ titulo, pedidos }: { titulo: string; pedidos: SolicitacaoAjuste[] }) {
  const ordenados = useMemo(
    () => [...pedidos].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [pedidos],
  );
  return (
    <div className="rounded-[18px] bg-zinc-900 p-4 ring-1 ring-zinc-800 shadow-xl sm:p-6">
      <p className="text-[13px] font-semibold text-zinc-200 mb-3">{titulo}</p>
      {ordenados.length === 0 ? (
        <p className="text-[13px] text-zinc-500">Ainda não há solicitações.</p>
      ) : (
        <div className="space-y-2.5">
          {ordenados.map((p) => (
            <div key={p.id} className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800 text-[13px]">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-zinc-100">
                  {p.seguranca} · {p.tipo} {p.data} {p.horario_pretendido}
                </p>
                <span
                  className={
                    p.status === "APROVADO"
                      ? "text-emerald-400 font-bold"
                      : p.status === "RECUSADO"
                        ? "text-red-400 font-bold"
                        : "text-amber-400 font-bold"
                  }
                >
                  {p.status}
                </span>
              </div>
              <p className="mt-1 text-zinc-400">{p.justificativa}</p>
              {p.status !== "PENDENTE" && (
                <p className="mt-1 text-[12px] text-zinc-500">
                  Decisão de {p.decidido_por || "—"} em {p.decidido_em ? new Date(p.decidido_em).toLocaleString("pt-BR") : "—"}
                  {p.motivo_recusa ? ` · Motivo: ${p.motivo_recusa}` : ""}
                  {p.marcacao_ajuste_id ? ` · Novo ponto: ${p.marcacao_ajuste_id.slice(0, 8)}` : ""}
                  {p.marcacao_original_id ? ` · Original: ${p.marcacao_original_id.slice(0, 8)}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-xl bg-zinc-950 p-3 text-[14px] text-zinc-100 ring-1 ring-zinc-700 outline-none focus:ring-2 focus:ring-amber-500";
