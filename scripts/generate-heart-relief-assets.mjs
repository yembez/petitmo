/**
 * Génère noir / blanc / icône app depuis le cœur axo-outline officiel.
 *
 * Source immuable : assets/images/logo_petit_coeur_heart_relief_source.svg
 *   (= LOGO/PETIT_COEUR/petit-coeur_heart-axo-outline_OK.svg)
 *
 * Usage : node scripts/generate-heart-relief-assets.mjs
 * Prérequis : @resvg/resvg-js
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const images = path.join(root, 'assets/images');

const SVG_SOURCE = path.join(images, 'logo_petit_coeur_heart_relief_source.svg');
const OUT_NOIR_SVG = path.join(images, 'logo_petit_coeur_heart_relief_noir.svg');
const OUT_WHITE_SVG = path.join(images, 'logo_petit_coeur_heart_relief_white.svg');
const OUT_NOIR = path.join(images, 'logo_petit_coeur_heart_relief_noir.png');
const OUT_WHITE = path.join(images, 'logo_petit_coeur_heart_relief_white.png');
const OUT_ICON = path.join(images, 'icon_petit_coeur_heart.png');

/** Trait officiel du SVG source. */
const STROKE_SRC = '#111318';
const STROKE_NOIR = '#1C1C1E';
const STROKE_WHITE = '#FFFFFF';
/** Stroke du SVG source (viewBox 1024). */
const STROKE_WIDTH_SRC = 9;
const MASK_STROKE_WIDTH_SRC = 16;
/**
 * Trait icône app : plus épais pour la lisibilité home screen.
 * Vectoriel (round joins) — pas de dilatation bitmap.
 */
const ICON_STROKE_WIDTH = 28;
/** Part du canvas 1024 occupée par le bbox du cœur (après crop). */
const ICON_HEART_SCALE = 0.62;

function loadResvg() {
  const require = createRequire(import.meta.url);
  try {
    return require('@resvg/resvg-js');
  } catch {
    throw new Error(
      'Missing @resvg/resvg-js. Run once: npm install -D @resvg/resvg-js',
    );
  }
}

/** resvg n’aime pas les commentaires HTML dans certains SVG Inkscape. */
function stripSvgComments(svgText) {
  return svgText.replace(/<!--[\s\S]*?-->/g, '');
}

function recolorSvg(svgText, toColor) {
  return stripSvgComments(svgText)
    .replaceAll(STROKE_SRC, toColor)
    .replaceAll(STROKE_SRC.toLowerCase(), toColor)
    .replaceAll('fill:#111318', `fill:${toColor}`);
}

/**
 * Prépare le SVG pour l’icône app :
 * - retire path6 (fill Inkscape parasite → asymétrie de trait)
 * - épaissit stroke + mask proportionnellement
 */
function prepareIconSvg(svgText, strokeWidth) {
  const maskStroke = Math.round(
    (MASK_STROKE_WIDTH_SRC * strokeWidth) / STROKE_WIDTH_SRC,
  );
  let out = stripSvgComments(svgText).replace(
    /<path\s+id="path6"[\s\S]*?\/>/,
    '',
  );
  // Stroke du groupe principal (source = 9).
  out = out.replace(
    /(<g\b[\s\S]*?\bstroke-width=")9(")/,
    `$1${strokeWidth}$2`,
  );
  // Stroke du masque path1 (source = 16), attribut avant ou après id.
  if (out.includes('id="path1"')) {
    out = out.replace(
      /(id="path1"[\s\S]{0,120}?stroke-width=")16(")/,
      `$1${maskStroke}$2`,
    );
    out = out.replace(
      /(stroke-width=")16("[\s\S]{0,80}?id="path1")/,
      `$1${maskStroke}$2`,
    );
  }
  return out;
}

function renderSvgString(Resvg, svgText, outPath, width) {
  const resvg = new Resvg(Buffer.from(svgText), {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
  });
  fs.writeFileSync(outPath, resvg.render().asPng());
  console.log('wrote', path.relative(root, outPath), `(w=${width})`);
}

