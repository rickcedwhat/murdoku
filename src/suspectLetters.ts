import type { Puzzle } from './puzzle';

type Suspect = Puzzle['suspects'][number];

export function suspectInitial(suspect: Suspect): string {
  return suspect.isVictim ? 'V' : suspect.name.trim().charAt(0).toUpperCase() || '?';
}

export function suspectsForInitial(suspects: Suspect[], initial: string): Suspect[] {
  return suspects.filter((suspect) => suspectInitial(suspect) === initial.toUpperCase());
}

export function suspectLetter(suspects: Suspect[], id: string): string {
  const suspect = suspects.find((person) => person.id === id);
  if (!suspect) return '?';
  if (suspect.isVictim) return 'V';
  const initial = suspectInitial(suspect);
  const peers = suspects.filter((person) => !person.isVictim && suspectInitial(person) === initial);
  if (peers.length === 1 && !(initial === 'V' && suspects.some((person) => person.isVictim))) return initial;
  return `${initial}${peers.findIndex((person) => person.id === id) + 1}`;
}
