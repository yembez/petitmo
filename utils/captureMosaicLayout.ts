/**
 * Découpe une mosaïque Capturer en lignes de 1 ou 2 tuiles.
 * Ex. 5 enfants → [2, 2, 1].
 */
export function computeCaptureMosaicRows(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  if (count === 2) return [2];
  if (count === 3) return [2, 1];

  const rows: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    const cols = remaining >= 2 ? 2 : 1;
    rows.push(cols);
    remaining -= cols;
  }
  return rows;
}
