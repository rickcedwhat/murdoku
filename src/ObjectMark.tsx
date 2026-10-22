import type { Puzzle, WallSide } from './puzzle';

type Kind = Puzzle['objectKinds'][number];
const images = new Set(['chair', 'bed', 'desk', 'tv', 'plant']);

export function ObjectMark({ kind, className = '', connections = [] }: { kind: Kind; className?: string; connections?: WallSide[] }) {
  if (images.has(kind.art)) return <img aria-hidden="true" draggable={false} className={`object-image ${className}`} src={`/objects/${kind.art}-front.png`} alt="" />;
  if (kind.art === 'table' || kind.art === 'carpet') return <span aria-hidden="true" className={`object-tile tile-${kind.art} ${connections.map((side) => `joined-${side.toLowerCase()}`).join(' ')} ${className}`} />;
  if (kind.art === 'bar') return <span aria-hidden="true" className={`object-bar ${className}`} />;
  return <span aria-hidden="true" className={`object-custom ${className}`}>{kind.name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}
