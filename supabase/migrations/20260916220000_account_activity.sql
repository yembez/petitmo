-- Activité compte (inactivité 24 mois).
CREATE TABLE IF NOT EXISTS public.account_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_activity_last_active_idx
  ON public.account_activity (last_active_at);

ALTER TABLE public.account_activity ENABLE ROW LEVEL SECURITY;

-- Lecture / upsert de sa propre ligne (touch client).
CREATE POLICY account_activity_select_own
  ON public.account_activity FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY account_activity_upsert_own
  ON public.account_activity FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY account_activity_update_own
  ON public.account_activity FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
