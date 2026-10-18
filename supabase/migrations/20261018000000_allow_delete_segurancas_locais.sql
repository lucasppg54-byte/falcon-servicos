-- A chave publishable/anon consegue ler e inserir, mas o RLS bloqueava
-- UPDATE/DELETE (o PostgREST devolve 200 com 0 linhas). Sem estas
-- políticas o botão Excluir não remove o registo na base.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.segurancas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locais_ronda TO anon, authenticated;

ALTER TABLE public.segurancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locais_ronda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Segurancas visíveis para todos" ON public.segurancas;
DROP POLICY IF EXISTS "Segurancas podem ser inseridas" ON public.segurancas;
DROP POLICY IF EXISTS "Segurancas podem ser atualizadas" ON public.segurancas;
DROP POLICY IF EXISTS "Segurancas podem ser excluídas" ON public.segurancas;

CREATE POLICY "Segurancas visíveis para todos"
  ON public.segurancas FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Segurancas podem ser inseridas"
  ON public.segurancas FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Segurancas podem ser atualizadas"
  ON public.segurancas FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Segurancas podem ser excluídas"
  ON public.segurancas FOR DELETE TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Locais podem ser inseridos" ON public.locais_ronda;
DROP POLICY IF EXISTS "Locais podem ser atualizados" ON public.locais_ronda;
DROP POLICY IF EXISTS "Locais podem ser excluídos" ON public.locais_ronda;

CREATE POLICY "Locais podem ser inseridos"
  ON public.locais_ronda FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Locais podem ser atualizados"
  ON public.locais_ronda FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Locais podem ser excluídos"
  ON public.locais_ronda FOR DELETE TO anon, authenticated
  USING (true);
