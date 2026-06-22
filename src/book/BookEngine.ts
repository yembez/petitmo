import type { Child, Memory } from '@/types/local';
export type { Memory, Child } from '@/types/local';
import { bookChapterStarts, planBookChapters } from '@/utils/bookChapterPlan';
import { estimateBookLines } from '@/utils/textLimits';

export type PhotoFullVariant = 'FP' | 'M';

export type BookPage =
  | { type: 'cover'; child: Child }
  | { type: 'chapter'; month: string; chapterNum: number }
  | { type: 'photo-full'; memory: Memory; variant: PhotoFullVariant }
  | { type: 'photo-note'; memory: Memory }
  | { type: 'quote'; memory: Memory }
  | { type: 'audio'; memory: Memory }
  | { type: 'video'; memory: Memory }
  | { type: 'back-cover' };

/** Pages paire/impaire face à face dans un spread (hors couverture seule). */
function isSpreadFacingWithPreviousPage(pageNum: number): boolean {
  const prev = pageNum - 1;
  return prev >= 2 && prev % 2 === 0;
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

function assignPhotoFullVariant(
  pages: BookPage[],
  lastWasFP: boolean
): { variant: PhotoFullVariant; lastWasFP: boolean } {
  let variant: PhotoFullVariant = lastWasFP ? 'M' : 'FP';
  const nextPageNum = pages.length + 1;
  const prevPage = pages[pages.length - 1];
  if (
    variant === 'FP' &&
    isSpreadFacingWithPreviousPage(nextPageNum) &&
    prevPage?.type === 'photo-full' &&
    prevPage.variant === 'FP'
  ) {
    variant = 'M';
  }
  return { variant, lastWasFP: variant === 'FP' };
}

export function buildBookPages(child: Child, memories: Memory[]): BookPage[] {
  const sorted = [...memories].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const pages: BookPage[] = [{ type: 'cover', child }];
  const chapterPlans = planBookChapters(sorted);
  const chapterStarts = bookChapterStarts(chapterPlans);
  let lastWasFP = false;

  for (const memory of sorted) {
    const chapterStart = chapterStarts.get(memory.id);
    if (chapterStart) {
      pages.push({
        type: 'chapter',
        month: chapterStart.label,
        chapterNum: chapterStart.chapterNum,
      });
    }

    const page = memoryToPage(memory);
    if (page.type === 'photo-full') {
      const assigned = assignPhotoFullVariant(pages, lastWasFP);
      lastWasFP = assigned.lastWasFP;
      pages.push({ ...page, variant: assigned.variant });
    } else {
      if (page.type === 'photo-note' || page.type === 'audio' || page.type === 'video') {
        lastWasFP = false;
      }
      pages.push(page);
    }
  }

  pages.push({ type: 'back-cover' });

  return pages;
}
