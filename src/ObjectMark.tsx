import type { Puzzle, WallSide } from './puzzle';

type Kind = Puzzle['objectKinds'][number];
const images = new Set(['chair', 'desk', 'tv', 'plant']);

export function ObjectMark({ kind, className = '', connections = [], bedPart, bedAxis = 'horizontal' }: { kind: Kind; className?: string; connections?: WallSide[]; bedPart?: 'first' | 'second'; bedAxis?: 'horizontal' | 'vertical' }) {
  if (images.has(kind.art)) return <img aria-hidden="true" draggable={false} className={`object-image ${className}`} src={`/objects/${kind.art}-front.png`} alt="" />;
  if (kind.art === 'bed') return bedPart
    ? <span aria-hidden="true" className={`object-bed-segment bed-${bedAxis} bed-${bedPart} ${className}`} />
    : <img aria-hidden="true" draggable={false} className={`object-image ${className}`} src="/objects/bed-front.png" alt="" />;
  if (kind.art === 'bookcase') return <img aria-hidden="true" draggable={false} className={`object-image ${className}`} src="/objects/bookcase-front.svg" alt="" />;
  if (kind.art === 'table' || kind.art === 'carpet') return <span aria-hidden="true" className={`object-tile tile-${kind.art} ${connections.map((side) => `joined-${side.toLowerCase()}`).join(' ')} ${className}`} />;
  if (kind.art === 'bar') return <span aria-hidden="true" className={`object-bar ${className}`} />;
  return <span aria-hidden="true" className={`object-custom ${className}`}>{kind.name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}
