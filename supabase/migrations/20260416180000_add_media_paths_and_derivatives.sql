/*
  # Media paths + derivatives for cost control

  Objectifs:
  - Stocker les chemins Storage (bucket+path) pour pouvoir:
    - générer des variantes côté serveur (thumb / display / poster vidéo)
    - supprimer proprement tous les objets Storage (éviter les orphelins)
  - Réduire l'egress en servant des tailles adaptées au feed/preview.
*/

DO $$
BEGIN
  /* --- Storage paths (sources) --- */
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'media_path'
  ) THEN
    ALTER TABLE memories ADD COLUMN media_path text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'extra_photo_paths'
  ) THEN
    ALTER TABLE memories ADD COLUMN extra_photo_paths jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'voice_cover_path'
  ) THEN
    ALTER TABLE memories ADD COLUMN voice_cover_path text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'thumbnail_path'
  ) THEN
    ALTER TABLE memories ADD COLUMN thumbnail_path text;
  END IF;

  /* --- Derivative URLs (serveurs / app) --- */
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'thumb_url'
  ) THEN
    ALTER TABLE memories ADD COLUMN thumb_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'display_url'
  ) THEN
    ALTER TABLE memories ADD COLUMN display_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'print_url'
  ) THEN
    ALTER TABLE memories ADD COLUMN print_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'poster_url'
  ) THEN
    ALTER TABLE memories ADD COLUMN poster_url text;
  END IF;
END $$;

