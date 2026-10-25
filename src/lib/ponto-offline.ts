import { BUCKET_FOTOS, gerarCaminhoSelfiePonto } from "@/lib/fotos";
import { descricaoPontoComInstante, type TipoPonto } from "@/lib/folha-ponto";
import { buscarLocalPorQr, normalizarCodigoQr, normalizarNome, type LocalRonda } from "@/lib/rondas";
import { supabase } from "@/integrations/supabase/client";

const DB_NOME = "falcon-ponto-offline";
const STORE = "fila";
const CHAVE_LOCAIS = "falcon_cache_locais_ponto";
export const EVENTO_FILA_PONTO = "falcon-fila-ponto";

export interface PontoPendente {
  id: string;
  localId: string;
  seguranca: string;
  tipo: TipoPonto;
  descricao: string;
  created_at: string;
  predio: string;
  local: string;
  selfie: ArrayBuffer;
  selfieType: string;
  tentativas: number;
  ultimoErro?: string;
}

function avisarFila() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_FILA_PONTO));
}

export function estaOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível neste dispositivo."));
      return;
    }
    const req = indexedDB.open(DB_NOME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transacao<T>(modo: IDBTransactionMode, trabalho: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrirDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, modo);
        const store = tx.objectStore(STORE);
        const pedido = trabalho(store);
        pedido.onsuccess = () => resolve(pedido.result);
        pedido.onerror = () => reject(pedido.error);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function enfileirarPonto(item: PontoPendente): Promise<void> {
  await transacao("readwrite", (store) => store.put(item));
  avisarFila();
}

export async function listarPendentes(): Promise<PontoPendente[]> {
  try {
    const itens = await transacao<PontoPendente[]>("readonly", (store) => store.getAll());
    return (itens || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function removerPendente(id: string): Promise<void> {
  await transacao("readwrite", (store) => store.delete(id));
  avisarFila();
}

export function cachearLocais(locais: LocalRonda[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CHAVE_LOCAIS, JSON.stringify(locais));
}

export function lerCacheLocais(): LocalRonda[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CHAVE_LOCAIS) || "[]") as LocalRonda[];
  } catch {
    return [];
  }
}

export async function resolverLocalPonto(codigo: string): Promise<LocalRonda | null> {
  const limpo = normalizarCodigoQr(codigo);
  if (!limpo) return null;
  if (estaOnline()) {
    try {
      const local = await buscarLocalPorQr(limpo, null, true);
      if (local) {
        const cache = lerCacheLocais().filter((l) => l.id !== local.id);
        cachearLocais([...cache, { ...local }]);
        return local;
      }
    } catch {
      /* sem rede — usa cache */
    }
  }
  return lerCacheLocais().find((l) => normalizarCodigoQr(l.qr_code_hash) === limpo) ?? null;
}

export async function resolverLocalDoPosto(posto: string): Promise<LocalRonda | null> {
  await precacheLocaisPonto();
  const cache = lerCacheLocais();
  const alvo = normalizarNome(posto || "");
  if (alvo && alvo !== "geral") {
    const doPosto = cache.filter((l) => {
      const predio = normalizarNome(l.predio);
      return predio.includes(alvo) || alvo.includes(predio);
    });
    if (doPosto[0]) return doPosto[0];
  }
  return cache[0] ?? null;
}

export async function precacheLocaisPonto() {
  try {
    const { data } = await supabase.from("locais_ronda").select("id, qr_code_hash, predio, local");
    if (data?.length) cachearLocais(data as LocalRonda[]);
  } catch {
    /* ignora */
  }
}

function novoId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `pto-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function fileParaBuffer(file: File): Promise<{ buffer: ArrayBuffer; type: string }> {
  const buffer = await file.arrayBuffer();
  return { buffer, type: file.type || "image/jpeg" };
}

export function bufferParaFile(item: Pick<PontoPendente, "selfie" | "selfieType" | "seguranca" | "created_at">): File {
  const blob = new Blob([item.selfie], { type: item.selfieType || "image/jpeg" });
  return new File([blob], `selfie-${item.seguranca}-${item.created_at}.jpg`, { type: item.selfieType || "image/jpeg" });
}

export async function enviarSelfiePonto(file: File, seguranca: string, quando: Date): Promise<string> {
  const caminho = gerarCaminhoSelfiePonto(file, seguranca, quando);
  const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(caminho, file, {
    cacheControl: "3600",
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Falha ao guardar a selfie: ${error.message}`);
  return supabase.storage.from(BUCKET_FOTOS).getPublicUrl(caminho).data.publicUrl;
}

