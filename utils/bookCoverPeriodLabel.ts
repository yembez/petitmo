import { getLocalMemoryById } from '@/lib/localDb';
import type { Book } from '@/services/books';

function monthNameFrLower(d: Date): string {
  const raw = d.toLocaleDateString('fr-FR', { month: 'long' });
  return raw.replace(/^\w/u, c => c.toLocaleLowerCase('fr-FR'));
}

function capitalizeFirstLetterFr(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/[a-zA-ZÀ-ÿ]/u.test(c)) {
      return s.slice(0, i) + c.toLocaleUpperCase('fr-FR') + s.slice(i + 1);
    }
  }
  return s;
}

function periodLabelFromDates(isoList: string[]): string {
  if (isoList.length === 0) {
    const d = new Date();
    return capitalizeFirstLetterFr(`${monthNameFrLower(d)} ${d.getFullYear()}`);
  }

  const sorted = [...isoList].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const d0 = new Date(sorted[0]);
  const d1 = new Date(sorted[sorted.length - 1]);
  const label0 = monthNameFrLower(d0);
  const label1 = monthNameFrLower(d1);
  const y0 = d0.getFullYear();
  const y1 = d1.getFullYear();

  let line: string;
  if (y0 === y1) {
    line = d0.getMonth() === d1.getMonth() ? `${label0} ${y0}` : `${label0} – ${label1} ${y1}`;
  } else {
    line = `${label0} ${y0} – ${label1} ${y1}`;
  }
  return capitalizeFirstLetterFr(line);
}

/** Période affichée sur la mini-couverture (lecture SQLite locale uniquement). */
export function bookCoverPeriodLabelForBook(book: Book): string {
  const dates: string[] = [];
  for (const id of book.memoryIds) {
    const m = getLocalMemoryById(id);
    const iso = m?.created_at?.trim();
    if (iso) dates.push(iso);
  }
  return periodLabelFromDates(dates);
}
