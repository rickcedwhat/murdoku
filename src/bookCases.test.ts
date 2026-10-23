import { describe, expect, it } from 'vitest';
import collegeDormitory from '../local-cases/46-college-dormitory.json';
import { parsePuzzle, validatePuzzle } from './puzzle';

describe('College Dormitory book case', () => {
  it('loads as a playable case with separate carpets and wall windows', () => {
    const puzzle = parsePuzzle(collegeDormitory);
    expect(validatePuzzle(puzzle)).toEqual([]);
    expect(puzzle.rooms).toHaveLength(6);
    expect(puzzle.suspects).toHaveLength(9);
    expect(puzzle.objects.filter((object) => object.kindId === 'carpet').length).toBeGreaterThan(1);
    expect(puzzle.objects.filter((object) => object.kindId === 'window')).toHaveLength(3);
  });
});
