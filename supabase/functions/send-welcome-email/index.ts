/**
 * Bienvenue compte gratuit — une fois (lifecycle_email_log account.welcome).
 * Auth utilisateur JWT ; skip device-user / comptes trop anciens (>72 h).
 * Secrets : RESEND_API_KEY (+ optionnel WELCOME_EMAIL_PHOTO_URL, LIFECYCLE_FROM_EMAIL).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { sendLifecycleEmail } from '../_shared/lifecycleEmail.ts';
import { resolveWelcomeFirstName } from '../_shared/welcomeEmailContent.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

/** Fenêtre après création : évite d’envoyer « Bienvenue » aux vieux comptes au 1er login post-deploy. */
const MAX_ACCOUNT_AGE_MS = 72 * 60 * 60 * 1000;

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt === anonKey) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const user = userData.user;
  const email = (user.email ?? '').toLowerCase().trim();
  if (!email || email.endsWith('@petitmo.local')) {
    return jsonRes({ ok: true, skipped: 'device_user' }, 200);
  }

  const createdAtMs = Date.parse(user.created_at ?? '');
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > MAX_ACCOUNT_AGE_MS) {
    return jsonRes({ ok: true, skipped: 'account_too_old' }, 200);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const firstName = resolveWelcomeFirstName(
    (user.user_metadata ?? {}) as Record<string, unknown>,
  );
  const photoUrl = (Deno.env.get('WELCOME_EMAIL_PHOTO_URL') ?? '').trim() || null;
  const siteUrl = (Deno.env.get('WELCOME_EMAIL_SITE_URL') ?? '').trim() || null;

  const mail = await sendLifecycleEmail({
    admin,
    userId: user.id,
    email,
    templateId: 'account.welcome',
    dedupeKey: 'once',
    vars: {
      firstName,
      photoUrl,
      siteUrl,
    },
  });

  return jsonRes({ ok: true, ...mail }, 200);
});
