import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemoryRow } from './pdf/memoryRow';
import { bookPdfLocationLabel, dateFrCaps, formatAgeAtMemory } from './pdf/maquetteAlign';

export type PublicMediaDisplayContext = {
  dateLine: string;
  ageLine: string;
  locationLine: string;
};

type TokenDisplayRow = {
  token: string;
  media_id: string;
  memory_created_at: string | null;
  memory_location: string | null;
  child_birthdate: string | null;
};

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null || typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function formatPublicMediaDisplayContext(
  createdAt: string | null | undefined,
  location: string | null | undefined,
  childBirthdate: string | null | undefined,
): PublicMediaDisplayContext {
  const iso = trimOrNull(createdAt ?? null);
  const birth = trimOrNull(childBirthdate ?? null);
  const dateLine = iso ? dateFrCaps(iso) : '';
  const ageLine = iso ? formatAgeAtMemory(birth, iso) : '';
  const locationLine = bookPdfLocationLabel(location);
  return { dateLine, ageLine, locationLine };
}

export async function syncPublicMediaTokenDisplayContext(
  supabase: SupabaseClient,
  token: string,
  memory: Pick<MemoryRow, 'created_at' | 'location'>,
  childBirthdate: string | null | undefined,
): Promise<void> {
  const { error } = await supabase
    .from('public_media_tokens')
    .update({
      memory_created_at: trimOrNull(memory.created_at),
      memory_location: trimOrNull(memory.location),
      child_birthdate: trimOrNull(childBirthdate ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq('token', token);
  if (error) {
    throw new Error(error.message);
  }
}

async function fetchMemoryFallback(
  supabase: SupabaseClient,
  mediaId: string,
): Promise<{ created_at: string; location: string | null; child_birthdate: string | null } | null> {
  const { data: memory, error: memErr } = await supabase
    .from('memories')
    .select('created_at, location, child_id')
    .eq('id', mediaId)
    .maybeSingle();
  if (memErr || !memory) return null;

  let childBirthdate: string | null = null;
  const childId = (memory as { child_id?: string }).child_id;
  if (childId) {
    const { data: child } = await supabase
      .from('children')
      .select('birthdate')
      .eq('id', childId)
      .maybeSingle();
    childBirthdate = trimOrNull((child as { birthdate?: string | null } | null)?.birthdate ?? null);
  }

  return {
    created_at: String((memory as { created_at: string }).created_at),
    location: trimOrNull((memory as { location?: string | null }).location ?? null),
    child_birthdate: childBirthdate,
  };
}

export async function resolvePublicMediaDisplayContext(
  supabase: SupabaseClient,
  row: TokenDisplayRow,
): Promise<PublicMediaDisplayContext> {
  let createdAt = row.memory_created_at;
  let location = row.memory_location;
  let birthdate = row.child_birthdate;

  if (!createdAt) {
    const fallback = await fetchMemoryFallback(supabase, row.media_id);
    if (fallback) {
      createdAt = fallback.created_at;
      location = location ?? fallback.location;
      birthdate = birthdate ?? fallback.child_birthdate;
    }
  }

  return formatPublicMediaDisplayContext(createdAt, location, birthdate);
}

export function escapePublicMediaHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let cachedLogoHtml: string | null = null;

/**
 * Logo Petit Cœur (même lockup que l’app : `logo_petit_coeur_trois_points_ink`).
 * Inline en data URI : la page QR est une visite unique, on évite une seconde requête.
 */
export function petitCoeurLogoHtml(): string {
  if (!cachedLogoHtml) {
    const png = readFileSync(join(__dirname, 'brand', 'petit-coeur-logo.png'));
    const src = `data:image/png;base64,${png.toString('base64')}`;
    cachedLogoHtml = `<img class="logo-img" src="${src}" width="1024" height="188" alt="Petit Cœur"/>`;
  }
  return cachedLogoHtml;
}

/** Titre + date / âge hors carte — aligné à droite, sur la ligne du logo Petit Cœur. */
export function publicMediaPageHeaderHtml(
  kind: 'audio' | 'video',
  ctx: PublicMediaDisplayContext,
): string {
  const kindLabel = kind === 'video' ? 'Souvenir vidéo' : 'Souvenir audio';
  const lines: string[] = [
    `<div class="page-header-kind">${escapePublicMediaHtml(kindLabel)}</div>`,
  ];
  if (ctx.dateLine) {
    lines.push(`<div class="page-header-date">${escapePublicMediaHtml(ctx.dateLine)}</div>`);
  }
  if (ctx.ageLine) {
    lines.push(`<div class="page-header-age">${escapePublicMediaHtml(ctx.ageLine)}</div>`);
  }
  if (ctx.locationLine) {
    lines.push(`<div class="page-header-loc">${escapePublicMediaHtml(ctx.locationLine)}</div>`);
  }
  return `<div class="page-header-text">${lines.join('')}</div>`;
}
