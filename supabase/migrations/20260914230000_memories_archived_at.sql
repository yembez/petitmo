-- Archivage souvenirs au downgrade Petitmo+ → gratuit (garder 50 actifs).
-- Spec : docs/specs/subscription-lifecycle-retention.md

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS archive_reason text NULL;

COMMENT ON COLUMN public.memories.archived_at IS
  'NULL = actif (fil / quotas). Posé au downgrade free ; clear au re-subscribe.';

COMMENT ON COLUMN public.memories.archive_reason IS
  'Ex. downgrade_free — pour restore sélectif.';

CREATE INDEX IF NOT EXISTS idx_memories_user_active_created
  ON public.memories (user_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memories_user_archived
  ON public.memories (user_id)
  WHERE archived_at IS NOT NULL;
