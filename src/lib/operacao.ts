import { montarTurnos, tipoPontoDaDescricao, type MarcacaoPonto } from "@/lib/folha-ponto";
import { supabase } from "@/integrations/supabase/client";

export type TurnoEscala = "DIURNO" | "NOTURNO";
export type StatusEscala = "PREVISTO" | "NO_POSTO" | "SAIU" | "FALTA";
export type StatusAjuste = "PENDENTE" | "APROVADO" | "RECUSADO";
export type TipoPontoAjuste = "ENTRADA" | "SAIDA";

export const JUSTIFICATIVAS_ESCALA = ["Atestado", "Falta", "Férias", "Cobertura", "Troca de turno", "Outro"] as const;

export interface Escala {
  id: string;
  data: string;
  turno: TurnoEscala;
  hora_entrada: string;
  hora_saida: string;
  predio: string;
  local?: string | null;
  seguranca: string;
  cobertura?: boolean;
  justificativa?: string | null;
  created_at?: string;
  created_by?: string | null;
}

export interface SolicitacaoAjuste {
  id: string;
  seguranca: string;
  data: string;
  horario_pretendido: string;
  tipo: TipoPontoAjuste;
  justificativa: string;
  status: StatusAjuste;
  motivo_recusa?: string | null;
  decidido_por?: string | null;
  decidido_em?: string | null;
  marcacao_original_id?: string | null;
  marcacao_ajuste_id?: string | null;
  predio?: string | null;
  created_at: string;
}

export interface LinhaEscalaRealtime extends Escala {
  status: StatusEscala;
  entradaReal?: string | null;
  saidaReal?: string | null;
}

export const HORARIOS_TURNO: Record<TurnoEscala, { entrada: string; saida: string; label: string }> = {
  DIURNO: { entrada: "07:00", saida: "19:00", label: "Diurno (07h–19h)" },
  NOTURNO: { entrada: "19:00", saida: "07:00", label: "Noturno (19h–07h)" },
};

const CHAVE_ESCALAS = "falcon_escalas";
const CHAVE_META_ESCALA = "falcon_escalas_meta";
const CHAVE_AJUSTES = "falcon_ajustes_ponto";

export function textoObservacaoEscala(escala: Pick<Escala, "cobertura" | "justificativa">): string {
  const partes: string[] = [];
  if (escala.cobertura) partes.push("Cobertura");
  if (escala.justificativa) partes.push(escala.justificativa);
  return partes.join(" · ");
}

export function hojeISO(data = new Date()): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

export function turnoAtivoAgora(agora = new Date()): TurnoEscala {
  const hora = agora.getHours();
  return hora >= 7 && hora < 19 ? "DIURNO" : "NOTURNO";
}

export function janelaEscala(escala: Pick<Escala, "data" | "hora_entrada" | "hora_saida">): { inicio: Date; fim: Date } {
  const [ano, mes, dia] = escala.data.split("-").map(Number);
  const [eh, em] = (escala.hora_entrada || "07:00").split(":").map(Number);
  const [sh, sm] = (escala.hora_saida || "19:00").split(":").map(Number);
  const inicio = new Date(ano, mes - 1, dia, eh, em, 0);
  let fim = new Date(ano, mes - 1, dia, sh, sm, 0);
  if (fim <= inicio) fim = new Date(fim.getTime() + 24 * 60 * 60 * 1000);
  return { inicio, fim };
}

export function turnoEmAndamento(escala: Pick<Escala, "data" | "hora_entrada" | "hora_saida">, agora = new Date()): boolean {
  const { inicio, fim } = janelaEscala(escala);
  return agora >= inicio && agora <= fim;
}

