-- Fase 1: perfil de acesso e valor da hora extra por colaborador.
ALTER TABLE public.segurancas ADD COLUMN IF NOT EXISTS perfil text DEFAULT 'operacional';
ALTER TABLE public.segurancas ADD COLUMN IF NOT EXISTS valor_hora_extra numeric DEFAULT 0;

UPDATE public.segurancas
SET perfil = 'admin'
WHERE perfil IS NULL OR perfil = 'operacional'
  AND (
    lower(nome) LIKE '%falcon%'
    OR lower(coalesce(cargo, '')) LIKE '%administrador%'
  );

UPDATE public.segurancas
SET perfil = 'supervisor'
WHERE lower(coalesce(cargo, '')) LIKE '%supervisor%';
