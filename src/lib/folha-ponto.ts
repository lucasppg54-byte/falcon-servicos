export const MARCA_PONTO_ENTRADA = "⏱️ PONTO ENTRADA";
export const MARCA_PONTO_SAIDA = "⏱️ PONTO SAÍDA";
export const JORNADA_BASE_PADRAO = 12;
export const TOLERANCIA_MINUTOS = 30;
export const CHAVE_VALOR_HE = "folha_ponto_valor_he";

export type TipoPonto = "ENTRADA" | "SAIDA";

export interface MarcacaoPonto {
  id: string;
  seguranca: string;
  tipo: TipoPonto;
  created_at: string;
  predio?: string | null;
  local?: string | null;
  foto_url?: string | null;
  pendente?: boolean;
}

export interface TurnoPonto {
  entrada: MarcacaoPonto;
  saida: MarcacaoPonto | null;
  minutosBrutos: number;
  horasArredondadas: number;
  horasExtras: number;
}

function semAcento(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** QR da portaria/ponto. Um local de ronda não entra nesta marca. */
export function ehQrDePonto(local: { local?: string | null; qr_code_hash?: string | null }): boolean {
  const tokens = semAcento(`${local.local ?? ""} ${local.qr_code_hash ?? ""}`)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => token === "portaria" || token === "ponto");
}

export function ehMarcacaoPonto(descricao: string | null | undefined): boolean {
  if (!descricao) return false;
  return descricao.includes("PONTO ENTRADA") || descricao.includes("PONTO SAÍDA") || descricao.includes("PONTO SAIDA");
}

export function tipoPontoDaDescricao(descricao: string | null | undefined): TipoPonto | null {
  if (!descricao) return null;
  if (descricao.includes("PONTO ENTRADA") || descricao.includes("NOVO PLANTÃO")) return "ENTRADA";
  if (descricao.includes("PONTO SAÍDA") || descricao.includes("PONTO SAIDA") || descricao.includes("PLANTÃO FINALIZADO")) {
    return "SAIDA";
  }
  return null;
}

export function descricaoPonto(tipo: TipoPonto, predio: string, local: string): string {
  const sitio = `${predio} — ${local}`;
  return tipo === "ENTRADA" ? `${MARCA_PONTO_ENTRADA} em ${sitio}` : `${MARCA_PONTO_SAIDA} em ${sitio}`;
}

export function descricaoPontoComInstante(tipo: TipoPonto, predio: string, local: string, createdAt: string): string {
  return `${descricaoPonto(tipo, predio, local)} · selfie ${createdAt}`;
}

/**
 * Tolerância de 30 min: fracção &lt; 30 desce à hora cheia;
 * fracção ≥ 30 sobe 1 hora (atrasos/extras pequenos não contam).
 */
export function arredondarHoras(minutos: number): number {
  if (!Number.isFinite(minutos) || minutos <= 0) return 0;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto < TOLERANCIA_MINUTOS ? horas : horas + 1;
}

export function fundirMarcacoes(remoto: MarcacaoPonto[], pendentes: MarcacaoPonto[]): MarcacaoPonto[] {
  const ids = new Set(remoto.map((r) => r.id));
  const instantes = new Set(remoto.map((r) => `${r.seguranca}|${r.tipo}|${r.created_at}`));
  const extra = pendentes.filter(
    (p) => !ids.has(p.id) && !instantes.has(`${p.seguranca}|${p.tipo}|${p.created_at}`),
  );
  return [...remoto, ...extra].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function proximoTipoPonto(marcacoes: MarcacaoPonto[]): TipoPonto {
  const ultima = [...marcacoes].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
  if (!ultima || ultima.tipo === "SAIDA") return "ENTRADA";
  return "SAIDA";
}

export function montarTurnos(marcacoes: MarcacaoPonto[], jornadaBase = JORNADA_BASE_PADRAO): TurnoPonto[] {
  const ordenadas = [...marcacoes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const turnos: TurnoPonto[] = [];
  let aberta: MarcacaoPonto | null = null;

  for (const marca of ordenadas) {
    if (marca.tipo === "ENTRADA") {
      if (aberta) {
        turnos.push(fecharTurno(aberta, null, jornadaBase));
      }
      aberta = marca;
      continue;
    }
    if (aberta) {
      turnos.push(fecharTurno(aberta, marca, jornadaBase));
      aberta = null;
    }
  }
  if (aberta) turnos.push(fecharTurno(aberta, null, jornadaBase));
  return turnos;
}

function fecharTurno(entrada: MarcacaoPonto, saida: MarcacaoPonto | null, jornadaBase: number): TurnoPonto {
  const minutosBrutos = saida
    ? Math.max(0, (new Date(saida.created_at).getTime() - new Date(entrada.created_at).getTime()) / 60000)
    : 0;
  const horasArredondadas = saida ? arredondarHoras(minutosBrutos) : 0;
  const horasExtras = saida ? Math.max(0, horasArredondadas - jornadaBase) : 0;
  return { entrada, saida, minutosBrutos, horasArredondadas, horasExtras };
}

export function lerValoresHoraExtra(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const bruto = localStorage.getItem(CHAVE_VALOR_HE);
    return bruto ? (JSON.parse(bruto) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function gravarValorHoraExtra(segurancaId: string, valor: number) {
  if (typeof window === "undefined") return;
  const atual = lerValoresHoraExtra();
  atual[segurancaId] = valor;
  localStorage.setItem(CHAVE_VALOR_HE, JSON.stringify(atual));
}

export function primeiroDiaMes(anoMes: string): string {
  return `${anoMes}-01`;
}

export function ultimoDiaMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const ultimo = new Date(ano, mes, 0).getDate();
  return `${anoMes}-${String(ultimo).padStart(2, "0")}`;
}

export function diasDoMes(anoMes: string): string[] {
  const [ano = 0, mes = 0] = anoMes.split("-").map(Number);
  if (!ano || !mes) return [];
  const ultimo = new Date(ano, mes, 0).getDate();
  return Array.from({ length: ultimo }, (_, i) => `${anoMes}-${String(i + 1).padStart(2, "0")}`);
}

export function isoNoDia(dia: string, hora: string): string {
  const [ano = 0, mes = 1, d = 1] = dia.split("-").map(Number);
  const [hh = 0, mm = 0] = hora.split(":").map(Number);
  return new Date(ano, mes - 1, d, hh, mm, 0).toISOString();
}

export function diaLocal(iso: string): string {
  const data = new Date(iso);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

export function horaCurtaLocal(iso: string): string {
  const data = new Date(iso);
  return `${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

/** Plantão PJ: um único registo conta 12h; o intervalo real segue a tolerância de 30 min. */
export function horasPlantaoArredondadas(temposMs: number[]): number {
  if (temposMs.length === 0) return 0;
  if (temposMs.length === 1) return arredondarHoras(JORNADA_BASE_PADRAO * 60);
  const minutos = (Math.max(...temposMs) - Math.min(...temposMs)) / 60000;
  if (minutos <= 0) return arredondarHoras(JORNADA_BASE_PADRAO * 60);
  return arredondarHoras(minutos);
}

export function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}
