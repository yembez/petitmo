/**
 * Webhook Sentry → mail fondateur avec draft HITL.
 * Secrets : SENTRY_WEBHOOK_SECRET, RESEND_API_KEY,
 * optionnel SUPPORT_TO_EMAIL / SUPPORT_FROM_EMAIL.
 *
 * Jamais d’envoi à l’utilisatrice — uniquement support@ (toi).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Client-Info, Apikey, X-Sentry-Webhook-Secret, Sentry-Hook-Resource, Sentry-Hook-Timestamp, Sentry-Hook-Signature',
};

const DEFAULT_TO = 'support@petitcoeur.app';
const DEFAULT_FROM = 'Petit Cœur <contact@petitcoeur.app>';
const DEDUP_MS = 24 * 60 * 60 * 1000;

type ErrorFamily = 'capture_photo' | 'sync' | 'auth' | 'paywall' | 'generic';

type ParsedIssue = {
  issueId: string;
  title: string;
  level: string;
  permalink: string;
  userId: string | null;
  culprit: string;
  tags: Record<string, string>;
  action: string;
};

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function authorize(req: Request, secret: string): boolean {
  const headerSecret =
    req.headers.get('X-Sentry-Webhook-Secret')?.trim() ||
    req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  if (headerSecret && timingSafeEqual(headerSecret, secret)) return true;
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('secret') ?? '').trim();
    if (q && timingSafeEqual(q, secret)) return true;
    /**
     * Secret dans le path — les WebHooks legacy Sentry gardent le path
     * mais peuvent perdre / ignorer `?secret=` au « Send Test Event ».
     * Ex. /functions/v1/sentry-issue-notify/<secret>
     */
    const parts = url.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'sentry-issue-notify');
    if (idx >= 0 && parts[idx + 1]) {
      const pathSecret = parts[idx + 1].trim();
      if (pathSecret && timingSafeEqual(pathSecret, secret)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function tagMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const t of raw) {
      // Alert webhooks : [["app.build","24"], ...]
      if (Array.isArray(t) && t.length >= 2) {
        const key = String(t[0] ?? '').trim();
        const value = String(t[1] ?? '').trim();
        if (key) out[key] = value;
        continue;
      }
      if (t && typeof t === 'object') {
        const key = String((t as { key?: string }).key ?? '').trim();
        const value = String((t as { value?: string }).value ?? '').trim();
        if (key) out[key] = value;
      }
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = String(k ?? '').trim();
      if (key) out[key] = String(v ?? '').trim();
    }
  }
  return out;
}

