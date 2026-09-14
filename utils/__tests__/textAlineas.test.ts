import { describe, expect, it } from 'vitest';
import {
  TEXT_ALINEA_EM_QUAD as EM,
  applyTextAlineasForInput,
  reconcileTextAlineasOnChange,
  stripTextAlineas,
} from '@/utils/textAlineas';

describe('textAlineas', () => {
  it('applique un cadratin en tête de chaque ligne non vide', () => {
    expect(applyTextAlineasForInput('Bonjour\n\nMonde')).toBe(
      `${EM}Bonjour\n\n${EM}Monde`,
    );
  });

  it('strip retire tous les cadratins', () => {
    expect(stripTextAlineas(`${EM}Bonjour\n${EM}Monde`)).toBe('Bonjour\nMonde');
  });

  it('backspace sur alinéa de 2ᵉ ligne fusionne avec la précédente', () => {
    const prev = `${EM}Bonjour\n${EM}Monde`;
    // Curseur après l’alinéa de la 2ᵉ ligne → backspace ne retire que le cadratin.
    const next = `${EM}Bonjour\nMonde`;
    expect(reconcileTextAlineasOnChange(prev, next)).toBe(`${EM}BonjourMonde`);
  });

  it('backspace sur alinéa après double saut fusionne d’un seul \\n', () => {
    const prev = `${EM}A\n\n${EM}B`;
    const next = `${EM}A\n\nB`;
    expect(reconcileTextAlineasOnChange(prev, next)).toBe(`${EM}A\n${EM}B`);
  });

  it('backspace sur alinéa de 1ʳᵉ ligne efface le 1ʳᵉ caractère', () => {
    const prev = `${EM}Hello`;
    const next = `Hello`; // cadratin retiré
    expect(reconcileTextAlineasOnChange(prev, next)).toBe(`${EM}ello`);
  });

  it('saisie normale conserve les alinéas', () => {
    const prev = `${EM}Bonjour`;
    const next = `${EM}Bonjours`;
    expect(reconcileTextAlineasOnChange(prev, next)).toBe(`${EM}Bonjours`);
  });
});
