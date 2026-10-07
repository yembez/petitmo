import { describe, expect, it } from 'vitest';
import { stripEmojisForBook } from '@/utils/stripEmojisForBook';

describe('stripEmojisForBook', () => {
  it('retire les emoji simples et laisse le texte', () => {
    expect(stripEmojisForBook('Bonjour 😊 monde')).toBe('Bonjour monde');
    expect(stripEmojisForBook('❤️ amour')).toBe('amour');
  });

  it('retire les séquences ZWJ et keycaps', () => {
    expect(stripEmojisForBook('Famille 👨‍👩‍👧 ici')).toBe('Famille ici');
    expect(stripEmojisForBook('Note 1️⃣')).toBe('Note');
  });

  it('conserve les alinéas / sauts de ligne utiles', () => {
    expect(stripEmojisForBook('Ligne 1 🎉\n\nLigne 2')).toBe('Ligne 1\n\nLigne 2');
  });

  it('idempotent et no-op sur texte sans emoji', () => {
    const plain = 'Petits mots sans emoji.';
    expect(stripEmojisForBook(plain)).toBe(plain);
    expect(stripEmojisForBook(stripEmojisForBook('Hi 👋'))).toBe('Hi');
  });

  it('titre uniquement emoji → chaîne vide après trim', () => {
    expect(stripEmojisForBook('🥰').trim()).toBe('');
  });
});
