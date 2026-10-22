import type { Puzzle, WallSide } from './puzzle';

type Kind = Puzzle['objectKinds'][number];
const images = new Set(['chair', 'desk', 'tv', 'plant']);

export function ObjectMark({ kind, className = '', connections = [], bedPart, bedAxis = 'horizontal', bedReverse = false }: { kind: Kind; className?: string; connections?: WallSide[]; bedPart?: 'first' | 'second'; bedAxis?: 'horizontal' | 'vertical'; bedReverse?: boolean }) {
  if (images.has(kind.art)) return <img aria-hidden="true" draggable={false} className={`object-image ${className}`} src={`/objects/${kind.art}-map.svg?v=3`} alt="" />;
  if (kind.art === 'bed') return bedPart
    ? <span aria-hidden="true" className={`object-bed-segment bed-${bedAxis} bed-${partForDirection(bedPart, bedReverse)} ${bedReverse ? 'bed-reverse' : ''} ${className}`} />
    : <img aria-hidden="true" draggable={false} className={`object-image ${className}`} src="/objects/bed-map-vertical.svg?v=3" alt="" />;
  if (kind.art === 'bookcase') return <img aria-hidden="true" draggable={false} className={`object-image ${className}`} src="/objects/bookcase-front.svg?v=3" alt="" />;
  if (kind.art === 'table' || kind.art === 'carpet') return <span aria-hidden="true" className={`object-tile tile-${kind.art} ${connections.map((side) => `joined-${side.toLowerCase()}`).join(' ')} ${className}`} />;
  if (kind.art === 'bar') return <span aria-hidden="true" className={`object-bar ${className}`} />;
  return <span aria-hidden="true" className={`object-custom ${className}`}>{kind.name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}

function partForDirection(part: 'first' | 'second', reverse: boolean) {
  return reverse ? (part === 'first' ? 'second' : 'first') : part;
}
