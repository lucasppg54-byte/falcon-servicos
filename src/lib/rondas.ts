import { supabase } from "@/integrations/supabase/client";
import { BUCKET_FOTOS, caminhoNoBucket, extrairFotos, gerarCaminhoFoto, serializarFotos } from "@/lib/fotos";
import { podeExcluirRegistro } from "@/lib/marcacoes";

export { ehAdminSeguranca, rotuloGestor } from "@/lib/perfis";

export interface LocalRonda {
  id: string;
  qr_code_hash: string;
  predio: string;
  local: string;
}

export interface RegistroRonda {
  id: string;
  local_id: string;
  seguranca: string;
  status: "OK" | "ANOMALIA";
  gravidade: "MODERADA" | "GRAVE";
  status_correcao: "PENDENTE" | "CORRIGIDO";
  descricao: string | null;
  latitude: number | null;
  longitude: number | null;
  foto_url: string | null;
  created_at: string;
  locais_ronda: { predio: string; local: string; qr_code_hash: string } | null;
}

export function normalizarNome(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizarCodigoQr(valor: string): string {
  const bruto = valor.trim();
  if (!bruto) return "";

  try {
    const url = new URL(bruto.includes("://") ? bruto : `https://dummy.com/${bruto}`);
    const qrParam = url.searchParams.get("qr") || url.searchParams.get("local");
    if (qrParam) {
      return qrParam.trim().toLowerCase();
    }
  } catch {
    // URL inválida
  }

  return bruto.toLowerCase();
}

function localAutorizado(local: LocalRonda, postoAtribuido?: string | null, isAdmin = false): LocalRonda | null {
  if (isAdmin || !postoAtribuido || postoAtribuido.toLowerCase() === "geral") return local;
  const postoNorm = normalizarNome(postoAtribuido);
  const predioNorm = normalizarNome(local.predio);
  if (!postoNorm || !predioNorm) return null;
  if (postoNorm.includes(predioNorm) || predioNorm.includes(postoNorm)) return local;
  return null;
}

export async function buscarLocalPorQr(qrCodeHash: string, postoAtribuido?: string | null, isAdmin = false): Promise<LocalRonda | null> {
  const codigo = normalizarCodigoQr(qrCodeHash);
  if (!codigo) return null;

  const { data, error } = await supabase
    .from("locais_ronda")
    .select("id, qr_code_hash, predio, local")
    .ilike("qr_code_hash", codigo);

  if (error) throw error;

  const exacto = ((data || []) as LocalRonda[]).find((l) => normalizarCodigoQr(l.qr_code_hash) === codigo);
  if (exacto) return localAutorizado(exacto, postoAtribuido, isAdmin);

  let queryFallback = supabase.from("locais_ronda").select("id, qr_code_hash, predio, local");
  if (!isAdmin && postoAtribuido && postoAtribuido.toLowerCase() !== "geral") {
    queryFallback = queryFallback.ilike("predio", `%${postoAtribuido}%`);
  }

  const { data: todosLocais, error: erroLista } = await queryFallback;
  if (erroLista) throw erroLista;
  if (!todosLocais || todosLocais.length === 0) return null;

  const encontrado = (todosLocais as LocalRonda[]).find((l) => {
    const hash = normalizarCodigoQr(l.qr_code_hash);
    return hash === codigo || hash.includes(codigo) || codigo.includes(hash);
  });

  return encontrado ? localAutorizado(encontrado, postoAtribuido, isAdmin) : null;
}

export async function registrarRonda(input: {
  localId: string;
  seguranca: string;
  status: "OK" | "ANOMALIA";
  gravidade?: "MODERADA" | "GRAVE";
  descricao?: string;
  latitude?: number | null;
  longitude?: number | null;
  fotoFiles?: File[];
  isCobertura?: boolean;
  postoCobertura?: string;
}): Promise<void> {
  const latFinal = input.latitude ?? -16.6869;
  const lonFinal = input.longitude ?? -49.2648;

  const caminhosEnviados = await enviarFotos(input.fotoFiles ?? []);
  const fotoUrlFinal = serializarFotos(
    caminhosEnviados.map((c) => supabase.storage.from(BUCKET_FOTOS).getPublicUrl(c).data.publicUrl),
  );

  let descFinal = input.descricao ?? null;
  if (input.isCobertura) {
    const prefixo = `🚨 [COBERTURA / APOIO URGENTE no posto ${input.postoCobertura}]`;
    descFinal = descFinal ? `${prefixo} — ${descFinal}` : prefixo;
  }

  const payload = {
    local_id: input.localId,
    seguranca: input.seguranca,
    status: input.status,
    gravidade: input.gravidade ?? "MODERADA",
    status_correcao: input.gravidade === "GRAVE" ? "PENDENTE" : "CORRIGIDO",
    descricao: descFinal,
    latitude: latFinal,
    longitude: lonFinal,
    foto_url: fotoUrlFinal,
  };

  const { error } = await supabase.from("registros_rondas").insert(payload);
  if (error) {
    await removerFotosDoBucket(caminhosEnviados);
    throw error;
  }
}

async function enviarFotos(files: File[]): Promise<string[]> {
  const agora = new Date();
  const enviados: string[] = [];
  try {
    for (const [i, file] of files.entries()) {
      const caminho = gerarCaminhoFoto(file, agora, i);
      const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(caminho, file, {
        cacheControl: "3600",
        contentType: file.type || "image/jpeg",
        upsert: false,
      });
      if (error) throw new Error(`Erro ao enviar foto ${i + 1} de ${files.length}: ${error.message}`);
      enviados.push(caminho);
    }
  } catch (err) {
    await removerFotosDoBucket(enviados);
    throw err;
  }
  return enviados;
}

async function removerFotosDoBucket(caminhos: string[]): Promise<void> {
  if (caminhos.length === 0) return;
  // Melhor esforço: uma foto órfã no bucket não deve bloquear o fluxo do vigilante.
  await supabase.storage.from(BUCKET_FOTOS).remove(caminhos).catch(() => undefined);
}

export async function excluirRegistro(
  registro: Pick<RegistroRonda, "id" | "foto_url" | "seguranca" | "descricao">,
  segurancaAtual: string,
  admin: boolean,
): Promise<void> {
  if (!podeExcluirRegistro(registro, segurancaAtual, admin)) {
    throw new Error("Marcações de início ou fim de plantão não podem ser apagadas.");
  }

  let query = supabase.from("registros_rondas").delete().eq("id", registro.id);
  if (!admin) query = query.eq("seguranca", segurancaAtual);

  const { data, error } = await query.select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("O registo não foi apagado (sem permissão ou já removido).");
  }

  const caminhos = extrairFotos(registro.foto_url)
    .map((url) => caminhoNoBucket(url))
    .filter((c): c is string => !!c);
  await removerFotosDoBucket(caminhos);
}

export async function marcarComoCorrigido(id: string): Promise<void> {
  const { error } = await supabase
    .from("registros_rondas")
    .update({ status_correcao: "CORRIGIDO" })
    .eq("id", id);
  if (error) throw error;
}

export async function listarRegistros(
  limite = 200,
  filtros?: { dataInicial?: string | undefined; dataFinal?: string | undefined },
): Promise<RegistroRonda[]> {
  let query = supabase
    .from("registros_rondas")
    .select("id, local_id, seguranca, status, gravidade, status_correcao, descricao, latitude, longitude, foto_url, created_at, locais_ronda(predio, local, qr_code_hash)")
    .order("created_at", { ascending: false })
    .limit(limite);

  if (filtros?.dataInicial) {
    const ini = new Date(`${filtros.dataInicial}T00:00:00`);
    if (!Number.isNaN(ini.getTime())) query = query.gte("created_at", ini.toISOString());
  }
  if (filtros?.dataFinal) {
    const fim = new Date(`${filtros.dataFinal}T23:59:59.999`);
    if (!Number.isNaN(fim.getTime())) query = query.lte("created_at", fim.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as RegistroRonda[];
}