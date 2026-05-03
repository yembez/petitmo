/*
  Bucket `media` : passage en **privé** (plus d’accès anonyme aux URLs /object/public/…).
  Les politiques « Users can * own media » (1er segment = auth.uid()) existent déjà
  (migration 20260112143500). Ne pas les dupliquer.

  Les chemins invité `guest/exports/…` ne matchent pas auth.uid() : politique INSERT
  dédiée pour que les signed upload URLs du flux export continuent de fonctionner.

  Après cette migration :
  - Le serveur PDF (service role) et les Edge Functions (service role) ne sont pas impactés.
  - L’app doit utiliser des **signed URLs** pour afficher les médias (voir code client).
  - Le rendu Playwright signe les URLs côté serveur avant `setContent`.
*/

UPDATE storage.buckets
SET public = false
WHERE id = 'media';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'media_bucket_guest_exports_insert'
  ) THEN
    CREATE POLICY "media_bucket_guest_exports_insert"
      ON storage.objects
      FOR INSERT
      TO authenticated, anon
      WITH CHECK (
        bucket_id = 'media'
        AND (
          name LIKE 'guest/exports/%'
          OR name LIKE 'exports/%'
        )
      );
  END IF;
END $$;
