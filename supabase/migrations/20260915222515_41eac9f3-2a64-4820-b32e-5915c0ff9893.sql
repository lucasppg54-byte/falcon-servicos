CREATE TABLE public.locais_ronda (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  qr_code_hash TEXT NOT NULL UNIQUE,
  predio TEXT NOT NULL,
  local TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT ON public.locais_ronda TO anon;
GRANT SELECT ON public.locais_ronda TO authenticated;
GRANT ALL ON public.locais_ronda TO service_role;
ALTER TABLE public.locais_ronda ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Locais visíveis para todos" ON public.locais_ronda FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.registros_rondas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  local_id UUID NOT NULL REFERENCES public.locais_ronda(id) ON DELETE CASCADE,
  segurança TEXT NOT NULL,
  status TEXT NOT NULL,
  descricao TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.registros_rondas TO anon;
GRANT SELECT, INSERT ON public.registros_rondas TO authenticated;
GRANT ALL ON public.registros_rondas TO service_role;
ALTER TABLE public.registros_rondas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Registros visíveis para todos" ON public.registros_rondas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Qualquer segurança pode registrar" ON public.registros_rondas FOR INSERT TO anon, authenticated WITH CHECK (true);

INSERT INTO public.locais_ronda (qr_code_hash, predio, local) VALUES
  ('PRD01-EXT-01', 'Edifício Teste', 'Extintor — Hall de Entrada'),
  ('PRD01-HID-01', 'Edifício Teste', 'Hidrante — Corredor 1º Andar'),
  ('PRD01-SAI-02', 'Edifício Teste', 'Saída de Emergência — Subsolo');