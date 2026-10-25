-- Fase 3: selfies de ponto no mesmo bucket "rondas", pasta ponto/.
-- A leitura na UI é limitada a Admin/Supervisor; o caminho separado
-- permite políticas mais restritas no futuro.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rondas',
  'rondas',
  true,
  15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Ponto: envio de selfies" ON storage.objects;
CREATE POLICY "Ponto: envio de selfies"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'rondas' AND (name LIKE 'ponto/%' OR name LIKE 'anomalias/%'));

DROP POLICY IF EXISTS "Ponto: leitura de selfies" ON storage.objects;
CREATE POLICY "Ponto: leitura de selfies"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'rondas');
