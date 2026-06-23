-- Titre optionnel sur les souvenirs texte (fil + livre).
ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS text_title text;

COMMENT ON COLUMN public.memories.text_title IS
  'Titre optionnel affiché sur les souvenirs de type text (fil, livre).';
