-- Défaut produit : rappel du soir à 20:45 (pas 20:00).
alter table public.notification_prefs
  alter column capture_reminder_local_time set default '20:45';
