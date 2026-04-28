/*
  # Make Media Bucket Public

  1. Changes
    - Update the 'media' storage bucket to be public
    - This allows public URLs to work for displaying images in the app
    
  2. Security
    - RLS policies remain in place to control who can upload/modify media
    - Only authenticated users can upload their own media
    - Media files are still protected by the existing storage policies
*/

-- Update media bucket to be public
UPDATE storage.buckets
SET public = true
WHERE id = 'media';
