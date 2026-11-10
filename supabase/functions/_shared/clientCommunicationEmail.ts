/**
 * Template « communication client » Petit Cœur.
 * Charte : carte blanche, brand, titre optionnel, corps fluide, photo optionnelle,
 * tip + CTA, footer légal. Largeur responsive (mobile étroit → desktop large).
 */

const DEFAULT_SITE = 'https://petitcoeur.app';
const DEFAULT_PRIVACY = 'https://petitcoeur.app/privacy';
const DEFAULT_SUPPORT = 'support@petitcoeur.app';

export type ClientCommTip = {
  title: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaUrl?: string;
};

export type ClientCommEmailInput = {
  subject: string;
  /** Titre H2 sous le brand (ex. payant). */
  title?: string | null;
  /** HTML déjà échappé / construit du corps (entre brand/titre et tip). */
  bodyHtml: string;
  tip?: ClientCommTip | null;
  siteUrl?: string | null;
  privacyUrl?: string | null;
  supportEmail?: string | null;
  /** Ligne plain-text miroir (tip + footer exclus ou inclus par l’appelant). */
  textBody: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pHtml(text: string, styleExtra = ''): string {
  const style = `margin:0 0 20px;${styleExtra}`;
  return `<p style="${style}">${escapeHtml(text)}</p>`;
}

export function strongPHtml(text: string): string {
  return `<p style="margin:0 0 20px;"><strong>${escapeHtml(text)}</strong></p>`;
}

export function italicPHtml(text: string): string {
  return `<p style="margin:27px 0;font-style:italic;">${escapeHtml(text)}</p>`;
}

export function sigHtml(name: string, role: string): string {
  return `<p style="margin:26px 0 0;line-height:1.5;"><strong>${escapeHtml(name)}</strong><br/><span style="font-size:13px;color:#6B7280;">${escapeHtml(role)}</span></p>`;
}

export function photoHtml(url: string, alt: string): string {
  const src = escapeHtml(url);
  const a = escapeHtml(alt);
  return `<img src="${src}" alt="${a}" width="640" style="display:block;width:100%;max-width:100%;height:auto;border-radius:12px;margin:0 0 26px;border:0;outline:none;text-decoration:none;"/>`;
}

export function buildClientCommunicationEmail(input: ClientCommEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const siteUrl = (input.siteUrl ?? DEFAULT_SITE).trim() || DEFAULT_SITE;
  const privacyUrl = (input.privacyUrl ?? DEFAULT_PRIVACY).trim() || DEFAULT_PRIVACY;
  const supportEmail = (input.supportEmail ?? DEFAULT_SUPPORT).trim() || DEFAULT_SUPPORT;
  const unsubMailto = `mailto:${supportEmail}?subject=${encodeURIComponent('Désinscription e-mails Petit Cœur')}`;

  const privacy = escapeHtml(privacyUrl);
  const unsub = escapeHtml(unsubMailto);

  const title = (input.title ?? '').trim();
  const titleHtml = title
    ? `<h1 class="email-title" style="margin:8px 0 21px;font-size:25px;line-height:1.25;letter-spacing:-0.6px;font-weight:600;color:#1C1C1E;">${escapeHtml(title)}</h1>`
    : '';

  let tipHtml = '';
  const tipTextLines: string[] = [];
  if (input.tip) {
    const tip = input.tip;
    tipTextLines.push(tip.title, '');
    for (const para of tip.paragraphs) {
      tipTextLines.push(para, '');
    }
    const parasHtml = tip.paragraphs
      .map((para, i) => {
        const last = i === tip.paragraphs.length - 1;
        const mb = last && tip.ctaLabel ? '20px' : last ? '0' : '17px';
        return `<p style="margin:0 0 ${mb};">${escapeHtml(para)}</p>`;
      })
      .join('');
    const ctaLabel = (tip.ctaLabel ?? 'Plus d’infos').trim();
    const ctaUrl = (tip.ctaUrl ?? siteUrl).trim() || siteUrl;
    tipTextLines.push(`${ctaLabel} : ${ctaUrl}`);
    tipHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-tip" style="margin-top:32px;background:#FFF0EB;border-radius:16px;">
      <tr><td class="email-tip-pad" style="padding:27px;font-size:16px;line-height:1.65;color:#1C1C1E;">
        <p style="margin:0 0 16px;font-size:18px;font-weight:600;letter-spacing:-0.3px;">${escapeHtml(tip.title)}</p>
        ${parasHtml}
        <a href="${escapeHtml(ctaUrl)}" style="display:block;background:#FC5757;color:#1C1C1E;text-align:center;text-decoration:none;border-radius:100px;padding:14px 12px;font-size:16px;font-weight:600;">${escapeHtml(ctaLabel)}</a>
      </td></tr>
    </table>`;
  }

  const textParts = [input.textBody.trim()];
  if (tipTextLines.length) {
    textParts.push('', ...tipTextLines);
  }
  textParts.push(
    '',
    'Petit Cœur · Ton journal privé',
    `Confidentialité : ${privacyUrl}`,
    `Ne plus recevoir ces messages : ${supportEmail}`,
  );

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title>${escapeHtml(input.subject)}</title>
<!--[if mso]>
<style type="text/css">
body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
</style>
<![endif]-->
<style type="text/css">
  @media only screen and (max-width: 699px) {
    .email-container { width: 100% !important; max-width: 100% !important; }
    .email-pad { padding-left: 22px !important; padding-right: 22px !important; }
    .email-brand { padding: 22px 22px 18px !important; font-size: 18px !important; }
    .email-title { font-size: 22px !important; }
    .email-tip-pad { padding: 22px !important; }
  }
  @media only screen and (min-width: 700px) {
    .email-container { width: 640px !important; max-width: 640px !important; }
    .email-pad { padding-left: 44px !important; padding-right: 44px !important; }
  }
  @media only screen and (min-width: 1024px) {
    .email-container { width: 720px !important; max-width: 720px !important; }
    .email-pad { padding-left: 52px !important; padding-right: 52px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#FAFAF7;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="email-container" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1C1C1E;font-size:17px;line-height:1.65;">
  <tr><td class="email-brand" style="padding:27px 32px;text-align:center;font-size:20px;font-weight:500;letter-spacing:-0.6px;">Petit Cœur</td></tr>
  <tr><td class="email-pad" style="padding:0 22px 32px;">
    ${titleHtml}
    ${input.bodyHtml}
    ${tipHtml}
  </td></tr>
  <tr><td style="text-align:center;font-size:12px;line-height:1.7;color:#6B7280;padding:0 25px 28px;">
    Petit Cœur · Ton journal privé<br/>
    <a href="${privacy}" style="color:#6B7280;text-decoration:none;">Confidentialité</a>
    ·
    <a href="${unsub}" style="color:#6B7280;text-decoration:none;">Ne plus recevoir ces messages</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return {
    subject: input.subject,
    text: textParts.join('\n'),
    html,
  };
}
