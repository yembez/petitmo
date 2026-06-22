import { describe, expect, it } from 'vitest';
import { buildBookPages } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';

const child: Child = {
  id: 'c1',
  name: 'Léa',
  birthdate: '2024-01-15',
  photo_url: null,
  created_at: '2024-01-01T00:00:00.000Z',
};

function photoMemory(id: string, content: string | null): Memory {
  return {
    id,
    child_id: child.id,
    type: 'photo',
    content,
    created_at: '2024-06-01T12:00:00.000Z',
    inserted_at: '2024-06-01T12:00:00.000Z',
    media_url: 'file:///photo.jpg',
    thumbnail_url: null,
    location: null,
    duration: null,
    is_favorite: true,
  };
}

describe('buildBookPages', () => {
  it('choisit photo-note au-delà de 3 lignes estimées', () => {
    const longCaption = 'mot '.repeat(50).trim();
    const pages = buildBookPages(child, [photoMemory('m1', longCaption)]);
    const content = pages.filter(p => p.type === 'photo-full' || p.type === 'photo-note');
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe('photo-note');
  });

  it('choisit photo-full pour une légende courte', () => {
    const pages = buildBookPages(child, [photoMemory('m1', 'Un joli moment')]);
    const photo = pages.find(p => p.type === 'photo-full' || p.type === 'photo-note');
    expect(photo?.type).toBe('photo-full');
    if (photo?.type === 'photo-full') {
      expect(photo.variant).toBe('FP');
    }
  });

  it('alterne FP et M sur des photo-full consécutives', () => {
    const pages = buildBookPages(child, [
      photoMemory('m1', 'Court'),
      photoMemory('m2', 'Aussi court'),
      photoMemory('m3', 'Toujours court'),
    ]);
    const variants = pages
      .filter((p): p is Extract<typeof p, { type: 'photo-full' }> => p.type === 'photo-full')
      .map(p => p.variant);
    expect(variants).toEqual(['FP', 'M', 'FP']);
  });
});
