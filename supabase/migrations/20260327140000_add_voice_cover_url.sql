-- Image de fond optionnelle pour les souvenirs vocaux (illustration derrière le lecteur)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS voice_cover_url text;
