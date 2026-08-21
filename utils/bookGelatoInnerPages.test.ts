import { describe, expect, it } from 'vitest';
import { gelatoInnerPageNumber } from '@/utils/bookGelatoInnerPages';

describe('gelatoInnerPageNumber', () => {
  const pages = [
    { type: 'cover' },
    { type: 'chapter' },
    ...Array.from({ length: 26 }, () => ({ type: 'photo-full' })),
    { type: 'back-cover' },
  ];

  it('returns null for cover and back-cover', () => {
    expect(gelatoInnerPageNumber(pages, 0)).toBeNull();
    expect(gelatoInnerPageNumber(pages, pages.length - 1)).toBeNull();
  });

  it('numbers inner pages from 1 (éditeur Page 27 = folio 27, not absolute 28)', () => {
    expect(gelatoInnerPageNumber(pages, 1)).toBe(1);
    // index 27 = 27e intérieure (cover + 26 photos + chapter at 1 → indices 1..27)
    expect(gelatoInnerPageNumber(pages, 27)).toBe(27);
    expect(pages[27]?.type).toBe('photo-full');
  });
});
