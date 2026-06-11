import type { Child } from '@/types/local';
import { childDisplayGivenName } from '@/utils/childDisplayName';

/** Entre chaque enfant sur le fil. */
const FAMILY_CHILDREN_SEP = ' - ';

function parseIsoDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Mois complets entre naissance et date événement (fuseau local, comme `formatAgeAtMemory`).
 */
function totalMonthsBetween(birth: Date, event: Date): number {
  let months =
    (event.getFullYear() - birth.getFullYear()) * 12 + (event.getMonth() - birth.getMonth());
  if (event.getDate() < birth.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Calcule années et mois entre birthdate et atDate (ISO). `null` si invalide ou avant naissance. */
export function computeChildAge(
  birthdate: string,
  atDate: string,
): { years: number; months: number } | null {
  const birth = parseIsoDate(birthdate);
  const event = parseIsoDate(atDate);
  if (!birth || !event || event < birth) return null;

  const totalMonths = totalMonthsBetween(birth, event);
  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
  };
}

export type FormatAgeOptions = {
  /** 3+ enfants sur le fil : `a` / `m` au lieu de `ans` / `mois`. */
  compact?: boolean;
};

/** Formate un âge selon `docs/specs/family-ages-display.md`. */
export function formatAge(years: number, months: number, opts?: FormatAgeOptions): string {
  const compact = opts?.compact === true;
  const totalMonths = years * 12 + months;
  const yearUnit = compact ? 'a' : 'ans';
  const monthUnit = compact ? 'm' : 'mois';

  if (totalMonths < 24) {
    return `${totalMonths} ${monthUnit}`;
  }

  if (years > 5) {
    return `${years} ${yearUnit}`;
  }

  if (years >= 2) {
    if (months === 0) return `${years} ${yearUnit}`;
    return `${years} ${yearUnit} ${months} ${monthUnit}`;
  }

  if (months === 0) {
    if (compact) return `${years} a`;
    return `${years} an${years > 1 ? 's' : ''}`;
  }
  return `${years} ${yearUnit} ${months} ${monthUnit}`;
}

/** Tri aîné → cadet (birthdate croissante ; sans date en fin). */
export function sortChildrenByBirthdateAsc(children: Child[]): Child[] {
  return [...children].sort((a, b) => {
    const ba = (a.birthdate ?? '').trim();
    const bb = (b.birthdate ?? '').trim();
    if (ba && bb) {
      const cmp = ba.localeCompare(bb);
      if (cmp !== 0) return cmp;
    } else if (ba) return -1;
    else if (bb) return 1;
    return a.id.localeCompare(b.id);
  });
}

type EligibleChild = {
  givenName: string;
  years: number;
  months: number;
};

function resolveFamilyChildLabel(givenName: string, allGivenNames: string[]): string {
  if (allGivenNames.length <= 1) return givenName;

  const initial = givenName.charAt(0).toLocaleUpperCase('fr-FR');
  const hasCollision = allGivenNames.some(
    other =>
      other !== givenName &&
      other.charAt(0).toLocaleUpperCase('fr-FR') === initial,
  );

  if (hasCollision) return givenName.slice(0, 3);
  return `${initial}.`;
}

function collectEligibleChildren(children: Child[], memoryDate: string): EligibleChild[] {
  const sorted = sortChildrenByBirthdateAsc(children);
  const eligible: EligibleChild[] = [];

  for (const child of sorted) {
    const birthdate = child.birthdate?.trim();
    if (!birthdate) continue;
    const age = computeChildAge(birthdate, memoryDate);
    if (!age) continue;
    const givenName = childDisplayGivenName(child.name);
    if (!givenName) continue;
    eligible.push({ givenName, ...age });
  }

  return eligible;
}

/**
 * Ligne « prénom · âge » pour tous les enfants de la famille à la date du souvenir.
 * Retourne `""` si aucun enfant éligible.
 */
export function formatFamilyAgesLine(children: Child[], memoryDate: string): string {
  if (!children.length || !memoryDate.trim()) return '';

  const eligible = collectEligibleChildren(children, memoryDate);
  if (eligible.length === 0) return '';

  const givenNames = eligible.map(e => e.givenName);
  const useFullName = eligible.length === 1;
  const useCompactAge = eligible.length > 2;

  return eligible
    .map(e => {
      const label = useFullName
        ? e.givenName
        : resolveFamilyChildLabel(e.givenName, givenNames);
      const age = formatAge(e.years, e.months, { compact: useCompactAge });
      return `${label} ${age}`;
    })
    .join(FAMILY_CHILDREN_SEP);
}
