/*
  # Overlay ink color (black/white) for captured date

  Stocke la couleur recommandée (noir/blanc) calculée sur la zone bas-droite
  de la thumbnail (sous le texte overlay), afin d'éviter le contraste incorrect.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'captured_overlay_ink'
  ) THEN
    ALTER TABLE public.memories ADD COLUMN captured_overlay_ink text;
  END IF;
END $$;

