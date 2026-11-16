import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findSlotRowLine, rowCropRect, type OcrLineBox } from '../../../domain/labelRowReread.js';

const line = (text: string, y0: number, y1: number): OcrLineBox => ({ text, bbox: { x0: 40, y0, x1: 900, y1 } });

describe('labelRowReread', () => {
  const lines = [
    line('Sodium 230mg 10%', 100, 140),
    line('[Total Carbohydratedg 1% | 2 9', 150, 190),
    line('Dietary Fiber 1g 4%', 200, 240),
    line('Total Sugars 2g', 250, 290),
  ];

  it('finds a nutrient row by fuzzy label, not by value', () => {
    assert.equal(findSlotRowLine(lines, 'carbs')?.bbox.y0, 150);
    assert.equal(findSlotRowLine(lines, 'fiber')?.bbox.y0, 200);
    assert.equal(findSlotRowLine(lines, 'protein'), null);
  });

  it('crops a full-width padded band clamped to the image', () => {
    assert.deepEqual(rowCropRect({ x0: 40, y0: 150, x1: 900, y1: 190 }, 1600, 3000), {
      left: 0,
      top: 142,
      width: 1600,
      height: 56,
    });
    assert.equal(rowCropRect({ x0: 0, y0: 10, x1: 10, y1: 12 }, 1600, 3000), null);
    assert.equal(rowCropRect({ x0: 0, y0: 0, x1: 100, y1: 40 }, 1600, 30)?.height, 30);
  });
});
