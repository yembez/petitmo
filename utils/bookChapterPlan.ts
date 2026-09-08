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
 * Période couverte par le livre, bornes seules — les mois intermédiaires ne sont pas
 * énumérés : un livre sur un an tiendrait sinon sur trois lignes de page de titre.
 *
 * - Un seul mois : « avril 2025 »
 * - Même année : « janvier – mars 2025 »
 * - Changement d’année : « décembre 2024 – février 2025 »
 */
export function formatBookChapterLabel(groups: BookChapterMonthGroup[]): string {
  if (groups.length === 0) return '';
  const first = groups[0]!;
  const last = groups[groups.length - 1]!;
  if (groups.length === 1) return singleMonthLabel(first);

  const firstMonth = monthNameFr(new Date(first.memories[0]!.created_at));
  const lastMonth = monthNameFr(new Date(last.memories[0]!.created_at));
  if (first.year === last.year) {
    return `${firstMonth} – ${lastMonth} ${first.year}`;
  }
  return `${firstMonth} ${first.year} – ${lastMonth} ${last.year}`;
}

/**
 * Page d’ouverture du livre — **une seule**, quel que soit l’ordre des pages.
 *
 * Il n’y a plus de chapitrage par mois. Un découpage daté ne survit pas à une
 * réorganisation manuelle : les mois n’y sont plus contigus, un même mois retomberait
 * dans deux chapitres et les périodes se chevaucheraient. Surtout, le nombre de pages
 * imprimées dépendrait alors de l’ordre choisi — inacceptable puisqu’il détermine le prix.
 * Une page d’ouverture unique reste vraie et donne un compte de pages stable.
 *
 * 0 ou 1 souvenir → aucune page d’ouverture.
 */
export function planBookChapters(memories: Memory[]): BookChapterPlan[] {
  if (memories.length <= 1) return [];

  // Chronologie utilisée pour la seule période affichée ; l’ancrage suit l’ordre du livre.
  const groups = groupMemoriesByCalendarMonth(sortMemoriesChronologically(memories));
  if (groups.length === 0) return [];

  return [{ label: formatBookChapterLabel(groups), memories: [...memories] }];
}

/** Premier souvenir du livre → métadonnées de la page d’ouverture. */
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