function parseIssue(body: Record<string, unknown>, hookResource: string | null): ParsedIssue | null {
  const action = typeof body.action === 'string' ? body.action : 'unknown';
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<
    string,
    unknown
  >;

  const issue =
    (data.issue && typeof data.issue === 'object' ? data.issue : null) ??
    (body.issue && typeof body.issue === 'object' ? body.issue : null);

  if (issue && typeof issue === 'object') {
    const iss = issue as Record<string, unknown>;
    const id = String(iss.id ?? iss.shortId ?? '').trim();
    if (!id) return null;
    const userObj =
      iss.user && typeof iss.user === 'object' ? (iss.user as Record<string, unknown>) : null;
    const userIdRaw = typeof userObj?.id === 'string' ? userObj.id.trim() : '';
    const userId = userIdRaw && userIdRaw.length <= 64 ? userIdRaw : null;
    const meta = iss.metadata && typeof iss.metadata === 'object'
      ? (iss.metadata as { value?: string; title?: string })
      : null;
    const titleRaw =
      (typeof iss.title === 'string' && iss.title) ||
      meta?.value ||
      meta?.title ||
      'Issue Sentry';
    return {
      issueId: id.slice(0, 128),
      title: String(titleRaw).slice(0, 300),
      level: String(iss.level ?? 'error').toLowerCase(),
      permalink: String(iss.permalink ?? iss.web_url ?? '').trim(),
      userId,
      culprit: String(iss.culprit ?? '').slice(0, 200),
      tags: tagMap(iss.tags),
      action,
    };
  }

  // Fallback event payload (alert rule)
  const event =
    data.event && typeof data.event === 'object'
      ? (data.event as Record<string, unknown>)
      : null;
  if (event) {
    // Préférer issue_id (stable pour dédup) plutôt que event_id (unique à chaque envoi).
    const id = String(event.issue_id ?? event.event_id ?? event.id ?? '').trim();
    if (id) {
      const userObj =
        event.user && typeof event.user === 'object' ? (event.user as Record<string, unknown>) : null;
      const userIdRaw = typeof userObj?.id === 'string' ? userObj.id.trim() : '';
      const userId = userIdRaw && userIdRaw.length <= 64 ? userIdRaw : null;
      const tagsArr = Array.isArray(event.tags)
        ? event.tags
        : event.tags && typeof event.tags === 'object'
          ? Object.entries(event.tags as Record<string, string>).map(([key, value]) => ({
              key,
              value,
            }))
          : [];
      const titleRaw =
        (typeof event.title === 'string' && event.title) ||
        (typeof event.message === 'string' && event.message) ||
        (event.metadata && typeof event.metadata === 'object'
          ? String((event.metadata as { value?: string }).value ?? '')
          : '') ||
        'Event Sentry';
      return {
        issueId: id.slice(0, 128),
        title: String(titleRaw).slice(0, 300),
        level: String(event.level ?? 'error').toLowerCase(),
        permalink: String(event.web_url ?? '').trim(),
        userId,
        culprit: String(event.culprit ?? event.transaction ?? '').slice(0, 200),
        tags: tagMap(tagsArr),
        action: action || hookResource || 'event',
      };
    }
    // event sans id → continuer (ex. legacy : id au niveau racine)
  }

  /**
   * Legacy project WebHooks plugin :
   * { id, message, url, level, culprit, event: { tags, user, … } }
   * (pas de data.issue / Sentry-Hook-Resource).
   */
  const legacyId = String(body.id ?? data.id ?? '').trim();
  const legacyMsg =
    (typeof body.message === 'string' && body.message.trim()) ||
    (typeof body.title === 'string' && body.title.trim()) ||
    (typeof data.message === 'string' && String(data.message).trim()) ||
    '';
  const legacyUrl =
    (typeof body.url === 'string' && body.url.trim()) ||
    (typeof data.url === 'string' && String(data.url).trim()) ||
    '';
  if (legacyId && (legacyMsg || legacyUrl || body.event || data.event)) {
    const legEvent =
      (body.event && typeof body.event === 'object'
        ? (body.event as Record<string, unknown>)
        : null) ??
      (data.event && typeof data.event === 'object'
        ? (data.event as Record<string, unknown>)
        : null);
    const userObj =
      legEvent?.user && typeof legEvent.user === 'object'
        ? (legEvent.user as Record<string, unknown>)
        : legEvent?.['sentry.interfaces.User'] &&
            typeof legEvent['sentry.interfaces.User'] === 'object'
          ? (legEvent['sentry.interfaces.User'] as Record<string, unknown>)
          : null;
    const userIdRaw = typeof userObj?.id === 'string' ? userObj.id.trim() : '';
    const userId = userIdRaw && userIdRaw.length <= 64 ? userIdRaw : null;
    const tagsRaw = legEvent?.tags;
    return {
      issueId: legacyId.slice(0, 128),
      title: (legacyMsg || 'Legacy Sentry event').slice(0, 300),
      level: String(body.level ?? data.level ?? 'error').toLowerCase(),
      permalink: legacyUrl,
      userId,
      culprit: String(body.culprit ?? data.culprit ?? '').slice(0, 200),
      tags: tagMap(tagsRaw),
      action: action === 'unknown' ? 'legacy_webhook' : action,
    };
  }

  /** Bouton Sentry « Send Test Event » : payload minimal / vide. */
  const isSentryTest =
    body['sentry_test'] === true ||
    body['test'] === true ||
    String(body.id ?? '') === 'test' ||
    Object.keys(body).length === 0;
  if (isSentryTest) {
    return {
      issueId: `sentry-test-${Date.now()}`.slice(0, 128),
      title: 'Sentry Send Test Event',
      level: 'error',
      permalink: '',
      userId: null,
      culprit: 'sentry-test',
      tags: { 'app.smokeTest': 'yes' },
      action: 'legacy_webhook',
    };
  }

  return null;
}

