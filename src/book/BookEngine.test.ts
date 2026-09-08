import { describe, expect, it } from 'vitest';
import { buildBookPages, type BookPage } from '@/src/book/BookEngine';
import type { Child, Memory } from '@/types/local';

const child: Child = {
  id: 'c1',
  name: 'Léa',
  birthdate: '2024-01-15',
  photo_url: null,
  created_at: '2024-01-01T00:00:00.000Z',
};

function photoMemory(id: string, content: string | null, createdAt?: string): Memory {
  const at = createdAt ?? '2024-06-01T12:00:00.000Z';
  return {
    id,
    child_id: child.id,
    type: 'photo',
    content,
    created_at: at,
    inserted_at: at,
    media_url: 'file:///photo.jpg',
    thumbnail_url: null,
    location: null,
    duration: null,
    is_favorite: true,
  };
}

/** Ids des pages contenu, dans l’ordre — hors couverture / chapitre / 4e. */
function contentIds(pages: BookPage[]): string[] {
  const out: string[] = [];
  for (const page of pages) {
    if ('memory' in page) out.push(page.memory.id);
  }
  return out;
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

describe('buildBookPages — ordre des pages contenu', () => {
  const janvier = photoMemory('jan', 'Court', '2025-01-10T12:00:00.000Z');
  const fevrier = photoMemory('fev', 'Court', '2025-02-10T12:00:00.000Z');
  const mars = photoMemory('mar', 'Court', '2025-03-10T12:00:00.000Z');
  /** Séquence volontairement désordonnée : c’est ce que produit un `pageEntries` APPEND. */
  const desordre = [mars, janvier, fevrier];

  it('retrie par date par défaut', () => {
    expect(contentIds(buildBookPages(child, desordre))).toEqual(['jan', 'fev', 'mar']);
  });

  it('respecte la séquence reçue quand preserveOrder est actif', () => {
    expect(contentIds(buildBookPages(child, desordre, { preserveOrder: true }))).toEqual([
      'mar',
      'jan',
      'fev',
    ]);
  });

  it('donne le même résultat dans les deux modes si la séquence est déjà chronologique', () => {
    const ordonne = [janvier, fevrier, mars];
    expect(buildBookPages(child, ordonne, { preserveOrder: true })).toEqual(
      buildBookPages(child, ordonne),
    );
  });

  it('n’ajoute pas de page d’ouverture supplémentaire pour un souvenir déplacé seul', () => {
    const jan2 = photoMemory('jan2', 'Court', '2025-01-20T12:00:00.000Z');
    const pages = buildBookPages(child, [janvier, mars, jan2], { preserveOrder: true });
    expect(pages.filter(p => p.type === 'chapter')).toHaveLength(1);
    expect(contentIds(pages)).toEqual(['jan', 'mar', 'jan2']);
  });
});

/**
 * Le livre n’a plus de chapitrage : une seule page d’ouverture, quel que soit l’ordre.
 * Le nombre de pages imprimées ne doit pas dépendre de la façon dont les pages sont rangées,
 * puisqu’il détermine le prix.
 */
describe('buildBookPages — page d’ouverture unique', () => {
  const jan1 = photoMemory('jan1', 'Court', '2025-01-05T12:00:00.000Z');
  const jan2 = photoMemory('jan2', 'Court', '2025-01-20T12:00:00.000Z');
  const fev1 = photoMemory('fev1', 'Court', '2025-02-05T12:00:00.000Z');
  const fev2 = photoMemory('fev2', 'Court', '2025-02-20T12:00:00.000Z');
  const mar1 = photoMemory('mar1', 'Court', '2025-03-05T12:00:00.000Z');
  const mar2 = photoMemory('mar2', 'Court', '2025-03-20T12:00:00.000Z');
  const tous = [jan1, jan2, fev1, fev2, mar1, mar2];

  function chapters(pages: BookPage[]) {
    return pages.filter((p): p is Extract<BookPage, { type: 'chapter' }> => p.type === 'chapter');
  }

  it('n’émet qu’une page, bornes de la période seules', () => {
    expect(chapters(buildBookPages(child, tous)).map(c => c.month)).toEqual([
      'janvier – mars 2025',
    ]);
  });

  it('donne la même page et le même compte quel que soit l’ordre', () => {
    const chrono = buildBookPages(child, tous);
    const manuel = buildBookPages(child, [mar2, jan1, fev1, jan2, fev2, mar1], {
      preserveOrder: true,
    });
    expect(chapters(manuel).map(c => c.month)).toEqual(chapters(chrono).map(c => c.month));
    expect(manuel.length).toBe(chrono.length);
  });

  it('affiche le mois seul quand le livre tient dans un mois', () => {
    expect(chapters(buildBookPages(child, [jan1, jan2])).map(c => c.month)).toEqual([
      'janvier 2025',
    ]);
  });

  it('porte les deux années quand le livre change d’année', () => {
    const dec = photoMemory('dec', 'Court', '2024-12-10T12:00:00.000Z');
    expect(chapters(buildBookPages(child, [dec, fev1])).map(c => c.month)).toEqual([
      'décembre 2024 – février 2025',
    ]);
  });

  it('ouvre le livre sur cette page, avant la première page contenu', () => {
    const pages = buildBookPages(child, [mar2, jan1, fev1], { preserveOrder: true });
    const firstChapter = pages.findIndex(p => p.type === 'chapter');
    const firstContent = pages.findIndex(p => 'memory' in p);
    expect(firstChapter).toBeGreaterThanOrEqual(0);
    expect(firstChapter).toBeLessThan(firstContent);
    expect(contentIds(pages)).toEqual(['mar2', 'jan1', 'fev1']);
  });

  it('n’émet aucune page d’ouverture pour un livre d’un seul souvenir', () => {
    expect(chapters(buildBookPages(child, [jan1]))).toHaveLength(0);
  });
});

/**
 * La variante pleine page se décide sur la double page : ce qui compte est la page d’en
 * face, jamais la précédente. Deux pages bordées côte à côte se voient ; une pleine page
 * répétée d’une double page à l’autre, non.
 */
describe('buildBookPages — pleine page vs marges sur la double page', () => {
  function memory(id: string, type: Memory['type'], day: number, content = 'Court'): Memory {
    const at = `2025-01-${String(day).padStart(2, '0')}T12:00:00.000Z`;
    return { ...photoMemory(id, content, at), type };
  }

  /** Doubles pages telles qu’à l’écran : couverture seule, puis (2,3), (4,5)… */
  function spreads(pages: BookPage[]): [BookPage, BookPage][] {
    const out: [BookPage, BookPage][] = [];
    const end = pages[pages.length - 1]!.type === 'back-cover' ? pages.length - 1 : pages.length;
    for (let i = 1; i + 1 < end; i += 2) out.push([pages[i]!, pages[i + 1]!]);
    return out;
  }

  function variant(page: BookPage): string {
    return page.type === 'photo-full' ? page.variant : page.type;
  }

  const longue = 'mot '.repeat(50).trim();
  /** Livre varié : photos courtes, petit mot illustré, audio, vidéo, texte seul. */
  const varie = [
    memory('p1', 'photo', 2),
    memory('p2', 'photo', 3),
    memory('a1', 'voice', 4),
    memory('p3', 'photo', 5),
    memory('n1', 'photo', 6, longue),
    memory('p4', 'photo', 7),
    memory('v1', 'video', 8),
    memory('p5', 'photo', 9),
    memory('t1', 'text', 10, 'Un petit mot'),
    memory('p6', 'photo', 11),
    memory('p7', 'photo', 12),
    memory('p8', 'photo', 13),
  ];

  function isBordered(page: BookPage): boolean {
    return page.type === 'photo-note' || page.type === 'audio' || page.type === 'video';
  }

  /** Toutes les paires possibles : ordre chronologique et deux ordres manuels. */
  const livres = [
    buildBookPages(child, varie),
    buildBookPages(child, [...varie].reverse(), { preserveOrder: true }),
    buildBookPages(child, [varie[2]!, ...varie.slice(0, 2), ...varie.slice(3)], {
      preserveOrder: true,
    }),
  ];

  it('met en pleine page toute photo qui fait face à une page bordée', () => {
    for (const pages of livres) {
      for (const [left, right] of spreads(pages)) {
        if (left.type === 'photo-full' && isBordered(right)) expect(variant(left)).toBe('FP');
        if (right.type === 'photo-full' && isBordered(left)) expect(variant(right)).toBe('FP');
      }
    }
  });

  it('ne met jamais deux photos pleine page face à face', () => {
    for (const pages of livres) {
      for (const [left, right] of spreads(pages)) {
        expect([variant(left), variant(right)]).not.toEqual(['FP', 'FP']);
      }
    }
  });

  it('accepte une pleine page répétée d’une double page à l’autre', () => {
    // Ce que la règle de séquence interdisait, et qui ne se voit pas à la lecture.
    const ouvertures = spreads(livres[0]!).map(([left]) => variant(left));
    const deuxDeSuite = ouvertures.some((v, i) => v === 'FP' && ouvertures[i + 1] === 'FP');
    expect(deuxDeSuite).toBe(true);
  });
});
