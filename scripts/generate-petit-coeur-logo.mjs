/**
 * Synchronise `petitCoeurLogoXml.ts` depuis le SVG reconstruit groupé.
 * Usage : node scripts/generate-petit-coeur-logo.mjs
 *
 * Source : assets/images/logo_petit_coeur_rebuilt.svg
 * (copie de LOGO/PETIT_COEUR/PetitCoeur_logo_rebuilt_grouped.svg)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SRC_SVG = path.join(root, 'assets/images/logo_petit_coeur_rebuilt.svg');
const OUT_TS = path.join(root, 'components/petitCoeurLogoXml.ts');

function main() {
  const svg = fs.readFileSync(SRC_SVG, 'utf8');
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) throw new Error('viewBox manquant dans le SVG');
  const [, , wRaw, hRaw] = m[1].split(/\s+/);
  const w = Number(wRaw);
  const h = Number(hRaw);
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`viewBox invalide: ${m[1]}`);
  }

  const escaped = svg.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const ts = `/** Lockup Petit Cœur — SVG reconstruit groupé (wordmark / heart / ellipsis). */
export const PETIT_COEUR_LOGO_VIEWBOX = { x: 0, y: 0, width: ${w}, height: ${h} } as const;

export const PETIT_COEUR_LOGO_XML = \`${escaped}\`;
`;
  fs.writeFileSync(OUT_TS, ts, 'utf8');
  console.log(`Wrote ${OUT_TS} (${w}x${h})`);
}

main();
