import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

const cache = new Map<string, { w: number; h: number }>();

export async function getImagePixelSize(uri: string): Promise<{ w: number; h: number } | null> {
  const key = uri.trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return hit;

  const fromRn = await new Promise<{ w: number; h: number } | null>(resolve => {
    Image.getSize(
      key,
      (w, h) => resolve(w > 0 && h > 0 ? { w, h } : null),
      () => resolve(null),
    );
  });
  if (fromRn) {
    cache.set(key, fromRn);
    return fromRn;
  }

  try {
    const decoded = await ImageManipulator.manipulateAsync(key, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (decoded.width > 0 && decoded.height > 0) {
      const size = { w: decoded.width, h: decoded.height };
      cache.set(key, size);
      return size;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Dimensions pixels d’une image locale ou distante (cache module). */
export function useImagePixelSize(uri: string | null | undefined): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(() => {
    const k = uri?.trim();
    return k ? (cache.get(k) ?? null) : null;
  });

  useEffect(() => {
    const k = uri?.trim();
    if (!k) {
      setSize(null);
      return;
    }
    const hit = cache.get(k);
    if (hit) {
      setSize(hit);
      return;
    }
    let cancelled = false;
    void getImagePixelSize(k).then(next => {
      if (!cancelled && next) setSize(next);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return size;
}
