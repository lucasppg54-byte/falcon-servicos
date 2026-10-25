-- Fase 2: escalas previstas e solicitações de ajuste de ponto.

CREATE TABLE IF NOT EXISTS public.escalas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  turno text NOT NULL CHECK (turno IN ('DIURNO', 'NOTURNO')),
  hora_entrada text NOT NULL DEFAULT '07:00',
  hora_saida text NOT NULL DEFAULT '19:00',
  predio text NOT NULL,
  local text,
  seguranca text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS escalas_data_idx ON public.escalas (data);
CREATE INDEX IF NOT EXISTS escalas_predio_idx ON public.escalas (predio);

CREATE TABLE IF NOT EXISTS public.solicitacoes_ajuste_ponto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seguranca text NOT NULL,
  data date NOT NULL,
  horario_pretendido text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ENTRADA', 'SAIDA')),
  justificativa text NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'APROVADO', 'RECUSADO')),
  motivo_recusa text,
  decidido_por text,
  decidido_em timestamptz,
  marcacao_original_id uuid,
  marcacao_ajuste_id uuid,
  predio text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ajustes_status_idx ON public.solicitacoes_ajuste_ponto (status);
CREATE INDEX IF NOT EXISTS ajustes_seguranca_idx ON public.solicitacoes_ajuste_ponto (seguranca);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitacoes_ajuste_ponto TO anon, authenticated;

ALTER TABLE public.escalas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_ajuste_ponto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Escalas visíveis" ON public.escalas;
DROP POLICY IF EXISTS "Escalas inserir" ON public.escalas;
DROP POLICY IF EXISTS "Escalas atualizar" ON public.escalas;
DROP POLICY IF EXISTS "Escalas excluir" ON public.escalas;
CREATE POLICY "Escalas visíveis" ON public.escalas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Escalas inserir" ON public.escalas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Escalas atualizar" ON public.escalas FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Escalas excluir" ON public.escalas FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Ajustes visíveis" ON public.solicitacoes_ajuste_ponto;
DROP POLICY IF EXISTS "Ajustes inserir" ON public.solicitacoes_ajuste_ponto;
DROP POLICY IF EXISTS "Ajustes atualizar" ON public.solicitacoes_ajuste_ponto;
CREATE POLICY "Ajustes visíveis" ON public.solicitacoes_ajuste_ponto FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Ajustes inserir" ON public.solicitacoes_ajuste_ponto FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Ajustes atualizar" ON public.solicitacoes_ajuste_ponto FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
