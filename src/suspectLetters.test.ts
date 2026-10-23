import { describe, expect, it } from 'vitest';
import { newPuzzle } from './puzzle';
import { suspectLetter, suspectsForInitial } from './suspectLetters';

describe('suspect letters', () => {
  it('keeps unique initials and the victim V', () => {
    const puzzle = newPuzzle();
    const suspects = puzzle.suspects.slice(0, 3).map((person, index) => ({ ...person, name: ['Amelia', 'Birdie', 'Vincent'][index], isVictim: index === 2 }));
    expect(suspects.map((person) => suspectLetter(suspects, person.id))).toEqual(['A', 'B', 'V']);
  });

  it('distinguishes repeated initials and a non-victim whose name begins with V', () => {
    const puzzle = newPuzzle();
    const suspects = puzzle.suspects.slice(0, 4).map((person, index) => ({ ...person, name: ['Pat', 'Pam', 'Victor', 'Vincent'][index], isVictim: index === 3 }));
    expect(suspects.map((person) => suspectLetter(suspects, person.id))).toEqual(['P1', 'P2', 'V1', 'V']);
    expect(suspectsForInitial(suspects, 'p').map((person) => person.name)).toEqual(['Pat', 'Pam']);
    expect(suspectsForInitial(suspects, 'v').map((person) => person.name)).toEqual(['Victor', 'Vincent']);
  });
});
