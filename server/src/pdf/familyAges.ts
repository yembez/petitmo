/**
 * Âges famille pour légendes PDF — parité stricte avec `utils/childrenAge.ts` (maquette / fil).
 * Spec : `docs/specs/family-ages-display.md`.
 */

export type FamilyChildForAge = {
  name?: string | null;
  birthdate?: string | null;
};

const FAMILY_CHILDREN_SEP = ' - ';

function parseIsoDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeChildGivenName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function childDisplayGivenName(name: string | null | undefined): string {
  if (!name) return '';
  return normalizeChildGivenName(name);
}

function totalMonthsBetween(birth: Date, event: Date): number {
  let months =
    (event.getFullYear() - birth.getFullYear()) * 12 + (event.getMonth() - birth.getMonth());
  if (event.getDate() < birth.getDate()) months -= 1;
  return Math.max(0, months);
}

function computeChildAge(
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

function formatAge(years: number, months: number, opts?: { compact?: boolean }): string {
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

function sortChildrenByBirthdateAsc(children: FamilyChildForAge[]): FamilyChildForAge[] {
  return [...children].sort((a, b) => {
    const ba = (a.birthdate ?? '').trim();
    const bb = (b.birthdate ?? '').trim();
    if (ba && bb) {
      const cmp = ba.localeCompare(bb);
      if (cmp !== 0) return cmp;
    } else if (ba) return -1;
    else if (bb) return 1;
    return childDisplayGivenName(a.name).localeCompare(childDisplayGivenName(b.name));
  });
}

function resolveFamilyChildLabel(givenName: string, allGivenNames: string[]): string {
  if (allGivenNames.length <= 1) return givenName;
  const initial = givenName.charAt(0).toLocaleUpperCase('fr-FR');
  const hasCollision = allGivenNames.some(
    other =>
      other !== givenName && other.charAt(0).toLocaleUpperCase('fr-FR') === initial,
  );
  if (hasCollision) return givenName.slice(0, 3);
  return `${initial}.`;
}

type EligibleChild = {
  givenName: string;
  years: number;
  months: number;
};

function collectEligibleChildren(
  children: FamilyChildForAge[],
  memoryDate: string,
): EligibleChild[] {
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

/** Ligne « initiale · âge » pour tous les enfants — parité maquette. */
export function formatFamilyAgesLine(
  children: FamilyChildForAge[],
  memoryDate: string,
): string {
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
