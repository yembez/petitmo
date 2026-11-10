/**
 * E-mail bienvenue compte gratuit — template « communication client ».
 * Sujet : Bienvenue · CTA site « Plus d’infos ».
 */
import {
  buildClientCommunicationEmail,
  escapeHtml,
  italicPHtml,
  pHtml,
  photoHtml,
  sigHtml,
  strongPHtml,
} from './clientCommunicationEmail.ts';

const DEFAULT_PHOTO =
  'https://petitcoeur.app/emails/welcome-lettre-intime-v2.jpg';

export type WelcomeEmailVars = {
  firstName?: string | null;
  siteUrl?: string | null;
  photoUrl?: string | null;
  privacyUrl?: string | null;
  supportEmail?: string | null;
};

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
    return given.split(/\s+/)[0] ?? given;
  }
  const full = pick(meta.full_name) ?? pick(meta.name) ?? pick(meta.fullName);
  if (full) {
    const first = full.split(/\s+/)[0];
    return first && first.length >= 2 ? first : null;
  }
  return null;
}

export { escapeHtml };

export function buildWelcomeEmailContent(vars: WelcomeEmailVars = {}): {
  subject: string;
  text: string;
  html: string;
} {
  const firstName = (vars.firstName ?? '').trim();
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const photoUrl = (vars.photoUrl ?? DEFAULT_PHOTO).trim() || DEFAULT_PHOTO;

  const bodyHtml = [
    pHtml(greeting),
    pHtml('Merci d’utiliser Petit Cœur.'),
    photoHtml(photoUrl, 'Un enfant embrasse sa maman au bord d’un lac'),
    pHtml('Peut-être veux-tu savoir comment Petit Cœur a vu le jour ?'),
    pHtml(
      'Je vois tous les jours à quelle vitesse ma petite de 2 ans grandit, et je repense avec nostalgie à tous ces moments de l’enfance de mon aînée (19 ans) dont j’aurais aimé garder davantage de traces.',
    ),
    pHtml(
      'Il y a bien des photos et des vidéos précieuses, mais beaucoup sont perdues dans mes anciens téléphones. Et elles ne racontent pas tout : ses petites phrases, ce que nous vivions ensemble, ce que je ressentais en la voyant grandir… J’aurais voulu aussi lui écrire tout ça, lui relire aujourd’hui et entendre à nouveau sa petite voix.',
    ),
    pHtml(
      'C’est de ce manque qu’est né Petit Cœur : je voulais créer un journal privé pour rassembler ces souvenirs et écrire, au fil des jours, cette histoire qui n’appartient qu’à nous.',
      'margin:0 0 8px;',
    ),
    pHtml('De façon simple.'),
    italicPHtml('Parce qu’il y a des choses qu’on ne veut partager qu’avec eux/elles.'),
    pHtml('Je te souhaite de belles émotions à garder, et à retrouver.'),
    strongPHtml('Tu peux maintenant écrire la belle histoire de cet amour inconditionnel.'),
    sigHtml('Guilhem', 'Créateur de Petit Cœur'),
  ].join('\n');

  const textBody = [
    greeting,
    '',
    'Merci d’utiliser Petit Cœur.',
    '',
    'Peut-être veux-tu savoir comment Petit Cœur a vu le jour ?',
    '',
    'Je vois tous les jours à quelle vitesse ma petite de 2 ans grandit, et je repense avec nostalgie à tous ces moments de l’enfance de mon aînée (19 ans) dont j’aurais aimé garder davantage de traces.',
    '',
    'Il y a bien des photos et des vidéos précieuses, mais beaucoup sont perdues dans mes anciens téléphones. Et elles ne racontent pas tout : ses petites phrases, ce que nous vivions ensemble, ce que je ressentais en la voyant grandir… J’aurais voulu aussi lui écrire tout ça, lui relire aujourd’hui et entendre à nouveau sa petite voix.',
    '',
    'C’est de ce manque qu’est né Petit Cœur : je voulais créer un journal privé pour rassembler ces souvenirs et écrire, au fil des jours, cette histoire qui n’appartient qu’à nous.',
    'De façon simple.',
    '',
    'Parce qu’il y a des choses qu’on ne veut partager qu’avec eux/elles.',
    '',
    'Je te souhaite de belles émotions à garder, et à retrouver.',
    '',
    'Tu peux maintenant écrire la belle histoire de cet amour inconditionnel.',
    '',
    'Guilhem',
    'Créateur de Petit Cœur',
  ].join('\n');

  return buildClientCommunicationEmail({
    subject: 'Bienvenue',
    bodyHtml,
    textBody,
    siteUrl: vars.siteUrl,
    privacyUrl: vars.privacyUrl,
    supportEmail: vars.supportEmail,
    tip: {
      title: '💡 Une première petite astuce',
      paragraphs: [
        'Quand ton enfant joue dans sa chambre, il lui arrive peut-être de fredonner, d’inventer une chanson ou de faire parler ses jouets. Pense à enregistrer quelques secondes avec la fonction audio de Petit Cœur.',
        'Sa petite voix et ses chansons improvisées seront de précieux souvenirs à réécouter dans un livre « vivant ».',
      ],
      ctaLabel: 'Plus d’infos',
      ctaUrl: (vars.siteUrl ?? '').trim() || undefined,
    },
  });
}
