import { describe, expect, it } from 'vitest';
import { computeCaptureMosaicRows } from '@/utils/captureMosaicLayout';

describe('computeCaptureMosaicRows', () => {
  it('0 enfant → []', () => {
    expect(computeCaptureMosaicRows(0)).toEqual([]);
  });

  it('1 enfant → [1]', () => {
    expect(computeCaptureMosaicRows(1)).toEqual([1]);
  });

  it('2 enfants → [2]', () => {
    expect(computeCaptureMosaicRows(2)).toEqual([2]);
  });

  it('3 enfants → [2, 1]', () => {
    expect(computeCaptureMosaicRows(3)).toEqual([2, 1]);
  });

  it('5 enfants → [2, 2, 1]', () => {
    expect(computeCaptureMosaicRows(5)).toEqual([2, 2, 1]);
  });
});