export function classificarEscala(escala: Escala, marcacoes: MarcacaoPonto[], agora = new Date()): LinhaEscalaRealtime {
  const { inicio, fim } = janelaEscala(escala);
  const folga = 3 * 60 * 60 * 1000;
  const doPeriodo = marcacoes.filter((m) => {
    if (m.seguranca !== escala.seguranca) return false;
    const t = new Date(m.created_at).getTime();
    return t >= inicio.getTime() - folga && t <= fim.getTime() + folga;
  });
  const turnos = montarTurnos(doPeriodo);
  const aberto = turnos.find((t) => !t.saida);
  const fechado = [...turnos].reverse().find((t) => t.saida);

  if (aberto) {
    return { ...escala, status: "NO_POSTO", entradaReal: aberto.entrada.created_at, saidaReal: null };
  }
  if (fechado?.saida) {
    return { ...escala, status: "SAIU", entradaReal: fechado.entrada.created_at, saidaReal: fechado.saida.created_at };
  }
  if (agora < inicio) {
    return { ...escala, status: "PREVISTO", entradaReal: null, saidaReal: null };
  }
  return { ...escala, status: "FALTA", entradaReal: null, saidaReal: null };
}

export function postosSemCobertura(linhas: LinhaEscalaRealtime[], agora = new Date()): string[] {
  const porPosto = new Map<string, LinhaEscalaRealtime[]>();
  for (const linha of linhas) {
    const lista = porPosto.get(linha.predio) ?? [];
    lista.push(linha);
    porPosto.set(linha.predio, lista);
  }
  const descobertos: string[] = [];
  for (const [predio, grupo] of porPosto) {
    const noPeriodo = grupo.filter((l) => turnoEmAndamento(l, agora) || l.status === "FALTA" || l.status === "NO_POSTO");
    if (noPeriodo.length === 0) continue;
    const coberto = noPeriodo.some((l) => l.status === "NO_POSTO");
    if (!coberto) descobertos.push(predio);
  }
  return descobertos.sort();
}

function tabelaEmFalta(error: { message?: string; code?: string } | null): boolean {
  const texto = `${error?.message ?? ""} ${error?.code ?? ""}`.toLowerCase();
  return texto.includes("does not exist") || texto.includes("pgrst205") || texto.includes("42p01") || texto.includes("schema cache");
}

function novoId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function lerLocal<T>(chave: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(chave) || "[]") as T[];
  } catch {
    return [];
  }
}

