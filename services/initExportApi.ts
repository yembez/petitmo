import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

export function initExportFunctionsUrl(): string {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/init-export`;
}

export function guestUploadUrlsFunctionsUrl(): string {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/guest-upload-urls`;
}

export function isInitExportConfigured(): boolean {
  return !!(supabaseUrl?.trim() && supabaseAnonKey?.trim());
}

/** POST `init-export` (pdf_export, print_order, …). */
export async function postInitExport(body: Record<string, unknown>): Promise<{
  ok: true;
  status: number;
  json: Record<string, unknown>;
}> {
  if (!isInitExportConfigured()) {
    throw new Error('Supabase non configuré (URL / clé anon) pour init-export.');
  }
  const res = await fetch(initExportFunctionsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: true, status: res.status, json };
}

/** POST `guest-upload-urls` (retourne signed URLs d'upload Storage). */
export async function postGuestUploadUrls(body: Record<string, unknown>): Promise<{
  ok: true;
  status: number;
  json: Record<string, unknown>;
}> {
  if (!isInitExportConfigured()) {
    throw new Error('Supabase non configuré (URL / clé anon) pour guest-upload-urls.');
  }
  const res = await fetch(guestUploadUrlsFunctionsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: true, status: res.status, json };
}
