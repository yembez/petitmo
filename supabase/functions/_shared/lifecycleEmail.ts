/**
 * E-mails lifecycle Petit Cœur (Resend) + anti-doublon SQL.
 * Templates abo + inactivité (inactive.j90 / j30 / j7 / deleted).
 * Libellé abo : « abonnement Petit Cœur » (pas Petitmo+ / Petit Cœur+).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';

export type LifecycleTemplateId =
  | 'sub.billing_issue'
  | 'sub.cancelled'
  | 'sub.downgraded'
  | 'sub.reactivated'
  | 'inactive.j90'
  | 'inactive.j30'
  | 'inactive.j7'
  | 'inactive.deleted';

const DEFAULT_FROM = 'Petit Cœur <contact@petitcoeur.app>';

type TemplateVars = {
  /** Date de fin d’accès (ex. « 16 octobre 2026 ») — optionnel. */
  accessEndsOn?: string | null;
};

type TemplateContent = { subject: string; text: string; html: string };

function formatAccessEndsOn(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Paris',
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

export { formatAccessEndsOn };

function templates(templateId: LifecycleTemplateId, vars: TemplateVars = {}): TemplateContent {
  const ends = (vars.accessEndsOn ?? '').trim();
  switch (templateId) {
    case 'sub.billing_issue':
      return {
        subject: 'Petit Cœur — le paiement n’a pas fonctionné',
        text: [
          'Bonjour,',
          '',
          'Le paiement n’a pas fonctionné pour ce mois-ci.',
          'Mets à jour ton moyen de paiement rapidement pour pouvoir continuer à utiliser Petit Cœur.',
          '',
          'Comment faire ?',
          '1. Ouvre l’app Petit Cœur',
          '2. Espace parent → Mets à jour le paiement (ou Réglages iPhone → Abonnements)',
          '',
          'Besoin d’aide ? Réponds à cet e-mail ou support@petitcoeur.app',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>Le paiement n’a pas fonctionné pour ce mois-ci.<br/>
Mets à jour ton moyen de paiement rapidement pour pouvoir continuer à utiliser <strong>Petit Cœur</strong>.</p>
<p><strong>Comment faire ?</strong></p>
<ol>
<li>Ouvre l’app Petit Cœur</li>
<li>Espace parent → Mets à jour le paiement (ou Réglages iPhone → Abonnements)</li>
</ol>
<p>Besoin d’aide ? <a href="mailto:support@petitcoeur.app">support@petitcoeur.app</a></p>
<p>— L’équipe Petit Cœur</p>`,
      };
    case 'sub.cancelled': {
      const untilLine = ends
        ? `Tu restes active jusqu’au ${ends} avec tous tes souvenirs. Ensuite, tu pourras toujours les revoir et les partager un par un, mais tu ne pourras plus en ajouter sans te réabonner.`
        : `Tu restes active jusqu’à la fin de la période déjà payée avec tous tes souvenirs. Ensuite, tu pourras toujours les revoir et les partager un par un, mais tu ne pourras plus en ajouter sans te réabonner.`;
      const untilHtml = ends
        ? `<p>Tu restes active jusqu’au <strong>${ends}</strong> avec tous tes souvenirs. Ensuite, tu pourras toujours les revoir et les partager un par un, mais tu ne pourras plus en ajouter sans te réabonner.</p>`
        : `<p>Tu restes active jusqu’à la fin de la période déjà payée avec tous tes souvenirs. Ensuite, tu pourras toujours les revoir et les partager un par un, mais tu ne pourras plus en ajouter sans te réabonner.</p>`;
      return {
        subject: 'Petit Cœur — ton abonnement ne se renouvellera pas',
        text: [
          'Bonjour,',
          '',
          'On a bien reçu l’annulation de ton abonnement Petit Cœur : il ne se renouvellera plus.',
          '',
          untilLine,
          '',
          'Tu peux te réabonner à tout moment depuis l’app (Espace parent).',
          '',
          'Besoin d’aide ? Réponds à cet e-mail ou support@petitcoeur.app',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>On a bien reçu l’annulation de ton <strong>abonnement Petit Cœur</strong> : il ne se renouvellera plus.</p>
${untilHtml}
<p>Tu peux te réabonner à tout moment depuis l’app (Espace parent).</p>
<p>Besoin d’aide ? <a href="mailto:support@petitcoeur.app">support@petitcoeur.app</a></p>
<p>— L’équipe Petit Cœur</p>`,
      };
    }
    case 'sub.downgraded':
      return {
        subject: 'Petit Cœur — ton abonnement est terminé',
        text: [
          'Bonjour,',
          '',
          'Ton abonnement Petit Cœur est terminé.',
          '',
          'Bonne nouvelle : tu gardes l’accès à tous tes souvenirs. Tu peux les revoir et les partager un par un.',
          'En revanche, tu ne peux plus en capturer de nouveaux tant que tu n’es pas réabonnée.',
          '',
          'Pour continuer à capturer : ouvre l’app → Espace parent ou l’écran d’abonnement.',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>Ton <strong>abonnement Petit Cœur</strong> est terminé.</p>
<p>Bonne nouvelle : tu gardes l’accès à <strong>tous</strong> tes souvenirs. Tu peux les revoir et les partager un par un.</p>
<p>En revanche, tu ne peux plus en capturer de nouveaux tant que tu n’es pas réabonnée.</p>
<p>Pour continuer à capturer : ouvre l’app Petit Cœur → Espace parent ou l’écran d’abonnement.</p>
<p>— L’équipe Petit Cœur</p>`,
      };
    case 'sub.reactivated':
      return {
        subject: 'Petit Cœur — ton abonnement est de nouveau actif',
        text: [
          'Bonjour,',
          '',
          'Merci ! Ton abonnement Petit Cœur est de nouveau actif.',
          'Tu peux à nouveau capturer de nouveaux souvenirs.',
          '',
          'Ouvre l’app pour continuer.',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>Merci ! Ton <strong>abonnement Petit Cœur</strong> est de nouveau actif.</p>
<p>Tu peux à nouveau capturer de nouveaux souvenirs. Ouvre l’app pour continuer.</p>
<p>— L’équipe Petit Cœur</p>`,
      };
    case 'inactive.j90':
      return {
        subject: 'Petit Cœur — ton compte sera bientôt inactif',
        text: [
          'Bonjour,',
          '',
          'Tu n’as pas ouvert Petit Cœur depuis longtemps.',
          'Dans environ 90 jours, si le compte reste inactif, nous le supprimerons (souvenirs inclus).',
          '',
          'Pour tout garder : ouvre simplement l’app une fois.',
          '',
          'Besoin d’aide ? support@petitcoeur.app',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>Tu n’as pas ouvert <strong>Petit Cœur</strong> depuis longtemps.</p>
<p>Dans environ <strong>90 jours</strong>, si le compte reste inactif, nous le supprimerons (souvenirs inclus).</p>
<p>Pour tout garder : ouvre simplement l’app une fois.</p>
<p>Besoin d’aide ? <a href="mailto:support@petitcoeur.app">support@petitcoeur.app</a></p>
<p>— L’équipe Petit Cœur</p>`,
      };
    case 'inactive.j30':
      return {
        subject: 'Petit Cœur — encore 30 jours avant suppression',
        text: [
          'Bonjour,',
          '',
          'Ton compte Petit Cœur est toujours inactif.',
          'Dans environ 30 jours, il sera supprimé si tu ne te reconnectes pas.',
          '',
          'Ouvre l’app pour conserver tes souvenirs.',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>Ton compte <strong>Petit Cœur</strong> est toujours inactif.</p>
<p>Dans environ <strong>30 jours</strong>, il sera supprimé si tu ne te reconnectes pas.</p>
<p>Ouvre l’app pour conserver tes souvenirs.</p>
<p>— L’équipe Petit Cœur</p>`,
      };
    case 'inactive.j7':
      return {
        subject: 'Petit Cœur — dernière relance (7 jours)',
        text: [
          'Bonjour,',
          '',
          'Dernière relance : ton compte Petit Cœur sera supprimé dans environ 7 jours faute d’activité.',
          '',
          'Ouvre l’app maintenant pour tout conserver.',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>Dernière relance : ton compte <strong>Petit Cœur</strong> sera supprimé dans environ <strong>7 jours</strong> faute d’activité.</p>
<p>Ouvre l’app maintenant pour tout conserver.</p>
<p>— L’équipe Petit Cœur</p>`,
      };
    case 'inactive.deleted':
      return {
        subject: 'Petit Cœur — ton compte a été supprimé',
        text: [
          'Bonjour,',
          '',
          'Ton compte Petit Cœur a été supprimé après 24 mois sans activité, comme annoncé.',
          'Les médias liés à un livre imprimé déjà commandé peuvent rester accessibles via QR jusqu’à leur échéance.',
          '',
          'Tu pourras toujours créer un nouveau compte si tu le souhaites.',
          '',
          '— L’équipe Petit Cœur',
        ].join('\n'),
        html: `<p>Bonjour,</p>
<p>Ton compte <strong>Petit Cœur</strong> a été supprimé après 24 mois sans activité, comme annoncé.</p>
<p>Les médias liés à un livre imprimé déjà commandé peuvent rester accessibles via QR jusqu’à leur échéance.</p>
<p>Tu pourras toujours créer un nouveau compte si tu le souhaites.</p>
<p>— L’équipe Petit Cœur</p>`,
      };
  }
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function sendLifecycleEmail(params: {
  admin: SupabaseClient;
  userId: string;
  email: string | null | undefined;
  templateId: LifecycleTemplateId;
  /** Défaut = date UTC du jour (1 envoi / template / jour / user). */
  dedupeKey?: string;
  vars?: TemplateVars;
}): Promise<{ sent: boolean; reason?: string }> {
  const email = (params.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { sent: false, reason: 'no_email' };
  }

  const dedupeKey = (params.dedupeKey ?? dayKey()).trim() || dayKey();
  const { error: insErr } = await params.admin.from('lifecycle_email_log').insert({
    user_id: params.userId,
    template_id: params.templateId,
    dedupe_key: dedupeKey,
    email,
  });
  if (insErr) {
    if (insErr.code === '23505' || /duplicate|unique/i.test(insErr.message)) {
      return { sent: false, reason: 'deduped' };
    }
    console.error('[lifecycleEmail] log insert', insErr.message);
    return { sent: false, reason: 'log_failed' };
  }

  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
  if (!resendKey) {
    console.warn('[lifecycleEmail] RESEND_API_KEY absent');
    return { sent: false, reason: 'no_resend_key' };
  }

  const fromEmail =
    (Deno.env.get('LIFECYCLE_FROM_EMAIL') ?? Deno.env.get('SUPPORT_FROM_EMAIL') ?? DEFAULT_FROM)
      .trim() || DEFAULT_FROM;
  const content = templates(params.templateId, params.vars);

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text().catch(() => '');
    console.error('[lifecycleEmail] resend', params.templateId, resendRes.status, detail.slice(0, 400));
    return { sent: false, reason: 'resend_failed' };
  }

  console.log('[lifecycleEmail] sent', params.templateId, params.userId.slice(0, 8));
  return { sent: true };
}
