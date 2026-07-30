/**
 * Tests unitaires — markup crop Chromium-safe (mm, jamais left/top %).
 * Run: `cd server && npx tsx --test src/pdf/bookPhotoCropLayout.test.ts`
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coverCropFrameHtml,
  coverCropImgInlineStyle,
  cropMarkupUsesFragilePercentPositioning,
  isDefaultPhotoCrop,
} from './bookPhotoCropLayout';

const FRAME_W = 210;
const FRAME_H = 171;
const IMG_W = 3000;
const IMG_H = 2000;

describe('coverCropFrameHtml — Chromium-safe', () => {
  it('cadre toujours dimensionné en mm', () => {
    const html = coverCropFrameHtml({
      srcAttr: 'https://example.com/a.jpg',
      frameRefW: FRAME_W,
      frameRefH: FRAME_H,
    });
    assert.match(html, /width:210\.000mm/);
    assert.match(html, /height:171\.000mm/);
    assert.equal(cropMarkupUsesFragilePercentPositioning(html), false);
  });

  it('crop défaut → object-fit cover, pas de left%', () => {
    const html = coverCropFrameHtml({
      srcAttr: 'https://example.com/a.jpg',
      crop: { xPct: 0, yPct: 0, scale: 1 },
      imgPxW: IMG_W,
      imgPxH: IMG_H,
      frameRefW: FRAME_W,
      frameRefH: FRAME_H,
      fitMode: 'strict',
    });
    assert.match(html, /object-fit:cover/);
    assert.equal(cropMarkupUsesFragilePercentPositioning(html), false);
  });

  it('crop custom + dims → left/top/width/height en mm uniquement', () => {
    const html = coverCropFrameHtml({
      srcAttr: 'https://example.com/a.jpg',
      crop: { xPct: 12, yPct: -8, scale: 1.35 },
      imgPxW: IMG_W,
      imgPxH: IMG_H,
      frameRefW: FRAME_W,
      frameRefH: FRAME_H,
    });
    assert.match(html, /left:-?[\d.]+mm/);
    assert.match(html, /top:-?[\d.]+mm/);
    assert.match(html, /width:[\d.]+mm/);
    assert.match(html, /height:[\d.]+mm/);
    assert.doesNotMatch(html, /left:-?[\d.]+%/);
    assert.doesNotMatch(html, /top:-?[\d.]+%/);
    assert.equal(cropMarkupUsesFragilePercentPositioning(html), false);
  });

  it('crop custom sans dims → fallback cover (pas de chemin % fragile)', () => {
    const html = coverCropFrameHtml({
      srcAttr: 'https://example.com/a.jpg',
      crop: { xPct: 20, yPct: 10, scale: 1.5 },
      frameRefW: FRAME_W,
      frameRefH: FRAME_H,
    });
    assert.match(html, /object-fit:cover/);
    assert.equal(cropMarkupUsesFragilePercentPositioning(html), false);
  });

  it('lockFrameMm déprécié n’ouvre plus le chemin %', () => {
    const html = coverCropFrameHtml({
      srcAttr: 'https://example.com/a.jpg',
      crop: { xPct: 5, yPct: 5, scale: 1.2 },
      imgPxW: IMG_W,
      imgPxH: IMG_H,
      frameRefW: 186,
      frameRefH: 186,
      lockFrameMm: false, // anciennement = chemin %
    });
    assert.equal(cropMarkupUsesFragilePercentPositioning(html), false);
    assert.match(html, /left:-?[\d.]+mm/);
  });

  it('coverCropImgInlineStyle n’émet plus de %', () => {
    const style = coverCropImgInlineStyle(
      { xPct: 10, yPct: -5, scale: 1.4 },
      IMG_W,
      IMG_H,
      FRAME_W,
      FRAME_H,
    );
    assert.match(style, /mm/);
    assert.doesNotMatch(style, /%/);
    assert.equal(isDefaultPhotoCrop({ xPct: 0, yPct: 0, scale: 1 }), true);
    assert.equal(isDefaultPhotoCrop({ xPct: 1, yPct: 0, scale: 1 }), false);
  });

  it('src vide → markup vide', () => {
    assert.equal(
      coverCropFrameHtml({
        srcAttr: '  ',
        frameRefW: 10,
        frameRefH: 10,
      }),
      '',
    );
  });
});
