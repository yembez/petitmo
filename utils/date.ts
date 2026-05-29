const MONTH_NAMES_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const;

const MONTH_ABBR_FR = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
] as const;

/** En-tête Capturer — ex. « 29 mai » (jour + mois abrégé). */
export function formatCaptureHeaderDate(date: Date = new Date()): string {
  return `${date.getDate()} ${MONTH_ABBR_FR[date.getMonth()]}`;
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const day = date.getDate();
  const month = MONTH_NAMES_FR[date.getMonth()];
  return `${day} ${month}`;
}

/** Ex. « 12 mars 2026 » — pour l’en-tête des souvenirs */
export function formatDateLong(dateString: string): string {
  const date = new Date(dateString);
  const day = date.getDate();
  const month = MONTH_NAMES_FR[date.getMonth()];
  return `${day} ${month} ${date.getFullYear()}`;
}

/** Même jour calendaire (fuseau local, cohérent avec `formatDateLong`) */
export function isSameCalendarDay(isoA: string, isoB: string): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Pastille bas-droite sur le média : date de prise + lieu EXIF (géocodé) si disponible.
 */
export function formatCaptureStickerLabel(capturedIso: string, location?: string | null): string {
  return formatDateLong(capturedIso);
}

function monthsBetweenBirthAndEvent(birth: Date, event: Date): number {
  let months =
    (event.getFullYear() - birth.getFullYear()) * 12 + (event.getMonth() - birth.getMonth());
  if (event.getDate() < birth.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Âge de l’enfant à la date du souvenir (fidèle à la chronologie du fil).
 */
export function formatAgeAtMemory(birthdate: string | undefined, memoryDateIso: string): string {
  if (!birthdate) return '';
  const birth = new Date(birthdate);
  const event = new Date(memoryDateIso);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(event.getTime()) || event < birth) {
    return '';
  }

  const diffMs = event.getTime() - birth.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const totalMonths = monthsBetweenBirthAndEvent(birth, event);

  if (totalMonths < 1) {
    if (diffDays < 1) return 'nouveau-né';
    if (diffDays < 7) return `${diffDays} jour${diffDays > 1 ? 's' : ''}`;
    const w = Math.floor(diffDays / 7);
    return `${w} semaine${w > 1 ? 's' : ''}`;
  }

  if (totalMonths < 12) {
    return `${totalMonths} mois`;
  }

  const years = Math.floor(totalMonths / 12);
  const mo = totalMonths % 12;
  if (mo === 0) return `${years} an${years > 1 ? 's' : ''}`;
  return `${years} an${years > 1 ? 's' : ''} ${mo} mois`;
}

/** Ligne d’en-tête : date · âge à la date · lieu (optionnel) */
export function formatMemoryContextLine(
  createdAt: string,
  childBirthdate: string | undefined,
  location: string | null | undefined
): string {
  const parts: string[] = [formatDateLong(createdAt)];
  const age = formatAgeAtMemory(childBirthdate, createdAt);
  if (age) parts.push(age);
  const loc = location?.trim();
  if (loc) parts.push(loc);
  return parts.join(' · ');
}

/**
 * Découpe un libellé type géocodage « Ville (Région) » pour typographies distinctes.
 * Sinon tout le texte est considéré comme le lieu principal (ville / pays).
 */
/**
 * Lieu compact pour livres / légendes (retire le suffixe « Ville (Région) » issu du géocodage).
 */
export function formatBookLocationShort(location: string | null | undefined): string {
  const raw = location?.trim();
  if (!raw) return '';
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export function parseLocationForHeader(location: string | null | undefined): {
  placeBold: string;
  regionNormal: string | null;
} {
  const trimmed = location?.trim();
  if (!trimmed) return { placeBold: '', regionNormal: null };
  const m = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    return { placeBold: m[1].trim(), regionNormal: m[2].trim() };
  }
  return { placeBold: trimmed, regionNormal: null };
}

export function calculateAge(birthdate: string): string {
  const birth = new Date(birthdate);
  const now = new Date();

  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();

  if (days < 0) {
    months--;
    const lastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += lastMonth.getDate();
  }

  if (months < 0) {
    years--;
    months += 12;
  }

  const totalMonths = years * 12 + months;

  if (totalMonths < 12) {
    // Calculer les jours depuis le dernier "anniversaire de mois"
    const lastMonthBirthday = new Date(birth);
    lastMonthBirthday.setMonth(birth.getMonth() + totalMonths);
    const daysInCurrentMonth = Math.floor((now.getTime() - lastMonthBirthday.getTime()) / (1000 * 60 * 60 * 24));
    const weeksInCurrentMonth = Math.floor(daysInCurrentMonth / 7);

    // Afficher mois + semaines (jusqu'à 4 semaines max, à la 5e on passe au mois suivant)
    const parts: string[] = [];
    if (totalMonths > 0) parts.push(`${totalMonths} mois`);
    if (weeksInCurrentMonth > 0 && weeksInCurrentMonth <= 4) {
      parts.push(`${weeksInCurrentMonth} semaine${weeksInCurrentMonth > 1 ? 's' : ''}`);
    }
    return parts.join(' et ') || 'nouveau-né';
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} an${years > 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} mois`);

  return parts.join(' ') || 'nouveau-né';
}

/** Pilule âge Capturer — « mois » → « m », « semaine(s) » → « s » (ex. « 3 m et 2 s »). */
export function formatCaptureChildAge(birthdate: string | null | undefined): string {
  if (!birthdate?.trim()) return '';
  return calculateAge(birthdate)
    .replace(/\bmois\b/g, 'm')
    .replace(/\bsemaines\b/g, 's')
    .replace(/\bsemaine\b/g, 's');
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
