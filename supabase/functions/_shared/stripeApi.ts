/** Appels Stripe REST (pas de SDK) — Edge Deno. */

export type StripeJson = Record<string, unknown>;

function cleanSecret(raw: string | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

export function stripeSecretKey(): string {
  return cleanSecret(Deno.env.get('STRIPE_SECRET_KEY'));
}

export function stripeWebhookSecret(): string {
  return cleanSecret(Deno.env.get('STRIPE_WEBHOOK_SECRET'));
}

export function isStripePrintBypass(): boolean {
  const v = (Deno.env.get('STRIPE_PRINT_BYPASS') ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export async function stripePost(
  path: string,
  params: Record<string, string>,
  idempotencyKey?: string,
): Promise<{ status: number; json: StripeJson }> {
  const secret = stripeSecretKey();
  if (!secret) {
    return { status: 503, json: { error: { message: 'STRIPE_SECRET_KEY missing' } } };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const res = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params),
  });
  const json = (await res.json().catch(() => ({}))) as StripeJson;
  return { status: res.status, json };
}

export async function stripeGet(path: string): Promise<{ status: number; json: StripeJson }> {
  const secret = stripeSecretKey();
  if (!secret) {
    return { status: 503, json: { error: { message: 'STRIPE_SECRET_KEY missing' } } };
  }
  const res = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, '')}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = (await res.json().catch(() => ({}))) as StripeJson;
  return { status: res.status, json };
}

function stripeErrMessage(json: StripeJson): string {
  const err = json.error;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return 'Stripe error';
}

export function stripeId(json: StripeJson): string {
  return typeof json.id === 'string' ? json.id : '';
}

export function nestedString(json: StripeJson, key: string): string {
  const v = json[key];
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { id?: unknown }).id === 'string') {
    return (v as { id: string }).id;
  }
  return '';
}

export function stripeErrorOrNull(status: number, json: StripeJson): string | null {
  if (status >= 200 && status < 300 && !json.error) return null;
  return stripeErrMessage(json);
}

function hexFromBuffer(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Vérifie `Stripe-Signature` (HMAC SHA-256, fenêtre 5 min). */
export async function verifyStripeWebhookSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!payload || !header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim());
  let timestamp = '';
  const v1: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const val = p.slice(eq + 1);
    if (k === 't') timestamp = val;
    if (k === 'v1') v1.push(val);
  }
  if (!timestamp || v1.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > 300) return false;

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = hexFromBuffer(sig);
  return v1.some((got) => timingSafeEqualHex(got, expected));
}