function gravarLocal<T>(chave: string, itens: T[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(chave, JSON.stringify(itens));
}

function lerMeta(): Record<string, Pick<Escala, "cobertura" | "justificativa">> {
  return Object.fromEntries(
    lerLocal<{ id: string; cobertura?: boolean; justificativa?: string | null }>(CHAVE_META_ESCALA).map((m) => [
      m.id,
      { cobertura: !!m.cobertura, justificativa: m.justificativa ?? null },
    ]),
  );
}

function gravarMeta(id: string, escala: Pick<Escala, "cobertura" | "justificativa">) {
  const lista = lerLocal<{ id: string; cobertura?: boolean; justificativa?: string | null }>(CHAVE_META_ESCALA).filter(
    (m) => m.id !== id,
  );
  lista.push({ id, cobertura: !!escala.cobertura, justificativa: escala.justificativa ?? null });
  gravarLocal(CHAVE_META_ESCALA, lista);
}

function aplicarMeta(itens: Escala[]): Escala[] {
  const meta = lerMeta();
  return itens.map((e) => {
    const extra = meta[e.id];
    if (!extra) return e;
    return {
      ...e,
      cobertura: e.cobertura ?? extra.cobertura ?? false,
      justificativa: e.justificativa ?? extra.justificativa ?? null,
    };
  });
}

export async function listarEscalas(data?: string): Promise<{ itens: Escala[]; origem: "supabase" | "local" }> {
  try {
    let query = supabase.from("escalas").select("*").order("data", { ascending: true });
    if (data) query = query.eq("data", data);
    const { data: rows, error } = await query;
    if (error) throw error;
    return { itens: aplicarMeta((rows || []) as Escala[]), origem: "supabase" };
  } catch (err: any) {
    if (!tabelaEmFalta(err) && err?.code !== "PGRST116") {
      /* tabela existe mas falhou — ainda assim tenta o cache local */
    }
    const local = aplicarMeta(lerLocal<Escala>(CHAVE_ESCALAS));
    return { itens: data ? local.filter((e) => e.data === data) : local, origem: "local" };
  }
}

export async function listarEscalasIntervalo(inicio: string, fim: string): Promise<{ itens: Escala[]; origem: "supabase" | "local" }> {
  try {
    const { data: rows, error } = await supabase
      .from("escalas")
      .select("*")
      .gte("data", inicio)
      .lte("data", fim)
      .order("data", { ascending: true });
    if (error) throw error;
    return { itens: aplicarMeta((rows || []) as Escala[]), origem: "supabase" };
  } catch {
    const local = aplicarMeta(lerLocal<Escala>(CHAVE_ESCALAS)).filter((e) => e.data >= inicio && e.data <= fim);
    return { itens: local, origem: "local" };
  }
}

function payloadRemoto(escala: Partial<Escala>) {
  const { cobertura: _c, justificativa: _j, ...resto } = escala;
  return { ...resto, cobertura: escala.cobertura ?? false, justificativa: escala.justificativa ?? null };
}

export async function guardarEscala(escala: Omit<Escala, "id" | "created_at">): Promise<Escala> {
  const payload = { ...escala, id: novoId(), created_at: new Date().toISOString() };
  const { data, error } = await supabase.from("escalas").insert([payloadRemoto(escala)]).select("*").single();
  if (!error && data) {
    const gravada = { ...(data as Escala), cobertura: escala.cobertura, justificativa: escala.justificativa ?? null };
    gravarMeta(gravada.id, gravada);
    return gravada;
  }
  if (error && !tabelaEmFalta(error)) {
    const semExtra = { ...payloadRemoto(escala) };
    delete (semExtra as { cobertura?: boolean }).cobertura;
    delete (semExtra as { justificativa?: string | null }).justificativa;
    const retry = await supabase.from("escalas").insert([semExtra]).select("*").single();
    if (!retry.error && retry.data) {
      const gravada = { ...(retry.data as Escala), cobertura: escala.cobertura, justificativa: escala.justificativa ?? null };
      gravarMeta(gravada.id, gravada);
      return gravada;
    }
  }
  const lista = lerLocal<Escala>(CHAVE_ESCALAS);
  lista.push(payload);
  gravarLocal(CHAVE_ESCALAS, lista);
  gravarMeta(payload.id, payload);
  return payload;
}

export async function atualizarEscala(id: string, escala: Omit<Escala, "id" | "created_at">): Promise<Escala> {
  const patch = payloadRemoto(escala);
  const { data, error } = await supabase.from("escalas").update(patch).eq("id", id).select("*").single();
  if (!error && data) {
    const gravada = { ...(data as Escala), cobertura: escala.cobertura, justificativa: escala.justificativa ?? null };
    gravarMeta(id, gravada);
    const lista = lerLocal<Escala>(CHAVE_ESCALAS).map((e) => (e.id === id ? { ...e, ...gravada } : e));
    gravarLocal(CHAVE_ESCALAS, lista);
    return gravada;
  }
  const lista = lerLocal<Escala>(CHAVE_ESCALAS);
  const idx = lista.findIndex((e) => e.id === id);
  const atual: Escala = { ...(idx >= 0 ? lista[idx] : { id }), ...escala, id };
  if (idx >= 0) lista[idx] = atual;
  else lista.push(atual);
  gravarLocal(CHAVE_ESCALAS, lista);
  gravarMeta(id, atual);
  if (error && !tabelaEmFalta(error) && idx < 0) throw error;
  return atual;
}

export async function excluirEscala(id: string): Promise<void> {
  const { error } = await supabase.from("escalas").delete().eq("id", id);
  const lista = lerLocal<Escala>(CHAVE_ESCALAS).filter((e) => e.id !== id);
  gravarLocal(CHAVE_ESCALAS, lista);
  gravarLocal(
    CHAVE_META_ESCALA,
    lerLocal<{ id: string }>(CHAVE_META_ESCALA).filter((m) => m.id !== id),
  );
  if (error && !tabelaEmFalta(error)) throw error;
}

export async function listarAjustes(seguranca?: string): Promise<{ itens: SolicitacaoAjuste[]; origem: "supabase" | "local" }> {
  try {
    let query = supabase.from("solicitacoes_ajuste_ponto").select("*").order("created_at", { ascending: false });
    if (seguranca) query = query.eq("seguranca", seguranca);
    const { data, error } = await query;
    if (error) throw error;
    return { itens: (data || []) as SolicitacaoAjuste[], origem: "supabase" };
  } catch {
    const local = lerLocal<SolicitacaoAjuste>(CHAVE_AJUSTES);
    return { itens: seguranca ? local.filter((a) => a.seguranca === seguranca) : local, origem: "local" };
  }
}

export async function criarAjuste(
  pedido: Omit<SolicitacaoAjuste, "id" | "status" | "created_at">,
): Promise<SolicitacaoAjuste> {
  const payload: SolicitacaoAjuste = {
    ...pedido,
    id: novoId(),
    status: "PENDENTE",
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("solicitacoes_ajuste_ponto").insert([payload]).select("*").single();
  if (!error && data) return data as SolicitacaoAjuste;
  const lista = lerLocal<SolicitacaoAjuste>(CHAVE_AJUSTES);
  lista.unshift(payload);
  gravarLocal(CHAVE_AJUSTES, lista);
  return payload;
}

export async function decidirAjuste(
  id: string,
  decisao: { status: "APROVADO" | "RECUSADO"; decidido_por: string; motivo_recusa?: string; marcacao_ajuste_id?: string; marcacao_original_id?: string },
): Promise<SolicitacaoAjuste> {
  const patch = {
    status: decisao.status,
    decidido_por: decisao.decidido_por,
    decidido_em: new Date().toISOString(),
    motivo_recusa: decisao.motivo_recusa ?? null,
    marcacao_ajuste_id: decisao.marcacao_ajuste_id ?? null,
    marcacao_original_id: decisao.marcacao_original_id ?? null,
  };
  const { data, error } = await supabase.from("solicitacoes_ajuste_ponto").update(patch).eq("id", id).select("*").single();
  if (!error && data) return data as SolicitacaoAjuste;

  const lista = lerLocal<SolicitacaoAjuste>(CHAVE_AJUSTES);
  const idx = lista.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error("Solicitação não encontrada.");
  lista[idx] = { ...lista[idx], ...patch };
  gravarLocal(CHAVE_AJUSTES, lista);
  return lista[idx];
}

export function descricaoPontoAjuste(
  tipo: TipoPontoAjuste,
  predio: string,
  local: string,
  solicitacaoId: string,
  aprovador: string,
): string {
  const marca = tipo === "ENTRADA" ? "⏱️ PONTO ENTRADA" : "⏱️ PONTO SAÍDA";
  return `${marca} em ${predio} — ${local} · AJUSTE APROVADO (${solicitacaoId.slice(0, 8)}) por ${aprovador} — original preservado`;
}

export function encontrarMarcacaoOriginal(
  marcacoes: MarcacaoPonto[],
  pedido: Pick<SolicitacaoAjuste, "seguranca" | "data" | "tipo">,
): MarcacaoPonto | undefined {
  return marcacoes.find((m) => {
    if (m.seguranca !== pedido.seguranca || m.tipo !== pedido.tipo) return false;
    return m.created_at.slice(0, 10) === pedido.data || hojeISO(new Date(m.created_at)) === pedido.data;
  });
}

export function isoDoPedido(data: string, horario: string): string {
  return new Date(`${data}T${horario}:00`).toISOString();
}

