-- Bucket público "rondas" para as fotos de anomalias (src/lib/rondas.ts -> BUCKET_FOTOS).
-- Idempotente: pode ser executado mesmo que o bucket já tenha sido criado pelo painel.
INSERT INTO storage.buckets (id, name, public)
VALUES ('rondas', 'rondas', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rondas: upload de fotos'
  ) THEN
    CREATE POLICY "rondas: upload de fotos" ON storage.objects
      FOR INSERT TO anon, authenticated
      WITH CHECK (bucket_id = 'rondas');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rondas: leitura de fotos'
  ) THEN
    CREATE POLICY "rondas: leitura de fotos" ON storage.objects
      FOR SELECT TO anon, authenticated
      USING (bucket_id = 'rondas');
  END IF;

  -- Necessária para apagar a foto quando o vigilante anula o último registo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rondas: remoção de fotos'
  ) THEN
    CREATE POLICY "rondas: remoção de fotos" ON storage.objects
      FOR DELETE TO anon, authenticated
      USING (bucket_id = 'rondas');
  END IF;
END $$;
