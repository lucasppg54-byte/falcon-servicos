const ADMIN_SEGURANCAS_PADRAO = ["Falcon (Admin)"];

export type PerfilAcesso = "admin" | "supervisor" | "operacional";

export interface IdentidadeAcesso {
  nome: string;
  cargo?: string | null;
  perfil?: string | null;
}

function normalizar(valor: string | null | undefined): string {
  return (valor ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function ehAdminClassico(pessoa: IdentidadeAcesso | string): boolean {
  const { nome, cargo, perfil } = typeof pessoa === "string" ? { nome: pessoa } : pessoa;
  const n = normalizar(nome);
  const c = normalizar(cargo);
  const p = normalizar(perfil);
  if (n.includes("falcon (admin)") || n.includes("administrador") || n.includes("mauro")) return true;
  if (c.includes("administrador") || p === "admin" || p === "administrador") return true;

  const env = import.meta.env["VITE_ADMIN_SEGURANCAS"] as string | undefined;
  const lista = (env ?? ADMIN_SEGURANCAS_PADRAO.join(","))
    .split(",")
    .map((item) => normalizar(item))
    .filter(Boolean);
  return lista.some((admin) => n.includes(admin));
}

export function ehSupervisor(pessoa: IdentidadeAcesso | string): boolean {
  const { nome, cargo, perfil } = typeof pessoa === "string" ? { nome: pessoa } : pessoa;
  const n = normalizar(nome);
  const c = normalizar(cargo);
  const p = normalizar(perfil);
  return c.includes("supervisor") || p === "supervisor" || n.includes("supervisor");
}

/** Admin e Supervisor partilham o mesmo painel e as mesmas permissões. */
export function ehAdminSeguranca(
  nome: string,
  cargo?: string | null,
  perfil?: string | null,
): boolean {
  const pessoa = { nome, cargo, perfil };
  if (!nome) return false;
  return ehAdminClassico(pessoa) || ehSupervisor(pessoa);
}

export function rotuloGestor(
  nome: string,
  cargo?: string | null,
  perfil?: string | null,
): "Admin" | "Supervisor" | null {
  const pessoa = { nome, cargo, perfil };
  if (!ehAdminSeguranca(nome, cargo, perfil)) return null;
  if (ehSupervisor(pessoa) && !ehAdminClassico(pessoa)) return "Supervisor";
  return "Admin";
}

export function perfilAPartirDoCargo(cargo: string): PerfilAcesso {
  const c = normalizar(cargo);
  if (c.includes("administrador")) return "admin";
  if (c.includes("supervisor")) return "supervisor";
  return "operacional";
}

export const CARGOS_EQUIPA = ["Vigilante", "Segurança", "Supervisor", "Administrador"] as const;
