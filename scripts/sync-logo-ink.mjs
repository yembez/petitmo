import fs from 'fs';

const src = new URL('../components/petitmoLogoManuscritXml.ts', import.meta.url);
const dest = new URL('../server/src/pdf/petitmoLogoManuscritInk.ts', import.meta.url);

const s = fs.readFileSync(src, 'utf8');
const m = s.match(/export const PETITMO_LOGO_MANUSCRIT_XML = `([\s\S]*)`;/);
if (!m) throw new Error('PETITMO_LOGO_MANUSCRIT_XML not found');
let xml = m[1];
xml = xml
  .replace(/fill:\s*#fefbfd/gi, 'fill:#1C1C1E')
  .replace(/fill="\s*#fefbfd\s*"/gi, 'fill="#1C1C1E"');

const body = `/** Sync: run \`node scripts/sync-logo-ink.mjs\` after editing components/petitmoLogoManuscritXml.ts */
export const PETITMO_LOGO_MANUSCRIT_XML_INK = ${JSON.stringify(xml)} as const;
`;

fs.writeFileSync(dest, body, 'utf8');
console.log('Wrote', dest.pathname, body.length);
