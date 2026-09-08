import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(join(__dirname, 'htmlBook.ts'), 'utf8');

function linkedFamilies(): Set<string> {
  const link = source.match(/fonts\.googleapis\.com\/css2\?([^"']+)/)?.[1];
  assert.ok(link, 'Lien Google Fonts introuvable dans htmlBook.ts');
  const families = new Set<string>();
  for (const m of link.matchAll(/family=([^:&]+)/g)) {
    families.add(decodeURIComponent(m[1]!).replace(/\+/g, ' '));
  }
  return families;
}

test('toute font-family du PDF est réellement chargée', () => {
  const available = linkedFamilies();
  const missing = new Set<string>();
  for (const m of source.matchAll(/font-family\s*:\s*'([^']+)'/g)) {
    const family = m[1]!;
    if (!available.has(family)) missing.add(family);
  }
  assert.deepEqual(
    [...missing],
    [],
    `Familles référencées mais non chargées (Chromium retomberait sur serif/sans-serif système) : ${[...missing].join(', ')}`,
  );
});
