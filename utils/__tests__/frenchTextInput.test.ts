import { describe, expect, it } from 'vitest';
import {
  applyLeadingCapitalWhenStartingText,
  applySentenceAndParagraphCapitals,
  capitalizeFirstLetterFr,
} from '@/utils/frenchTextInput';

describe('frenchTextInput', () => {
  it('capitalise la première lettre', () => {
    expect(capitalizeFirstLetterFr('bonjour')).toBe('Bonjour');
    expect(capitalizeFirstLetterFr('  bonjour')).toBe('  Bonjour');
  });

  it('corrige la dictée sur champ vide uniquement', () => {
    expect(applyLeadingCapitalWhenStartingText('', 'bonjour')).toBe('Bonjour');
    expect(applyLeadingCapitalWhenStartingText('Déjà', 'déjà')).toBe('déjà');
  });

  it('capitalise après un point et en tête de ligne', () => {
    expect(applySentenceAndParagraphCapitals('bonjour. salut')).toBe('Bonjour. Salut');
    expect(applySentenceAndParagraphCapitals('bonjour\nsalut')).toBe('Bonjour\nSalut');
    expect(applySentenceAndParagraphCapitals('bonjour\n\nsalut')).toBe('Bonjour\n\nSalut');
    expect(applySentenceAndParagraphCapitals('déjà.  été')).toBe('Déjà.  Été');
    expect(applySentenceAndParagraphCapitals('Fin... suite')).toBe('Fin... Suite');
    expect(applySentenceAndParagraphCapitals('ok ? oui')).toBe('Ok ? Oui');
  });

  it('ne casse pas les décimales ni les domaines', () => {
    expect(applySentenceAndParagraphCapitals('3.14 et plus')).toBe('3.14 et plus');
    expect(applySentenceAndParagraphCapitals('voir www.apple.com')).toBe('Voir www.apple.com');
  });
});
