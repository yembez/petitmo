import { describe, expect, it } from 'vitest';
import {
  applyLeadingCapitalWhenStartingText,
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
});
