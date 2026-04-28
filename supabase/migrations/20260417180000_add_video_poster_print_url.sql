-- Ajoute un poster HD pour l'impression (vidéo), séparé du poster léger utilisé dans l'app.
ALTER TABLE public.memories
ADD COLUMN IF NOT EXISTS poster_print_url text;

