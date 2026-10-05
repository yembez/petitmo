-- Enveloppe metering vocal (JSON array 0..1) pour l’onde de lecture fil / immersif.
ALTER TABLE public.memories
ADD COLUMN IF NOT EXISTS voice_wave_peaks text;

COMMENT ON COLUMN public.memories.voice_wave_peaks IS
  'JSON array of 0..1 amplitudes from in-app mic metering (playback waveform). Null = import or legacy.';
