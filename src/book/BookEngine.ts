import type { Child, Memory } from '@/types/local';
export type { Memory, Child } from '@/types/local';
import { bookChapterStarts, planBookChapters } from '@/utils/bookChapterPlan';

export type BookPage =
  | { type: 'cover'; child: Child }
  | { type: 'chapter'; month: string; chapterNum: number }
  | { type: 'photo-full'; memory: Memory }
  | { type: 'photo-note'; memory: Memory }
  | { type: 'quote'; memory: Memory }
  | { type: 'audio'; memory: Memory }
  | { type: 'video'; memory: Memory }
  | { type: 'back-cover' };

function countWords(s: string | null | undefined): number {
  const t = (s ?? '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
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
      const words = countWords(memory.content);
      if (words > 10) {
        return { type: 'photo-note', memory };
      }
      return { type: 'photo-full', memory };
    }
    case 'text':
      return { type: 'quote', memory };
    case 'voice':
      return { type: 'audio', memory };
    case 'video':
      return { type: 'video', memory };
  }
}

export function buildBookPages(child: Child, memories: Memory[]): BookPage[] {
  const sorted = [...memories].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const pages: BookPage[] = [{ type: 'cover', child }];
  const chapterPlans = planBookChapters(sorted);
  const chapterStarts = bookChapterStarts(chapterPlans);

  for (const memory of sorted) {
    const chapterStart = chapterStarts.get(memory.id);
    if (chapterStart) {
      pages.push({
        type: 'chapter',
        month: chapterStart.label,
        chapterNum: chapterStart.chapterNum,
      });
    }
    pages.push(memoryToPage(memory));
  }

  pages.push({ type: 'back-cover' });

  return pages;
}