function classifyFamily(parsed: ParsedIssue): ErrorFamily {
  const scope = (
    parsed.tags['app.errorScope'] ??
    parsed.tags['app.errorscope'] ??
    ''
  ).toLowerCase();
  const blob = `${parsed.title} ${parsed.culprit} ${scope} ${Object.entries(parsed.tags)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')}`.toLowerCase();

  // Smoke HITL volontairement tagué capture.photo
  if (
    blob.includes('petitmo_sentry_smoke') ||
    blob.includes('capturesentrysmoketest') ||
    parsed.tags['app.smokeTest'] === 'yes'
  ) {
    return 'capture_photo';
  }
  if (scope.includes('capture') || /capture\.(photo|album|video|voice)/.test(blob)) {
    return 'capture_photo';
  }
  if (scope.includes('sync') || blob.includes('sync.flush') || blob.includes('pendingcloud')) {
    return 'sync';
  }
  if (scope.includes('auth') || /\bauth\./.test(blob)) return 'auth';
  if (scope.includes('paywall') || blob.includes('paywall')) return 'paywall';
  return 'generic';
}

function draftForFamily(family: ErrorFamily, _toEmail: string): { subjectHint: string; body: string } {
  switch (family) {
    case 'capture_photo':
      return {
        subjectHint: 'photo / média',
        body: [
          'Bonjour,',
          '',
          'Nous avons détecté un petit dysfonctionnement lorsque vous avez chargé ou capturé un souvenir (photo ou média).',
          'On s’en occupe pour corriger rapidement — merci de votre patience.',
          '',
          'L’équipe Petit Cœur',
        ].join('\n'),
      };
    case 'sync':
      return {
        subjectHint: 'sync',
        body: [
          'Bonjour,',
          '',
          'Nous avons détecté un petit dysfonctionnement lors de la sauvegarde d’un souvenir en arrière-plan.',
          'Vos souvenirs sur le téléphone ne sont pas concernés ; on travaille déjà à corriger ça.',
          '',
          'L’équipe Petit Cœur',
        ].join('\n'),
      };
    case 'auth':
      return {
        subjectHint: 'compte',
        body: [
          'Bonjour,',
          '',
          'Nous avons détecté un petit dysfonctionnement autour de la connexion au compte.',
          'On s’en occupe. Si tu es bloquée, réponds à ce message et on t’aide.',
          '',
          'L’équipe Petit Cœur',
        ].join('\n'),
      };
    case 'paywall':
      return {
        subjectHint: 'abonnement',
        body: [
          'Bonjour,',
          '',
          'Nous avons détecté un petit dysfonctionnement autour de l’abonnement Petit Cœur.',
          'On s’en occupe. Si un paiement a été débité sans accès, réponds à ce message.',
          '',
          'L’équipe Petit Cœur',
        ].join('\n'),
      };
    default:
      return {
        subjectHint: 'app',
        body: [
          'Bonjour,',
          '',
          'Nous avons détecté un petit dysfonctionnement dans l’app hier.',
          'On s’en excuse et on s’occupe de le corriger rapidement. Merci de votre patience.',
          '',
          'L’équipe Petit Cœur',
        ].join('\n'),
      };
  }
}

