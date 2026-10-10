import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const excluirRegistro = createServerFn({ method: "POST" })
  .validator((data) =>
    z
      .object({
        id: z.string().min(1),
        segurança: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    console.log("Excluindo registro ID:", data.id, "solicitado por:", data.segurança);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("registros_rondas")
      .delete()
      .eq("id", data.id);
      
    if (error) {
      console.error("Erro ao excluir no Supabase:", error);
      throw error;
    }
    
    return { ok: true };
  });