import type { Memory } from '@/types/local';

/** Un mois calendaire regroupant des souvenirs triés chronologiquement. */
export type BookChapterMonthGroup = {
  year: number;
  month: number;
  memories: Memory[];
};

export type BookChapterPlan = {
  /** Libellé période affiché sur la page chapitre (ex. « janvier · mars 2025 »). */
  label: string;
  memories: Memory[];
};

function sortMemoriesChronologically(memories: Memory[]): Memory[] {
  return [...memories].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

/** Regroupe des souvenirs triés par mois calendaire (fuseau local). */
export function groupMemoriesByCalendarMonth(sortedMemories: Memory[]): BookChapterMonthGroup[] {
  const groups: BookChapterMonthGroup[] = [];
  for (const memory of sortedMemories) {
    const d = new Date(memory.created_at);
    const year = d.getFullYear();
    const month = d.getMonth();
    const last = groups[groups.length - 1];
    if (last && last.year === year && last.month === month) {
      last.memories.push(memory);
    } else {
      groups.push({ year, month, memories: [memory] });
    }
  }
  return groups;
}

function monthNameFr(d: Date): string {
  return d.toLocaleDateString('fr-FR', { month: 'long' });
}

function singleMonthLabel(group: BookChapterMonthGroup): string {
  const d = new Date(group.memories[0]!.created_at);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/**
 * Libellé fusionné pour un ou plusieurs mois consécutifs.
 * - Un seul mois : « avril 2025 »
 * - Plusieurs mois, même année : « janvier · février · mars 2025 »
 * - Changement d’année : « décembre 2024 · janvier 2025 »
 */
export function formatBookChapterLabel(groups: BookChapterMonthGroup[]): string {
  if (groups.length === 0) return '';
  if (groups.length === 1) return singleMonthLabel(groups[0]!);

  const years = new Set(groups.map(g => g.year));
  if (years.size === 1) {
    const monthParts = groups.map(g => monthNameFr(new Date(g.memories[0]!.created_at)));
    return `${monthParts.join(' · ')} ${groups[0]!.year}`;
  }

  return groups
    .map(g => {
      const d = new Date(g.memories[0]!.created_at);
      return `${monthNameFr(d)} ${d.getFullYear()}`;
    })
    .join(' · ');
}

function assignChapterIds(groups: BookChapterMonthGroup[]): number[] {
  const isAnchor = groups.map(g => g.memories.length >= 2);
  const chapterIds = new Array<number>(groups.length).fill(-1);
  const leadingSparse: number[] = [];
  let nextChapterId = 0;
  let lastAnchorIdx = -1;

  for (let i = 0; i < groups.length; i++) {
    if (isAnchor[i]) {
      const chapterId = nextChapterId++;
      chapterIds[i] = chapterId;
      for (const sparseIdx of leadingSparse) {
        chapterIds[sparseIdx] = chapterId;
      }
      leadingSparse.length = 0;
      lastAnchorIdx = i;
      continue;
    }

    if (lastAnchorIdx >= 0) {
      chapterIds[i] = chapterIds[lastAnchorIdx]!;
    } else {
      leadingSparse.push(i);
    }
  }

  return chapterIds;
}

function buildPlansFromAssignments(
  groups: BookChapterMonthGroup[],
  chapterIds: number[],
): BookChapterPlan[] {
  const plans: BookChapterPlan[] = [];
  let currentId = -1;
  let currentGroups: BookChapterMonthGroup[] = [];

  const flush = () => {
    if (currentGroups.length === 0) return;
    const memories = currentGroups.flatMap(g => g.memories);
    plans.push({
      label: formatBookChapterLabel(currentGroups),
      memories,
    });
    currentGroups = [];
  };

  for (let i = 0; i < groups.length; i++) {
    const cid = chapterIds[i]!;
    if (cid !== currentId) {
      flush();
      currentId = cid;
    }
    currentGroups.push(groups[i]!);
  }
  flush();

  return plans;
}

/**
 * Planifie les chapitres du livre à partir des souvenirs inclus.
 *
 * Règles :
 * - 0 ou 1 souvenir → aucune page chapitre
 * - Mois avec ≥ 2 souvenirs → ancre (nouveau chapitre ou extension)
 * - Mois avec 1 souvenir → fusion dans l’ancre précédente, ou la prochaine en tête de livre
 * - Tous les mois à 1 souvenir → un seul chapitre fusionné
 */
export function planBookChapters(memories: Memory[]): BookChapterPlan[] {
  const sorted = sortMemoriesChronologically(memories);
  if (sorted.length <= 1) return [];

  const groups = groupMemoriesByCalendarMonth(sorted);
  if (groups.length === 0) return [];

  const hasAnchor = groups.some(g => g.memories.length >= 2);
  if (!hasAnchor) {
    return [{ label: formatBookChapterLabel(groups), memories: sorted }];
  }

  const chapterIds = assignChapterIds(groups);
  return buildPlansFromAssignments(groups, chapterIds);
}

/** Premier souvenir de chaque chapitre → métadonnées page chapitre. */
export function bookChapterStarts(
  plans: BookChapterPlan[],
): Map<string, { label: string; chapterNum: number }> {
  const starts = new Map<string, { label: string; chapterNum: number }>();
  plans.forEach((plan, index) => {
    const first = plan.memories[0];
    if (!first) return;
    starts.set(first.id, { label: plan.label, chapterNum: index + 1 });
  });
  return starts;
}
