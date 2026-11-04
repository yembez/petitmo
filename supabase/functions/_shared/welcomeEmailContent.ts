/**
 * E-mail bienvenue compte gratuit — template « Lettre intime ».
 * Sujet : Bienvenue · CTA site « Plus d’infos ».
 */

const DEFAULT_SITE = 'https://petitcoeur.app';
const DEFAULT_PHOTO =
  'https://petitcoeur.app/emails/welcome-lettre-intime.jpg';
const DEFAULT_PRIVACY = 'https://petitcoeur.app/privacy';
const DEFAULT_SUPPORT = 'support@petitcoeur.app';

export type WelcomeEmailVars = {
  firstName?: string | null;
  siteUrl?: string | null;
  photoUrl?: string | null;
  privacyUrl?: string | null;
  supportEmail?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Prénom pour le mail — null → « Bonjour, » sans prénom. */
export function resolveWelcomeFirstName(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const pick = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t || t.includes('@')) return null;
    return t;
  };
  const given = pick(meta.given_name) ?? pick(meta.first_name) ?? pick(meta.givenName);
  if (given) {
    // Un seul mot / premier prénom
    return given.split(/\s+/)[0] ?? given;
  }
  const full = pick(meta.full_name) ?? pick(meta.name) ?? pick(meta.fullName);
  if (full) {
    const first = full.split(/\s+/)[0];
    return first && first.length >= 2 ? first : null;
  }
  return null;
}