function shouldSkip(parsed: ParsedIssue): string | null {
  if (parsed.tags['app.source'] === 'user_report') {
    return 'user_report_handled_by_support_contact';
  }
  if (parsed.level === 'info' || parsed.level === 'debug') {
    return 'low_level';
  }
  // Issues : on traite created / triggered ; on ignore resolved etc.
  const a = parsed.action.toLowerCase();
  if (a && ['resolved', 'archived', 'deleted', 'ignored'].includes(a)) {
    return 'action_ignored';
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const secret = (Deno.env.get('SENTRY_WEBHOOK_SECRET') ?? '').trim();
  if (!secret) {
    console.error('[sentry-issue-notify] SENTRY_WEBHOOK_SECRET missing');
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }
  if (!authorize(req, secret)) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Sentry « Send Test Event » envoie parfois un corps vide.
    body = {};
  }

  const hookResource = req.headers.get('Sentry-Hook-Resource');
  const parsed = parseIssue(body, hookResource);
  if (!parsed) {
    return jsonRes({ ok: true, skipped: 'unrecognized_payload' }, 200);
  }

  const skip = shouldSkip(parsed);
  if (skip) {
    return jsonRes({ ok: true, skipped: skip }, 200);
  }

  /**
   * Répondre vite (<1–2 s) : le bouton Sentry « Send Test Event » timeoute ~3 s
   * si on attend Resend + DB. Mail / insert en arrière-plan.
   */
  const background = (async () => {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userEmail: string | null = null;
    let resolvedUserId: string | null = null;
    if (parsed.userId) {
      try {
        const { data, error } = await admin.auth.admin.getUserById(parsed.userId);
        if (!error && data.user?.id) {
          resolvedUserId = data.user.id;
          if (data.user.email) {
            const em = data.user.email.trim().toLowerCase();
            if (!em.endsWith('@petitmo.local')) userEmail = em;
          }
        }
      } catch (e) {
        console.warn('[sentry-issue-notify] getUserById', e);
      }
    }

    const family = classifyFamily(parsed);
    const draft = draftForFamily(family, userEmail ?? '');
    const toEmail = (Deno.env.get('SUPPORT_TO_EMAIL') ?? DEFAULT_TO).trim() || DEFAULT_TO;
    const fromEmail = (Deno.env.get('SUPPORT_FROM_EMAIL') ?? DEFAULT_FROM).trim() || DEFAULT_FROM;
    const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim();

    const since = new Date(Date.now() - DEDUP_MS).toISOString();
    let dedupQ = admin
      .from('bug_outreach_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('sentry_issue_id', parsed.issueId)
      .gte('created_at', since);
    if (resolvedUserId) {
      dedupQ = dedupQ.eq('user_id', resolvedUserId);
    } else {
      dedupQ = dedupQ.is('user_id', null);
    }
    const { count: recentCount } = await dedupQ;
    if ((recentCount ?? 0) > 0) {
      console.log('[sentry-issue-notify] dedup_24h', parsed.issueId);
      return;
    }

    const { error: insertErr } = await admin.from('bug_outreach_drafts').insert({
      sentry_issue_id: parsed.issueId,
      user_id: resolvedUserId,
      user_email: userEmail,
      status: 'drafted',
      error_family: family,
      sentry_url: parsed.permalink || null,
    });
    if (insertErr) {
      console.error('[sentry-issue-notify] insert', insertErr.message);
      return;
    }

    const text = [
      '[Petit Cœur] Bug détecté — draft à valider',
      '',
      `Bug: ${parsed.title}`,
      `Famille: ${family} (${draft.subjectHint})`,
      `Niveau: ${parsed.level}`,
      `Action Sentry: ${parsed.action}`,
      `Qui: ${userEmail ?? 'e-mail inconnu'} · user_id ${resolvedUserId ?? parsed.userId ?? '—'}`,
      `Culprit: ${parsed.culprit || '—'}`,
      `Build: ${parsed.tags['app.build'] ?? '—'} · tier ${parsed.tags['app.tier'] ?? '—'} · mode ${parsed.tags['app.userMode'] ?? '—'}`,
      parsed.permalink ? `Lien Sentry: ${parsed.permalink}` : 'Lien Sentry: (ouvrir Issues)',
      '',
      '---',
      `Draft proposé (à envoyer à: ${userEmail ?? 'e-mail inconnu'}) :`,
      '',
      draft.body,
      '',
      '---',
      'Rien n’a été envoyé à l’utilisatrice.',
      'Copie / édite ce draft puis envoie depuis support@ si tu valides.',
    ].join('\n');

    if (!resendKey) {
      console.warn('[sentry-issue-notify] RESEND_API_KEY absent — draft stocké, e-mail non envoyé');
      return;
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `[Petit Cœur] Bug détecté — draft à valider (${draft.subjectHint})`,
        text,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text().catch(() => '');
      console.error('[sentry-issue-notify] resend', resendRes.status, detail.slice(0, 400));
      return;
    }
    console.log('[sentry-issue-notify] emailed', family, parsed.issueId);
  })().catch(e => console.error('[sentry-issue-notify] background', e));

  // Deno Deploy / Supabase Edge : garder le worker vivant après la réponse.
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(background);
  } else {
    // Repli : on attend quand même (moins idéal pour le timeout Sentry).
    await background;
  }

  return jsonRes({ ok: true, accepted: true }, 200);
});
