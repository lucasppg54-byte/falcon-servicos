-- Permite corrigir o texto de um registo já gravado no Livro Ata.
-- A aplicação só envia o update da linha do próprio autor.

DO $$
BEGIN
  IF to_regclass('public.ocorricoes_plantao') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'GRANT UPDATE ON TABLE public.ocorricoes_plantao TO anon, authenticated';
  EXECUTE 'DROP POLICY IF EXISTS "Livro ata pode ser atualizado" ON public.ocorricoes_plantao';
  EXECUTE $policy$
    CREATE POLICY "Livro ata pode ser atualizado"
    ON public.ocorricoes_plantao
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true)
  $policy$;
END $$;
