/*
  # Colonne memories.upload_status

  Synchronise le schéma Postgres avec le client (stratégie gratuit / payant).
  PostgREST refuse les INSERT contenant une clé inconnue (PGRST204).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'memories'
      AND column_name = 'upload_status'
  ) THEN
    ALTER TABLE public.memories ADD COLUMN upload_status text;

    UPDATE public.memories
    SET upload_status = 'full'
    WHERE upload_status IS NULL;

    UPDATE public.memories
    SET upload_status = 'print_only'
    WHERE type = 'photo'
      AND (media_url IS NULL OR btrim(media_url) = '')
      AND print_url IS NOT NULL
      AND btrim(print_url) <> ''
      AND thumb_url IS NOT NULL
      AND btrim(thumb_url) <> '';

    ALTER TABLE public.memories
      ALTER COLUMN upload_status SET DEFAULT 'full',
      ALTER COLUMN upload_status SET NOT NULL;
  END IF;
END $$;
