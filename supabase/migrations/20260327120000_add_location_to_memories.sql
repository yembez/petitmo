-- Lieu optionnel saisi ou déduit (ex. ville) pour chaque souvenir
ALTER TABLE memories ADD COLUMN IF NOT EXISTS location text;
