import type { Child, Memory } from '@/types/local';
export type { Memory, Child } from '@/types/local';

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

function diffCalendarMonth(a: Date, b: Date): boolean {
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth();
}

function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
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

export function buildBookPages(child: Child, memories: Memory[]): BookPage[] {
  const sorted = [...memories].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const pages: BookPage[] = [{ type: 'cover', child }];

  let chapterNum = 0;
  let prev: Memory | null = null;

  for (const m of sorted) {
    const created = new Date(m.created_at);

    const isFirst = prev === null;
    const gapGt30 = prev !== null && diffDays(created, new Date(prev.created_at)) > 30;
    const monthChanged = prev !== null && diffCalendarMonth(created, new Date(prev.created_at));

    if (isFirst || gapGt30 || monthChanged) {
      chapterNum += 1;
      pages.push({
        type: 'chapter',
        month: monthLabel(created),
        chapterNum,
      });
    }

    switch (m.type) {
      case 'photo': {
        void getResolutionFromThumbnail(m);
        const words = countWords(m.content);
        if (words > 10) {
          pages.push({ type: 'photo-note', memory: m });
        } else {
          pages.push({ type: 'photo-full', memory: m });
        }
        break;
      }
      case 'text': {
        pages.push({ type: 'quote', memory: m });
        break;
      }
      case 'voice':
        pages.push({ type: 'audio', memory: m });
        break;
      case 'video':
        pages.push({ type: 'video', memory: m });
        break;
    }

    prev = m;
  }

  pages.push({ type: 'back-cover' });

  return pages;
}