export function buildWelcomeEmailContent(vars: WelcomeEmailVars = {}): {
  subject: string;
  text: string;
  html: string;
} {
  const firstName = (vars.firstName ?? '').trim();
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const siteUrl = (vars.siteUrl ?? DEFAULT_SITE).trim() || DEFAULT_SITE;
  const photoUrl = (vars.photoUrl ?? DEFAULT_PHOTO).trim() || DEFAULT_PHOTO;
  const privacyUrl = (vars.privacyUrl ?? DEFAULT_PRIVACY).trim() || DEFAULT_PRIVACY;
  const supportEmail = (vars.supportEmail ?? DEFAULT_SUPPORT).trim() || DEFAULT_SUPPORT;
  const unsubMailto = `mailto:${supportEmail}?subject=${encodeURIComponent('Désinscription e-mails Petit Cœur')}`;

  const subject = 'Bienvenue';

  const text = [
    greeting,
    '',
    'Merci d’avoir rejoint Petit Cœur.',
    '',
    'Comment Petit Cœur a vu le jour ?',
    '',
    'En voyant ma petite de 2 ans grandir, je repense avec nostalgie à tous ces moments de l’enfance de mon aînée (19 ans) dont j’aurais aimé garder davantage de traces.',
    '',
    'Il y a bien des photos et des vidéos précieuses, mais beaucoup sont perdues dans mes anciens téléphones. Et elles ne racontent pas tout : ses petites phrases, ce que nous vivions ensemble, ce que je ressentais en la voyant grandir… J’aurais voulu aussi lui écrire tout ça, lui relire aujourd’hui et entendre à nouveau sa petite voix.',
    '',
    'C’est de ce manque qu’est né Petit Cœur : je voulais créer un journal privé pour rassembler ces souvenirs et écrire, au fil des jours, cette histoire qui n’appartient qu’à nous.',
    '',
    'Parce qu’il y a des choses qu’on ne veut partager qu’avec eux/elles.',
    '',
    'Je te souhaite de belles émotions à garder, et à retrouver.',
    '',
    'Tu peux maintenant écrire la belle histoire de cet amour inconditionnel.',
    '',
    'Guilhem',
    'Créateur de Petit Cœur',
    '',
    '💡 Une première petite astuce',
    '',
    'Quand ton enfant joue dans sa chambre, il lui arrive peut-être de fredonner, d’inventer une chanson ou de faire parler ses jouets. Pense à enregistrer quelques secondes avec la fonction audio de Petit Cœur.',
    '',
    'Sa petite voix et ses chansons improvisées seront de précieux souvenirs à réécouter dans un livre « vivant ».',
    '',
    `Plus d’infos : ${siteUrl}`,
    '',
    `Confidentialité : ${privacyUrl}`,
    `Ne plus recevoir ces messages : ${supportEmail}`,
  ].join('\n');

  const greetHtml = escapeHtml(greeting);
  const photo = escapeHtml(photoUrl);
  const site = escapeHtml(siteUrl);
  const privacy = escapeHtml(privacyUrl);
  const unsub = escapeHtml(unsubMailto);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Bienvenue</title>
</head>
<body style="margin:0;padding:0;background:#FAFAF7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FEFBF7;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1C1C1E;font-size:17px;line-height:1.65;">
  <tr><td style="padding:27px 32px;text-align:center;font-size:20px;font-weight:500;letter-spacing:-0.6px;">Petit Cœur</td></tr>
  <tr><td style="padding:0 36px 8px;">
    <p style="margin:0 0 20px;">${greetHtml}</p>
    <p style="margin:0 0 20px;">Merci d’avoir rejoint Petit Cœur.</p>
  </td></tr>
  <tr><td style="padding:0 36px;">
    <img src="${photo}" alt="Un enfant embrasse sa maman au bord d’un lac" width="488" style="display:block;width:100%;max-width:488px;height:auto;border-radius:12px;margin:0 0 26px;"/>
  </td></tr>
  <tr><td style="padding:0 36px 32px;">
    <h2 style="font-size:25px;line-height:1.25;letter-spacing:-0.6px;font-weight:600;margin:8px 0 21px;">Comment Petit Cœur a vu le jour&nbsp;?</h2>
    <p style="margin:0 0 20px;">En voyant ma petite de 2&nbsp;ans grandir, je repense avec nostalgie à tous ces moments de l’enfance de mon aînée (19&nbsp;ans) dont j’aurais aimé garder davantage de traces.</p>
    <p style="margin:0 0 20px;">Il y a bien des photos et des vidéos précieuses, mais beaucoup sont perdues dans mes anciens téléphones. Et elles ne racontent pas tout&nbsp;: ses petites phrases, ce que nous vivions ensemble, ce que je ressentais en la voyant grandir… J’aurais voulu aussi lui écrire tout ça, lui relire aujourd’hui et entendre à nouveau sa petite voix.</p>
    <p style="margin:0 0 20px;">C’est de ce manque qu’est né Petit Cœur&nbsp;: je voulais créer un journal privé pour rassembler ces souvenirs et écrire, au fil des jours, cette histoire qui n’appartient qu’à nous.</p>
    <p style="margin:27px 0;font-style:italic;">Parce qu’il y a des choses qu’on ne veut partager qu’avec eux/elles.</p>
    <p style="margin:0 0 20px;">Je te souhaite de belles émotions à garder, et à retrouver.</p>
    <p style="margin:0 0 20px;"><strong>Tu peux maintenant écrire la belle histoire de cet amour inconditionnel.</strong></p>
    <p style="margin:26px 0 0;line-height:1.5;"><strong>Guilhem</strong><br/><span style="font-size:13px;color:#6B7280;">Créateur de Petit Cœur</span></p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;background:#FFF0EB;border-radius:16px;">
      <tr><td style="padding:27px;font-size:16px;line-height:1.65;">
        <p style="margin:0 0 16px;font-size:18px;font-weight:600;letter-spacing:-0.3px;">💡 Une première petite astuce</p>
        <p style="margin:0 0 17px;">Quand ton enfant joue dans sa chambre, il lui arrive peut-être de fredonner, d’inventer une chanson ou de faire parler ses jouets. Pense à enregistrer quelques secondes avec la fonction audio de Petit Cœur.</p>
        <p style="margin:0 0 20px;">Sa petite voix et ses chansons improvisées seront de précieux souvenirs à réécouter dans un livre «&nbsp;vivant&nbsp;».</p>
        <a href="${site}" style="display:block;background:#FC5757;color:#1C1C1E;text-align:center;text-decoration:none;border-radius:100px;padding:14px 12px;font-size:16px;font-weight:600;">Plus d’infos</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;font-size:12px;line-height:1.7;color:#6B7280;padding:0 25px 28px;">
    Petit Cœur · Ton journal privé<br/>
    <a href="${privacy}" style="color:#6B7280;">Confidentialité</a>
    ·
    <a href="${unsub}" style="color:#6B7280;">Ne plus recevoir ces messages</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