function cropPngToOpaque(pngBuffer, alphaThreshold = 12, pad = 4) {
  const img = PNG.sync.read(pngBuffer);
  const { width, height, data } = img;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      if (data[i + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    return { png: pngBuffer, width, height };
  }
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = (width * (minY + y) + (minX + x)) << 2;
      const di = (cw * y + x) << 2;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return { png: PNG.sync.write(out), width: cw, height: ch };
}

/**
 * Rendu vectoriel 2× + compose Pillow (LANCZOS) pour des traits nets.
 */
function composeAppIcon(Resvg, whiteSvgText, size = 1024) {
  const thickWhite = prepareIconSvg(whiteSvgText, ICON_STROKE_WIDTH);
  const renderSize = size * 2;
  const heartPng = new Resvg(Buffer.from(thickWhite), {
    fitTo: { mode: 'width', value: renderSize },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng();

  const tmpHeart = path.join(images, '.tmp_icon_heart_2x.png');
  fs.writeFileSync(tmpHeart, heartPng);

  const pyCandidates = [
    '/tmp/petitmo-img-venv/bin/python',
    'python3',
    'python',
  ];
  const composeScript = path.join(root, 'scripts/compose-app-icon.py');
  let composed = false;
  for (const py of pyCandidates) {
    try {
      const r = spawnSync(
        py,
        [composeScript, tmpHeart, OUT_ICON, String(ICON_HEART_SCALE)],
        { encoding: 'utf8' },
      );
      if (r.status === 0) {
        composed = true;
        if (r.stdout) process.stdout.write(r.stdout);
        break;
      }
      if (r.stderr) process.stderr.write(r.stderr);
    } catch {
      // try next
    }
  }

  try {
    fs.unlinkSync(tmpHeart);
  } catch {
    // ignore
  }

  if (!composed) {
    // Fallback resvg (qualité un peu inférieure)
    const cropped = cropPngToOpaque(heartPng);
    const maxDim = Math.max(cropped.width, cropped.height);
    const target = Math.round(size * ICON_HEART_SCALE);
    const scale = target / maxDim;
    const dw = Math.round(cropped.width * scale);
    const dh = Math.round(cropped.height * scale);
    const padX = Math.round((size - dw) / 2);
    const padY = Math.round((size - dh) / 2);
    const b64 = cropped.png.toString('base64');
    const composeSvg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="splash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FD628D"/>
      <stop offset="1" stop-color="#FD6764"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#splash)"/>
  <image x="${padX}" y="${padY}" width="${dw}" height="${dh}"
    xlink:href="data:image/png;base64,${b64}"/>
</svg>`;
    fs.writeFileSync(
      OUT_ICON,
      new Resvg(Buffer.from(composeSvg), {
        fitTo: { mode: 'width', value: size },
      })
        .render()
        .asPng(),
    );
  }

  const iosIcon = path.join(
    root,
    'ios/Petitmo/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png',
  );
  fs.copyFileSync(OUT_ICON, iosIcon);
  console.log(
    'wrote',
    path.relative(root, OUT_ICON),
    `+ AppIcon (stroke=${ICON_STROKE_WIDTH}, scale=${ICON_HEART_SCALE})`,
  );
}

function main() {
  const { Resvg } = loadResvg();
  const src = fs.readFileSync(SVG_SOURCE, 'utf8');
  const noirSvg = recolorSvg(src, STROKE_NOIR);
  const whiteSvg = recolorSvg(src, STROKE_WHITE);

  fs.writeFileSync(OUT_NOIR_SVG, noirSvg);
  fs.writeFileSync(OUT_WHITE_SVG, whiteSvg);

  renderSvgString(Resvg, noirSvg, OUT_NOIR, 1024);
  renderSvgString(Resvg, whiteSvg, OUT_WHITE, 1024);
  renderSvgString(
    Resvg,
    noirSvg,
    path.join(images, 'logo_petit_coeur_heart_relief_noir_128.png'),
    128,
  );
  renderSvgString(
    Resvg,
    whiteSvg,
    path.join(images, 'logo_petit_coeur_heart_relief_white_128.png'),
    128,
  );
  // Icône app = cœur géométrique epais_1 (pas le SVG courbe OK).
  // Voir : node/python scripts/compose-epais-app-icon.py
  console.log(
    'skip app icon here — run: python3 scripts/compose-epais-app-icon.py',
  );
}

main();