export async function gravarPontoOnline(item: {
  localId: string;
  seguranca: string;
  descricao: string;
  created_at: string;
  fotoUrl: string;
}): Promise<void> {
  const base = {
    local_id: item.localId,
    seguranca: item.seguranca,
    status: "OK",
    gravidade: "MODERADA",
    descricao: item.descricao,
    foto_url: item.fotoUrl,
  };
  const { error } = await supabase.from("registros_rondas").insert([{ ...base, created_at: item.created_at }]);
  if (!error) return;
  const { error: semCarimbo } = await supabase.from("registros_rondas").insert([base]);
  if (semCarimbo) throw error;
}

let sincronizando = false;

export async function sincronizarFilaPonto(): Promise<{ ok: number; falhas: number }> {
  if (!estaOnline() || sincronizando) return { ok: 0, falhas: 0 };
  sincronizando = true;
  try {
    const fila = await listarPendentes();
    let ok = 0;
    let falhas = 0;
    for (const item of fila) {
      try {
        const file = bufferParaFile(item);
        const fotoUrl = await enviarSelfiePonto(file, item.seguranca, new Date(item.created_at));
        await gravarPontoOnline({
          localId: item.localId,
          seguranca: item.seguranca,
          descricao: item.descricao,
          created_at: item.created_at,
          fotoUrl,
        });
        await removerPendente(item.id);
        ok += 1;
      } catch (err: any) {
        falhas += 1;
        await transacao("readwrite", (store) =>
          store.put({
            ...item,
            tentativas: item.tentativas + 1,
            ultimoErro: err?.message || "Falha ao sincronizar",
          }),
        );
      }
    }
    if (ok || falhas) avisarFila();
    return { ok, falhas };
  } finally {
    sincronizando = false;
  }
}

export async function registarPontoCampo(input: {
  local: LocalRonda;
  seguranca: string;
  tipo: TipoPonto;
  selfie: File;
}): Promise<{ modo: "online" | "offline"; created_at: string }> {
  if (!input.selfie || input.selfie.size < 800) {
    throw new Error("A selfie é obrigatória para bater o ponto.");
  }
  const created_at = new Date().toISOString();
  const descricao = descricaoPontoComInstante(input.tipo, input.local.predio, input.local.local, created_at);

  if (estaOnline()) {
    try {
      const fotoUrl = await enviarSelfiePonto(input.selfie, input.seguranca, new Date(created_at));
      await gravarPontoOnline({
        localId: input.local.id,
        seguranca: input.seguranca,
        descricao,
        created_at,
        fotoUrl,
      });
      return { modo: "online", created_at };
    } catch {
      /* cai para a fila e preserva o instante original */
    }
  }

  const { buffer, type } = await fileParaBuffer(input.selfie);
  await enfileirarPonto({
    id: novoId(),
    localId: input.local.id,
    seguranca: input.seguranca,
    tipo: input.tipo,
    descricao,
    created_at,
    predio: input.local.predio,
    local: input.local.local,
    selfie: buffer,
    selfieType: type,
    tentativas: 0,
  });
  return { modo: "offline", created_at };
}

export function iniciarSincronizacaoAutomatica() {
  if (typeof window === "undefined") return () => undefined;
  void precacheLocaisPonto();
  const tentar = () => {
    void sincronizarFilaPonto();
  };
  const aoVisivel = () => {
    if (document.visibilityState === "visible") tentar();
  };
  window.addEventListener("online", tentar);
  document.addEventListener("visibilitychange", aoVisivel);
  const timer = window.setInterval(tentar, 25000);
  tentar();
  return () => {
    window.removeEventListener("online", tentar);
    document.removeEventListener("visibilitychange", aoVisivel);
    window.clearInterval(timer);
  };
}
