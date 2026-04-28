import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

function crmPrefillUrl(): string {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/crm-prefill`;
}

function crmMarketingUrl(): string {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/crm-marketing-opt-in`;
}

export type CrmPrefillResult = {
  full_name: string | null;
  address_json: Record<string, unknown> | null;
};

/**
 * Préremplissage : lecture CRM par email (Edge, service role côté serveur).
 * Retourne `null` si indisponible ou aucune ligne.
 */
export async function fetchCrmPrefillByEmail(email: string): Promise<CrmPrefillResult | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !supabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
    return null;
  }
  const res = await fetch(crmPrefillUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify({ email: trimmed }),
  });
  if (!res.ok) {
    return null;
  }
  const json = (await res.json()) as { full_name?: unknown; address_json?: unknown };
  if (!json || typeof json !== 'object') return null;
  const full_name = typeof json.full_name === 'string' ? json.full_name : null;
  const raw = json.address_json;
  const address_json =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  return { full_name, address_json };
}

/**
 * Après commande : opt-in marketing (Edge, service role).
 */
export async function setCrmMarketingOptInForEmail(email: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !supabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
    throw new Error('Configuration Supabase manquante.');
  }
  const res = await fetch(crmMarketingUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify({ email: trimmed }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    const msg = typeof err.error === 'string' ? err.error : `crm-marketing-opt-in (${res.status})`;
    throw new Error(msg);
  }
}
