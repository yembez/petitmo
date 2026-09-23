-- Log anti-doublon des e-mails lifecycle (abo / inactivité).
CREATE TABLE IF NOT EXISTS public.lifecycle_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id text NOT NULL,
  dedupe_key text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_email_log_dedupe_uidx
  ON public.lifecycle_email_log (user_id, template_id, dedupe_key);

CREATE INDEX IF NOT EXISTS lifecycle_email_log_user_created_idx
  ON public.lifecycle_email_log (user_id, created_at DESC);

ALTER TABLE public.lifecycle_email_log ENABLE ROW LEVEL SECURITY;
-- Pas de policy client : service_role only.
