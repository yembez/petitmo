-- Albums photos : URLs additionnelles (JSON array). media_url reste la 1ère image.
ALTER TABLE public.memories
ADD COLUMN IF NOT EXISTS extra_photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.memories.extra_photo_urls IS 'URLs des photos 2..n (album) ; media_url = 1ère image';
