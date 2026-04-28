/*
  # Create Storage Bucket and Enhance Memories Table

  1. Storage Setup
    - Create 'media' bucket for storing photos, videos, and audio files
    - Enable public access for authenticated users
    - Set up RLS policies for secure access

  2. Table Enhancements
    - Add `duration` column to memories table for audio/video length in seconds
    - Add `thumbnail_url` column for video thumbnails
    - Add `file_size` column to track media file sizes

  3. Security
    - Bucket policies ensure users can only upload/access their own media
*/

-- Add new columns to memories table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'duration'
  ) THEN
    ALTER TABLE memories ADD COLUMN duration integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'thumbnail_url'
  ) THEN
    ALTER TABLE memories ADD COLUMN thumbnail_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'file_size'
  ) THEN
    ALTER TABLE memories ADD COLUMN file_size bigint;
  END IF;
END $$;

-- Create storage bucket for media files
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for media bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage'
    AND policyname = 'Users can upload own media'
  ) THEN
    CREATE POLICY "Users can upload own media"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'media' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage'
    AND policyname = 'Users can view own media'
  ) THEN
    CREATE POLICY "Users can view own media"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'media' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage'
    AND policyname = 'Users can update own media'
  ) THEN
    CREATE POLICY "Users can update own media"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'media' AND
        (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'media' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' 
    AND schemaname = 'storage'
    AND policyname = 'Users can delete own media'
  ) THEN
    CREATE POLICY "Users can delete own media"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'media' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;