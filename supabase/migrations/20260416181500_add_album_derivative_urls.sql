/*
  # Album derivative URLs

  Pour les souvenirs "album" (type photo + extra_photo_urls),
  on stocke aussi des variantes légères par image afin de réduire l'egress dans le feed.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'extra_thumb_urls'
  ) THEN
    ALTER TABLE memories ADD COLUMN extra_thumb_urls jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'extra_display_urls'
  ) THEN
    ALTER TABLE memories ADD COLUMN extra_display_urls jsonb;
  END IF;
END $$;

