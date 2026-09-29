/**
 * Génère le wordmark « Petit Cœur » seul (sans bulle / cœur / ellipsis)
 * depuis `assets/images/logo_petit_coeur_rebuilt.svg` (groupe `#wordmark`).
 *
 * Usage : node scripts/generate-petit-coeur-wordmark.mjs
 * Prérequis : @resvg/resvg-js
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const images = path.join(root, 'assets/images');
const SRC = path.join(images, 'logo_petit_coeur_rebuilt.svg');

const VB = { x: 0, y: 0, w: 1570, h: 270 };

function loadResvg() {
  try {
    return require('@resvg/resvg-js');
  } catch {
    throw new Error('Missing @resvg/resvg-js. Run: npm install -D @resvg/resvg-js');
  }
}

function extractWordmark(svg) {
  const m = svg.match(/<g id="wordmark">([\s\S]*?)<\/g>/);
  if (!m) throw new Error('groupe #wordmark manquant');
  return m[1];
}

function makeSvg(inner, fill) {
  const tinted = inner
    .replace(/fill="[^"]*"/g, `fill="${fill}"`)
    .replace(/stroke="[^"]*"/g, `stroke="${fill}"`);
  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="${VB.w}" height="${VB.h}" fill="none">
  <g id="wordmark">${tinted}</g>
</svg>`;
}

function renderPng(Resvg, svgText, outPath, widthPx) {
  const resvg = new Resvg(Buffer.from(svgText), {
    fitTo: { mode: 'width', value: widthPx },
    background: 'rgba(0,0,0,0)',
  });
  fs.writeFileSync(outPath, resvg.render().asPng());
  console.log('wrote', path.relative(root, outPath));
}

function main() {
  const { Resvg } = loadResvg();
  const src = fs.readFileSync(SRC, 'utf8');
  const inner = extractWordmark(src);
  const white = makeSvg(inner, '#FFFFFF');
  const noir = makeSvg(inner, '#1F1F23');

  fs.writeFileSync(path.join(images, 'logo_petit_coeur_wordmark.svg'), white);
  renderPng(Resvg, white, path.join(images, 'logo_petit_coeur_wordmark_white.png'), 1200);
  renderPng(Resvg, noir, path.join(images, 'logo_petit_coeur_wordmark_noir.png'), 1200);

  const escaped = white.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  fs.writeFileSync(
    path.join(root, 'components/petitCoeurWordmarkXml.ts'),
    `/** Wordmark manuscrit « Petit Cœur » seul (sans bulle / cœur / ellipsis). */
export const PETIT_COEUR_WORDMARK_VIEWBOX = { width: ${VB.w}, height: ${VB.h} } as const;

export const PETIT_COEUR_WORDMARK_XML_WHITE = \`${escaped}\`;
`,
  );
  console.log('ok');
}

main();
