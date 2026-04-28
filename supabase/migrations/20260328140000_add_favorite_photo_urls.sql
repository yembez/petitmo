-- URLs des photos d’un album marquées individuellement comme favoris (écran Favoris).
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS favorite_photo_urls jsonb DEFAULT '[]'::jsonb NOT NULL;