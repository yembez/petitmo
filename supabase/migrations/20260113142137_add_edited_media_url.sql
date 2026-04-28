/*
  # Add edited_media_url column to memories table

  1. Changes
    - Add `edited_media_url` column to memories table
    - This allows preserving the original photo while storing an edited version
    - When edited_media_url is present, it should be displayed instead of media_url
    - media_url always contains the original unedited media

  2. Security
    - No RLS changes needed (inherits from existing table policies)
*/

-- Add edited_media_url column to memories table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'edited_media_url'
  ) THEN
    ALTER TABLE memories ADD COLUMN edited_media_url text;
  END IF;
END $$;
