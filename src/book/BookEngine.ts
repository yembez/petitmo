import type { Child, Memory } from '@/types/local';
export type { Memory, Child } from '@/types/local';
import { bookChapterStarts, planBookChapters } from '@/utils/bookChapterPlan';
import { estimateBookLines } from '@/utils/textLimits';

export type PhotoFullVariant = 'FP' | 'M';

export type BookPage =
  | { type: 'cover'; child: Child }
  | { type: 'chapter'; month: string; chapterNum: number }
  | { type: 'photo-full'; memory: Memory; variant: PhotoFullVariant; photoRef?: string }
  | { type: 'photo-note'; memory: Memory; photoRef?: string }
  | { type: 'quote'; memory: Memory }
  | { type: 'audio'; memory: Memory }
  | { type: 'video'; memory: Memory }
  | { type: 'back-cover' };

/** Une entrée livre (= une page contenu), éventuellement une photo d’album précise. */
export type BookPageMemorySpec = { memory: Memory; photoRef?: string };

/**
 * Index de la page qui fait face dans la même double page, `-1` si la page est seule.
 * Appariement identique à l’écran : couverture seule à droite, puis (2,3), (4,5)…,
 * quatrième de couverture seule à gauche.
 */
function facingPageIndex(pages: BookPage[], index: number): number {
  const pageNum = index + 1;
  if (pageNum < 2) return -1;
  const facing = pageNum % 2 === 0 ? index + 1 : index - 1;
  if (facing < 1 || facing >= pages.length) return -1;
  if (pages[facing]!.type === 'back-cover') return -1;
  return facing;
}

/** Page montrant une photo avec marges : elle appelle une pleine page en face. */
function isBorderedPhotoPage(page: BookPage): boolean {
  return page.type === 'photo-note' || page.type === 'audio' || page.type === 'video';
}

/**
 * Pleine page (`FP`) ou photo à marges (`M`), décidé **sur la double page** : ce qui compte
 * est la page d’en face, pas la précédente. Une photo qui fait face à une page bordée
 * (petit mot illustré, audio, vidéo) passe en pleine page, même si la double page
 * précédente en contenait déjà une — la répétition d’une double page à l’autre ne se voit
 * pas, deux pages bordées côte à côte si.
 *
 * Deuxième passe séparée : décider la variante demande de connaître la page suivante quand
 * la photo ouvre la double page, ce qu’une passe unique ne permet pas. L’insertion de la
 * page d’ouverture ne dépendant pas des variantes, la pagination est déjà figée ici.
 *
 * Quand la page d’en face ne tranche pas (page de titre, petit mot texte, page seule),
 * on garde l’alternance de séquence historique, pour la variété.
 */
function assignPhotoFullVariants(pages: BookPage[]): void {
  let lastWasFP = false;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    if (page.type !== 'photo-full') {
      if (isBorderedPhotoPage(page)) lastWasFP = false;
      continue;
    }

    const facing = facingPageIndex(pages, i);
    const facingPage = facing >= 0 ? pages[facing]! : null;

    if (facingPage && isBorderedPhotoPage(facingPage)) {
      page.variant = 'FP';
    } else if (facingPage?.type === 'photo-full' && facing < i) {
      // Page de gauche déjà décidée : la droite la complète.
      page.variant = facingPage.variant === 'FP' ? 'M' : 'FP';
    } else {
      page.variant = lastWasFP ? 'M' : 'FP';
    }

    lastWasFP = page.variant === 'FP';
  }
}

function resolutionFromThumbnailUrl(url: string | null): { width: number; height: number } | undefined {
  if (!url) return undefined;
  const lower = url.toLowerCase();
  const w =
    lower.match(/[?&]w=(\d+)/)?.[1] ??
    lower.match(/[?&]width=(\d+)/)?.[1];
  const h =
    lower.match(/[?&]h=(\d+)/)?.[1] ??
    lower.match(/[?&]height=(\d+)/)?.[1];
  if (w && h) {
    const width = Number.parseInt(w, 10);
    const height = Number.parseInt(h, 10);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
  }
  return undefined;
}

function getResolutionFromThumbnail(memory: Memory): { width: number; height: number } | undefined {
  return resolutionFromThumbnailUrl(memory.thumbnail_url);
}

function memoryToPage(memory: Memory): BookPage {
  switch (memory.type) {
    case 'photo': {
      void getResolutionFromThumbnail(memory);
      if (estimateBookLines(memory.content ?? '') > 3) {
        return { type: 'photo-note', memory };
      }
      return { type: 'photo-full', memory, variant: 'M' };
    }
    case 'text':
      return { type: 'quote', memory };
    case 'voice':
      return { type: 'audio', memory };
    case 'video':
      return { type: 'video', memory };
  }
}

function toPageSpecs(input: Memory[] | BookPageMemorySpec[]): BookPageMemorySpec[] {
  if (input.length === 0) return [];
  const first = input[0] as Memory | BookPageMemorySpec;
  if (first && typeof first === 'object' && 'memory' in first && !('type' in first)) {
    return input as BookPageMemorySpec[];
  }
  return (input as Memory[]).map(memory => ({ memory }));
}

export type BuildBookPagesOptions = {
  /**
   * Livre réorganisé à la main (`Book.pageOrderMode === 'manual'`) : respecter l’ordre
   * reçu au lieu de retrier par `created_at`. Défaut `false` — les livres jamais
   * réorganisés gardent exactement le comportement chronologique d’origine.
   */
  preserveOrder?: boolean;
};

export function buildBookPages(
  child: Child,
  memories: Memory[] | BookPageMemorySpec[],
  opts?: BuildBookPagesOptions,
): BookPage[] {
  const specs = toPageSpecs(memories);
  const preserveOrder = opts?.preserveOrder === true;
  const sorted = preserveOrder
    ? specs
    : [...specs].sort(
        (a, b) => new Date(a.memory.created_at).getTime() - new Date(b.memory.created_at).getTime(),
      );

  const pages: BookPage[] = [{ type: 'cover', child }];
  const chapterPlans = planBookChapters(sorted.map(s => s.memory));
  const chapterStarts = bookChapterStarts(chapterPlans);
  const chapterEmitted = new Set<string>();

  for (const { memory, photoRef } of sorted) {
    const chapterStart = chapterStarts.get(memory.id);
    if (chapterStart && !chapterEmitted.has(memory.id)) {
      chapterEmitted.add(memory.id);
      pages.push({
        type: 'chapter',
        month: chapterStart.label,
        chapterNum: chapterStart.chapterNum,
      });
    }

    const page = memoryToPage(memory);
    const ref = photoRef?.trim() || undefined;
    // Seules les pages photo portent un slot d’album.
    pages.push(
      ref && (page.type === 'photo-full' || page.type === 'photo-note')
        ? { ...page, photoRef: ref }
        : page,
    );
  }

  pages.push({ type: 'back-cover' });

  assignPhotoFullVariants(pages);

  return pages;
}
