-- Bucket público "rondas" para as fotos das anomalias (substitui o antigo "rondas-fotos",
-- que nunca foi criado e provocava o erro "Bucket not found").
-- Idempotente: pode ser executado mais de uma vez sem efeitos colaterais.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rondas',
  'rondas',
  true,
  15728640, -- 15 MB por foto
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- A app usa a chave pública (anon) — os vigilantes não têm sessão Supabase Auth.
DROP POLICY IF EXISTS "Rondas: envio de fotos" ON storage.objects;
CREATE POLICY "Rondas: envio de fotos"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'rondas');

DROP POLICY IF EXISTS "Rondas: leitura de fotos" ON storage.objects;
CREATE POLICY "Rondas: leitura de fotos"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'rondas');

DROP POLICY IF EXISTS "Rondas: remoção de fotos" ON storage.objects;
CREATE POLICY "Rondas: remoção de fotos"
  ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'rondas');
