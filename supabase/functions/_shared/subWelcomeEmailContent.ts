/**
 * E-mail bienvenue abonnement (sub.welcome) — template « communication client ».
 * Sujet : Bienvenue dans votre histoire
 * Titre : En route pour la plus belle de toutes les histoires : la vôtre
 */
import {
  buildClientCommunicationEmail,
  pHtml,
  photoHtml,
  sigHtml,
  strongPHtml,
} from './clientCommunicationEmail.ts';

const DEFAULT_PHOTO =
  'https://petitcoeur.app/emails/welcome-paid-chambers.jpg';

export type SubWelcomeEmailVars = {
  firstName?: string | null;
  siteUrl?: string | null;
  photoUrl?: string | null;
  privacyUrl?: string | null;
  supportEmail?: string | null;
};

export function buildSubWelcomeEmailContent(vars: SubWelcomeEmailVars = {}): {
  subject: string;
  text: string;
  html: string;
} {
  const firstName = (vars.firstName ?? '').trim();
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const photoUrl = (vars.photoUrl ?? DEFAULT_PHOTO).trim() || DEFAULT_PHOTO;
  const title = 'En route pour la plus belle de toutes les histoires : la vôtre';

  const bodyHtml = [
    pHtml(greeting),
    pHtml('Bienvenue dans ton abonnement Petit Cœur.'),
    pHtml('Tu as désormais le champ libre pour laisser votre histoire grandir de jour en jour…'),
    photoHtml(photoUrl, 'Une famille dans un champ de fleurs'),
    pHtml('Laisse-moi te partager un souvenir…'),
    pHtml(
      'J’ai encore cette image de Lina, il y a plusieurs mois, à l’aéroport. Elle avait 18 mois, elle savait à peine marcher et je m’étais absenté quelques jours. Quand elle m’a aperçu, elle s’est mise à courir vers moi en éclatant de rire. Dix mètres, peut-être vingt, avant de se jeter dans mes bras, riant sans s’arrêter.',
    ),
    pHtml(
      'Quand je le raconte, j’en suis encore tout ému. Ce que j’aimerais revoir, c’est sa façon de courir, son rire. Et ce que j’aimerais lui raconter un jour, c’est le bonheur que j’ai eu, moi, à recevoir tout cet amour si pur.',
    ),
    pHtml(
      'C’est pour ça que j’ai créé Petit Cœur : pour raconter et revivre la plus belle de toutes les histoires.',
    ),
    strongPHtml('Bienvenue dans votre histoire !'),
    sigHtml('Guilhem', 'Créateur de Petit Cœur'),
  ].join('\n');

  const textBody = [
    title,
    '',
    greeting,
    '',
    'Bienvenue dans ton abonnement Petit Cœur.',
    '',
    'Tu as désormais le champ libre pour laisser votre histoire grandir de jour en jour…',
    '',
    'Laisse-moi te partager un souvenir…',
    '',
    'J’ai encore cette image de Lina, il y a plusieurs mois, à l’aéroport. Elle avait 18 mois, elle savait à peine marcher et je m’étais absenté quelques jours. Quand elle m’a aperçu, elle s’est mise à courir vers moi en éclatant de rire. Dix mètres, peut-être vingt, avant de se jeter dans mes bras, riant sans s’arrêter.',
    '',
    'Quand je le raconte, j’en suis encore tout ému. Ce que j’aimerais revoir, c’est sa façon de courir, son rire. Et ce que j’aimerais lui raconter un jour, c’est le bonheur que j’ai eu, moi, à recevoir tout cet amour si pur.',
    '',
    'C’est pour ça que j’ai créé Petit Cœur : pour raconter et revivre la plus belle de toutes les histoires.',
    '',
    'Bienvenue dans votre histoire !',
    '',
    'Guilhem',
    'Créateur de Petit Cœur',
  ].join('\n');

  return buildClientCommunicationEmail({
    subject: 'Bienvenue dans votre histoire',
    title,
    bodyHtml,
    textBody,
    siteUrl: vars.siteUrl,
    privacyUrl: vars.privacyUrl,
    supportEmail: vars.supportEmail,
    tip: {
      title: '💡 La petite astuce · Être dans le souvenir, toi aussi',
      paragraphs: [
        'La prochaine fois que tu retrouves ton enfant après quelques jours d’absence, si un proche est là, demande-lui de filmer vos retrouvailles. Ces moments d’amour pur sont des pépites.',
      ],
      ctaLabel: 'Plus d’infos',
      ctaUrl: (vars.siteUrl ?? '').trim() || undefined,
    },
  });
}
