import { describe, expect, it } from 'vitest';
import type { Child } from '@/types/local';
import {
  computeChildAge,
  formatAge,
  formatFamilyAgesLine,
} from '@/utils/childrenAge';

function child(partial: Pick<Child, 'id' | 'name'> & { birthdate?: string | null }): Child {
  return {
    id: partial.id,
    user_id: 'u1',
    name: partial.name,
    birthdate: partial.birthdate ?? '',
    photo_url: null,
    created_at: '2020-01-01',
    updated_at: '2020-01-01',
    local_photo_path: null,
  };
}

describe('formatAge', () => {
  it('affiche les mois avant 24 mois', () => {
    expect(formatAge(0, 11)).toBe('11 mois');
    expect(formatAge(1, 0)).toBe('12 mois');
  });

  it('affiche années + mois entre 2 et 5 ans', () => {
    expect(formatAge(3, 2)).toBe('3 ans 2 mois');
    expect(formatAge(3, 0)).toBe('3 ans');
  });

  it('affiche années seules après 5 ans', () => {
    expect(formatAge(7, 4)).toBe('7 ans');
  });

  it('mode compact (3+ enfants) : a / m', () => {
    expect(formatAge(0, 11, { compact: true })).toBe('11 m');
    expect(formatAge(3, 2, { compact: true })).toBe('3 a 2 m');
    expect(formatAge(7, 4, { compact: true })).toBe('7 a');
  });
});

describe('computeChildAge', () => {
  it('retourne null avant la naissance', () => {
    expect(computeChildAge('2024-06-01', '2024-05-01')).toBeNull();
  });
});

describe('formatFamilyAgesLine', () => {
  it('0 enfant → chaîne vide', () => {
    expect(formatFamilyAgesLine([], '2024-06-01')).toBe('');
  });

  it('1 enfant, 11 mois', () => {
    const lea = child({ id: '1', name: 'Léa', birthdate: '2023-07-15' });
    expect(formatFamilyAgesLine([lea], '2024-06-15')).toBe('Léa 11 mois');
  });

  it('1 enfant, 3 ans 2 mois', () => {
    const lea = child({ id: '1', name: 'Léa', birthdate: '2021-04-10' });
    expect(formatFamilyAgesLine([lea], '2024-06-10')).toBe('Léa 3 ans 2 mois');
  });

  it('1 enfant, 7 ans', () => {
    const lea = child({ id: '1', name: 'Léa', birthdate: '2017-06-01' });
    expect(formatFamilyAgesLine([lea], '2024-06-01')).toBe('Léa 7 ans');
  });

  it('2 enfants sans collision initiale', () => {
    const lucas = child({ id: '1', name: 'Lucas', birthdate: '2021-06-01' });
    const theo = child({ id: '2', name: 'Théo', birthdate: '2023-07-01' });
    expect(formatFamilyAgesLine([theo, lucas], '2024-06-01')).toBe('L. 3 ans - T. 11 mois');
  });

  it('2 enfants avec collision initiale (Léa + Lucas)', () => {
    const lea = child({ id: '1', name: 'Léa', birthdate: '2021-06-01' });
    const lucas = child({ id: '2', name: 'Lucas', birthdate: '2023-07-01' });
    expect(formatFamilyAgesLine([lea, lucas], '2024-06-01')).toBe('Léa 3 ans - Luc 11 mois');
  });

  it('3 enfants : initiales + âges compacts', () => {
    const lucas = child({ id: '1', name: 'Lucas', birthdate: '2019-06-01' });
    const theo = child({ id: '2', name: 'Théo', birthdate: '2021-06-01' });
    const emma = child({ id: '3', name: 'Emma', birthdate: '2023-07-01' });
    expect(formatFamilyAgesLine([lucas, theo, emma], '2024-06-01')).toBe(
      'L. 5 a - T. 3 a - E. 11 m',
    );
  });

  it('1 enfant sans birthdate → chaîne vide', () => {
    const lea = child({ id: '1', name: 'Léa', birthdate: '' });
    expect(formatFamilyAgesLine([lea], '2024-06-01')).toBe('');
  });

  it('exclut un enfant pas encore né à la date du souvenir', () => {
    const lea = child({ id: '1', name: 'Léa', birthdate: '2020-01-01' });
    const cadet = child({ id: '2', name: 'Tom', birthdate: '2025-01-01' });
    expect(formatFamilyAgesLine([lea, cadet], '2024-06-01')).toBe('Léa 4 ans 5 mois');
    expect(formatFamilyAgesLine([lea, cadet], '2024-06-01')).not.toContain('Tom');
  });
});
