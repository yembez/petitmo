/**
 * Hauteurs d’onde « organiques » (pas de vraie analyse audio).
 * Évite la sinusoïde trop régulière — pauses, pics, marche corrélée.
 */
export function organicWaveBars(count: number, seed = 0x50f17e): number[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  const out: number[] = [];
  let prev = 0.4 + rnd() * 0.25;

  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0.5 : i / (count - 1);
    /** Enveloppe douce type parole : plus calme aux extrémités. */
    const envelope = 0.28 + 0.72 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    /** Marche aléatoire corrélée (pas un bruit blanc pur). */
    prev = Math.min(1, Math.max(0.06, prev + (rnd() - 0.5) * 0.62));
    let amp = (0.1 + prev * 0.78) * envelope;

    /** Pic occasionnel. */
    if (rnd() > 0.84) {
      amp = Math.max(amp, (0.55 + rnd() * 0.45) * envelope);
    }
    /** Creux / micro-pause. */
    if (rnd() > 0.87) {
      amp *= 0.12 + rnd() * 0.28;
    }
    /** Plateau court (2–3 barres voisines un peu plus hautes). */
    if (rnd() > 0.93 && i + 1 < count) {
      amp = Math.max(amp, 0.5 * envelope);
    }

    out.push(Math.min(1, Math.max(0.06, amp)));
  }

  return out;
}
