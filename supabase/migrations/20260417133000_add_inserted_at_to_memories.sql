/*
  # inserted_at for feed ordering

  inserted_at = date d'ajout dans l'app (ordre chronologique d'ajout).
  created_at reste la date "événement" (EXIF import, moment du souvenir).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'inserted_at'
  ) THEN
    ALTER TABLE public.memories ADD COLUMN inserted_at timestamptz;
  END IF;
END $$;

-- Backfill: on prend updated_at (souvent proche de l'ajout) sinon now().
UPDATE public.memories
SET inserted_at = COALESCE(inserted_at, updated_at, now())
WHERE inserted_at IS NULL;

-- Default pour les nouveaux inserts
ALTER TABLE public.memories ALTER COLUMN inserted_at SET DEFAULT now();
ALTER TABLE public.memories ALTER COLUMN inserted_at SET NOT NULL;

