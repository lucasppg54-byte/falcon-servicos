-- Cobertura e justificativa da escala prevista.
-- A justificativa é mostrada como observação na folha de ponto.

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS cobertura boolean NOT NULL DEFAULT false;

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS justificativa text;
