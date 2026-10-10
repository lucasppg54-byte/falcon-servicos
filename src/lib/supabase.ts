import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltam as variáveis de ambiente do Supabase no ficheiro .env");
}

export const supabase = createClient(supabaseUrl, supabaseKey);