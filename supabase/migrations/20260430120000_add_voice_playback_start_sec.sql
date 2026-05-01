-- Lecture d’un extrait quand le fichier stocké est la prise complète (pas de découpe native).
ALTER TABLE public.memories
ADD COLUMN IF NOT EXISTS voice_playback_start_sec double precision;

COMMENT ON COLUMN public.memories.voice_playback_start_sec IS
  'Début de l’extrait en secondes (0 = début du fichier). NULL = lire tout le fichier.';
