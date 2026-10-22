import { z } from 'zod';

const cellSchema = z.string().regex(/^\d+,\d+$/);
const wallSideSchema = z.enum(['N', 'E', 'S', 'W']);
export const OBJECT_ART = ['chair', 'bed', 'carpet', 'desk', 'table', 'tv', 'plant', 'bookcase', 'custom', 'bar'] as const;
const objectArtSchema = z.enum(OBJECT_ART);

export const DEFAULT_OBJECT_KINDS = [
  { id: 'chair', name: 'Chair', canOccupy: true, onWall: false, outsideOnly: false, art: 'chair' },
  { id: 'bed', name: 'Bed', canOccupy: true, onWall: false, outsideOnly: false, art: 'bed' },
  { id: 'carpet', name: 'Carpet', canOccupy: true, onWall: false, outsideOnly: false, art: 'carpet' },
  { id: 'desk', name: 'Desk', canOccupy: false, onWall: false, outsideOnly: false, art: 'desk' },
  { id: 'table', name: 'Table', canOccupy: false, onWall: false, outsideOnly: false, art: 'table' },
  { id: 'tv', name: 'TV', canOccupy: false, onWall: false, outsideOnly: false, art: 'tv' },
  { id: 'plant', name: 'Plant', canOccupy: false, onWall: false, outsideOnly: false, art: 'plant' },
  { id: 'bookcase', name: 'Bookcase', canOccupy: false, onWall: false, outsideOnly: false, art: 'bookcase' },
  { id: 'window', name: 'Window', canOccupy: true, onWall: true, outsideOnly: true, art: 'bar' },
] as const;

export const puzzleSchema = z.object({
  version: z.literal(2),
  appearanceVersion: z.literal(4),
  id: z.string().min(1),
  title: z.string(),
  rows: z.number().int().min(1).max(24),
  cols: z.number().int().min(1).max(24),
  playable: z.array(cellSchema),
  rooms: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    cells: z.array(cellSchema),
  })),
  objectKinds: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    canOccupy: z.boolean(),
    onWall: z.boolean(),
    outsideOnly: z.boolean().default(false),
    art: objectArtSchema,
  })),
  objects: z.array(z.object({
    id: z.string().min(1),
    kindId: z.string().min(1),
    cell: cellSchema,
    side: wallSideSchema.optional(),
    bedDirection: wallSideSchema.optional(),
  })),
  walls: z.array(z.object({ from: cellSchema, to: cellSchema })),
  suspects: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    clue: z.string(),
    portrait: z.string().optional(),
    isVictim: z.boolean(),
  })),
  caseClues: z.array(z.string()),
  rules: z.object({
    emptyRows: z.number().int().min(0).optional(),
    emptyCols: z.number().int().min(0).optional(),
    emptyRooms: z.number().int().min(0).optional(),
  }),
});

export type Puzzle = z.infer<typeof puzzleSchema>;
export type Cell = `${number},${number}`;
export type Placement = { suspectId: string; cell: Cell };
export type WallSide = z.infer<typeof wallSideSchema>;
export type ObjectArt = z.infer<typeof objectArtSchema>;

export function normalizeRuleCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function normalizeRules(rules: unknown): unknown {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return rules;
  const normalized = { ...rules } as Record<string, unknown>;
  for (const key of ['emptyRows', 'emptyCols', 'emptyRooms']) {
    if (typeof normalized[key] === 'number') normalized[key] = normalizeRuleCount(normalized[key]);
  }
  return normalized;
}

const puzzleV1Schema = z.object({
  version: z.literal(1),
  id: z.string(), title: z.string(), rows: z.number(), cols: z.number(),
  playable: z.array(cellSchema),
  rooms: z.array(z.object({ id: z.string(), name: z.string(), cells: z.array(cellSchema) })),
  objects: z.array(z.object({ id: z.string(), name: z.string(), cell: cellSchema, capacity: z.union([z.literal(0), z.literal(1)]) })),
  walls: z.array(z.object({ from: cellSchema, to: cellSchema })),
  suspects: z.array(z.object({ id: z.string(), name: z.string(), clue: z.string(), isVictim: z.boolean() })),
  caseClues: z.array(z.string()),
  rules: z.object({ emptyRows: z.number().optional(), emptyCols: z.number().optional(), emptyRooms: z.number().optional() }),
});

export function parsePuzzle(input: unknown): Puzzle {
  const savedAppearanceVersion = input && typeof input === 'object' && 'appearanceVersion' in input ? Number(input.appearanceVersion) : 0;
  const candidate = input && typeof input === 'object' && 'version' in input && input.version === 2 && 'objectKinds' in input && Array.isArray(input.objectKinds)
    ? { ...input, objectKinds: input.objectKinds.map((kind: unknown) => {
      if (!kind || typeof kind !== 'object') return kind;
      const record = kind as Record<string, unknown>;
      const preset = DEFAULT_OBJECT_KINDS.find((item) => item.id === record.id);
      const onWall = record.onWall === true;
      const namedArt = DEFAULT_OBJECT_KINDS.find((item) => item.name.toLowerCase() === String(record.name).trim().toLowerCase() && !item.onWall)?.art;
      const migratedArt = savedAppearanceVersion < 4 && (record.art === 'custom' || record.art === undefined) ? namedArt : undefined;
      return { ...record, outsideOnly: record.id === 'window' ? true : record.outsideOnly ?? preset?.outsideOnly ?? false, art: onWall ? 'bar' : migratedArt ?? record.art ?? (OBJECT_ART.includes(record.shape as ObjectArt) && record.shape !== 'bar' ? record.shape : preset?.art ?? 'custom') };
    }), rules: normalizeRules('rules' in input ? input.rules : undefined), appearanceVersion: 4 }
    : input;
  const v2 = puzzleSchema.safeParse(candidate);
  if (v2.success) return v2.data;
  const old = puzzleV1Schema.parse(input);
  const customKinds = old.objects.map((object) => ({
    id: `legacy-${object.id}`,
    name: object.name,
    canOccupy: object.capacity === 1,
    onWall: false,
    outsideOnly: false,
    art: DEFAULT_OBJECT_KINDS.find((kind) => kind.name.toLowerCase() === object.name.trim().toLowerCase() && !kind.onWall)?.art ?? 'custom',
  }));
  return puzzleSchema.parse({
    ...old,
    version: 2,
    appearanceVersion: 4,
    rules: normalizeRules(old.rules),
    objectKinds: [...DEFAULT_OBJECT_KINDS, ...customKinds],
    objects: old.objects.map((object) => ({ id: object.id, kindId: `legacy-${object.id}`, cell: object.cell })),
  });
}

export function cell(row: number, col: number): Cell {
  return `${row},${col}`;
}

export function coordinates(key: string): [number, number] {
  const [row, col] = key.split(',').map(Number);
  return [row, col];
}

export function newPuzzle(): Puzzle {
  const playable = Array.from({ length: 6 * 6 }, (_, index) => cell(Math.floor(index / 6), index % 6));
  return {
    version: 2,
    appearanceVersion: 4,
    id: crypto.randomUUID(),
    title: 'Untitled case',
    rows: 6,
    cols: 6,
    playable,
    rooms: [{ id: crypto.randomUUID(), name: 'Main area', cells: playable }],
    objectKinds: [...DEFAULT_OBJECT_KINDS],
    objects: [],
    walls: [],
    suspects: Array.from({ length: 6 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `Person ${index + 1}`,
      clue: '',
      isVictim: false,
    })),
    caseClues: [],
    rules: {},
  };
}

export function isWallEdge(puzzle: Puzzle, key: Cell, side: WallSide): boolean {
  if (!puzzle.playable.includes(key)) return false;
  const neighbor = wallNeighbor(key, side);
  if (!puzzle.playable.includes(neighbor)) return true;
  const roomOf = (at: Cell) => puzzle.rooms.find((room) => room.cells.includes(at))?.id;
  if (roomOf(key) !== roomOf(neighbor)) return true;
  return puzzle.walls.some((wall) =>
    (wall.from === key && wall.to === neighbor) || (wall.from === neighbor && wall.to === key));
}

export function isOutsideWallEdge(puzzle: Puzzle, key: Cell, side: WallSide): boolean {
  return puzzle.playable.includes(key) && !puzzle.playable.includes(wallNeighbor(key, side));
}

function wallNeighbor(key: Cell, side: WallSide): Cell {
  const [row, col] = coordinates(key);
  return side === 'N' ? cell(row - 1, col)
    : side === 'S' ? cell(row + 1, col)
      : side === 'E' ? cell(row, col + 1) : cell(row, col - 1);
}

export function objectCells(puzzle: Puzzle, object: Puzzle['objects'][number]): Cell[] {
  const kind = puzzle.objectKinds.find((item) => item.id === object.kindId);
  if (kind?.art !== 'bed' || kind.onWall) return [object.cell as Cell];
  const room = puzzle.rooms.find((item) => item.cells.includes(object.cell));
  const direction = object.bedDirection ?? (['E', 'S', 'W', 'N'] as const).find((side) =>
    room?.cells.includes(wallNeighbor(object.cell as Cell, side)));
  return direction ? [object.cell as Cell, wallNeighbor(object.cell as Cell, direction)] : [object.cell as Cell];
}

function objectSlot(key: Cell, side?: WallSide): string {
  return side ? [key, wallNeighbor(key, side)].sort().join('|') : `floor:${key}`;
}

export function placeObject(puzzle: Puzzle, kindId: string, key: Cell, side?: WallSide, bedDirection?: WallSide): Puzzle {
  const kind = puzzle.objectKinds.find((item) => item.id === kindId);
  if (!kind || !puzzle.playable.includes(key)) return puzzle;
  if (kind.onWall && (!side || !isWallEdge(puzzle, key, side))) return puzzle;
  if (kind.onWall && kind.art !== 'bar') return puzzle;
  if ((kind.id === 'window' || kind.outsideOnly) && (!side || !isOutsideWallEdge(puzzle, key, side))) return puzzle;
  const direction = kind.art === 'bed' ? bedDirection ?? (['E', 'S', 'W', 'N'] as const).find((candidate) =>
    puzzle.rooms.some((room) => room.cells.includes(key) && room.cells.includes(wallNeighbor(key, candidate)))) : undefined;
  if (kind.art === 'bed' && (!direction || !puzzle.rooms.some((room) => room.cells.includes(key) && room.cells.includes(wallNeighbor(key, direction))))) return puzzle;
  const slot = objectSlot(key, kind.onWall ? side : undefined);
  const footprint = kind.art === 'bed' ? [key, wallNeighbor(key, direction!)] : [key];
  const objects = puzzle.objects.filter((object) => objectSlot(object.cell as Cell, object.side) !== slot &&
    (kind.onWall || object.side || !objectCells(puzzle, object).some((occupied) => footprint.includes(occupied))));
  return {
    ...puzzle,
    objects: [...objects, { id: crypto.randomUUID(), kindId, cell: key, ...(kind.onWall ? { side } : {}), ...(direction ? { bedDirection: direction } : {}) }],
  };
}

export function resizePuzzle(puzzle: Puzzle, rows: number, cols: number): Puzzle {
  const inside = (key: string) => {
    const [row, col] = coordinates(key);
    return row < rows && col < cols;
  };
  const playable = puzzle.playable.filter(inside);
  const newCells: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key = cell(row, col);
      if (row >= puzzle.rows || col >= puzzle.cols) newCells.push(key);
    }
  }
  return {
    ...puzzle,
    rows,
    cols,
    playable: [...playable, ...newCells],
    rooms: puzzle.rooms.map((room, index) => ({
      ...room,
      cells: [...room.cells.filter(inside), ...(index === 0 ? newCells : [])],
    })),
    objects: puzzle.objects.filter((object) => objectCells(puzzle, object).every(inside)),
    walls: puzzle.walls.filter((wall) => inside(wall.from) && inside(wall.to)),
  };
}

export function assignCellToRoom(puzzle: Puzzle, key: Cell, roomId: string): Puzzle {
  if (!puzzle.playable.includes(key) || !puzzle.rooms.some((room) => room.id === roomId)) return puzzle;
  if (puzzle.rooms.find((room) => room.id === roomId)?.cells.includes(key)) return puzzle;
  return {
    ...puzzle,
    rooms: puzzle.rooms.map((room) => ({
      ...room,
      cells: room.id === roomId
        ? [...room.cells, key]
        : room.cells.filter((item) => item !== key),
    })),
  };
}

export function validatePuzzle(puzzle: Puzzle): string[] {
  const problems: string[] = [];
  const playable = new Set(puzzle.playable);
  const withinGrid = (key: string) => {
    const [row, col] = coordinates(key);
    return Number.isInteger(row) && Number.isInteger(col) && row < puzzle.rows && col < puzzle.cols;
  };
  if (!puzzle.title.trim()) problems.push('Give this case a title.');
  if (playable.size !== puzzle.playable.length) problems.push('A playable cell is listed twice.');
  if (playable.size === 0) problems.push('Mark at least one playable cell.');
  if (puzzle.playable.some((key) => !withinGrid(key))) problems.push('A playable cell is outside the grid.');
  if (puzzle.suspects.length === 0) problems.push('Add at least one person.');
  if (puzzle.suspects.some((suspect) => !suspect.name.trim())) problems.push('Every person needs a name.');
  if (new Set(puzzle.suspects.map((suspect) => suspect.id)).size !== puzzle.suspects.length) problems.push('Person IDs must be unique.');
  if (puzzle.suspects.length > Math.min(puzzle.rows, puzzle.cols)) problems.push('There are more people than rows or columns allow under the usual rule.');
  if (new Set(puzzle.objectKinds.map((kind) => kind.id)).size !== puzzle.objectKinds.length) problems.push('Object type IDs must be unique.');
  if (puzzle.objectKinds.some((kind) => !kind.name.trim())) problems.push('Every object type needs a name.');
  if (puzzle.objectKinds.some((kind) => kind.onWall && kind.art !== 'bar')) problems.push('Wall objects must use bar artwork.');

  const membership = new Map<string, number>();
  for (const room of puzzle.rooms) {
    for (const key of room.cells) {
      membership.set(key, (membership.get(key) ?? 0) + 1);
      if (!playable.has(key)) problems.push(`${room.name || 'A room'} includes a blocked cell.`);
    }
  }
  if (puzzle.rooms.some((room) => !room.name.trim())) problems.push('Every room needs a name.');
  if (puzzle.rooms.some((room) => room.cells.length === 0)) problems.push('Every room needs at least one cell.');
  if ([...playable].some((key) => membership.get(key) !== 1)) problems.push('Assign every playable cell to exactly one room.');
  for (const object of puzzle.objects) {
    const kind = puzzle.objectKinds.find((item) => item.id === object.kindId);
    if (!kind) problems.push('An object has an unknown type.');
    if (!playable.has(object.cell)) problems.push(`${kind?.name || 'An object'} is outside the playable map.`);
    if (kind?.onWall && (!object.side || !isWallEdge(puzzle, object.cell as Cell, object.side))) problems.push(`${kind.name} must be on a wall edge.`);
    if ((kind?.id === 'window' || kind?.outsideOnly) && (!object.side || !isOutsideWallEdge(puzzle, object.cell as Cell, object.side))) problems.push(`${kind.name} must be on an outside wall.`);
    if (kind && !kind.onWall && object.side) problems.push(`${kind.name} must be in a cell.`);
    if (kind?.art === 'bed' && (objectCells(puzzle, object).length !== 2 || !puzzle.rooms.some((room) => objectCells(puzzle, object).every((key) => room.cells.includes(key))))) problems.push('Each bed must cover two cells in one room.');
  }
  const slots = puzzle.objects.flatMap((object) => object.side ? [objectSlot(object.cell as Cell, object.side)] : objectCells(puzzle, object).map((key) => objectSlot(key)));
  if (new Set(slots).size !== slots.length) problems.push('Only one object can occupy each cell or wall edge.');
  if (puzzle.rules.emptyRows !== undefined && puzzle.rules.emptyRows > puzzle.rows) problems.push('Empty row count exceeds the grid.');
  if (puzzle.rules.emptyCols !== undefined && puzzle.rules.emptyCols > puzzle.cols) problems.push('Empty column count exceeds the grid.');
  if (puzzle.rules.emptyRooms !== undefined && puzzle.rules.emptyRooms > puzzle.rooms.length) problems.push('Empty room count exceeds the room count.');
  return [...new Set(problems)];
}

export function validatePlacements(puzzle: Puzzle, placements: Placement[]): string[] {
  const problems: string[] = [];
  const playable = new Set(puzzle.playable);
  const rows = new Map<number, string>();
  const cols = new Map<number, string>();
  const cells = new Set<string>();
  const people = new Set<string>();
  for (const placement of placements) {
    const suspect = puzzle.suspects.find((item) => item.id === placement.suspectId);
    if (!suspect) {
      problems.push('An unknown person is placed.');
      continue;
    }
    if (people.has(suspect.id)) problems.push(`${suspect.name} is placed more than once.`);
    people.add(suspect.id);
    if (!playable.has(placement.cell)) problems.push(`${suspect.name} is outside the playable map.`);
    if (cells.has(placement.cell)) problems.push('Two people occupy the same cell.');
    cells.add(placement.cell);
    const object = puzzle.objects.find((item) => !item.side && objectCells(puzzle, item).includes(placement.cell));
    const kind = puzzle.objectKinds.find((item) => item.id === object?.kindId);
    if (kind && !kind.canOccupy) problems.push(`${suspect.name} is on blocked furniture (${kind.name}).`);
    const [row, col] = coordinates(placement.cell);
    if (rows.has(row)) problems.push(`More than one person is in row ${row + 1}.`);
    if (cols.has(col)) problems.push(`More than one person is in column ${col + 1}.`);
    rows.set(row, suspect.id);
    cols.set(col, suspect.id);
  }
  if (placements.length === puzzle.suspects.length) {
    const emptyRows = puzzle.rows - rows.size;
    const emptyCols = puzzle.cols - cols.size;
    const occupiedRooms = new Set(puzzle.rooms.filter((room) => room.cells.some((key) => cells.has(key))).map((room) => room.id));
    const emptyRooms = puzzle.rooms.length - occupiedRooms.size;
    if (puzzle.rules.emptyRows !== undefined && emptyRows !== puzzle.rules.emptyRows) problems.push(`This case calls for ${puzzle.rules.emptyRows} empty rows; there are ${emptyRows}.`);
    if (puzzle.rules.emptyCols !== undefined && emptyCols !== puzzle.rules.emptyCols) problems.push(`This case calls for ${puzzle.rules.emptyCols} empty columns; there are ${emptyCols}.`);
    if (puzzle.rules.emptyRooms !== undefined && emptyRooms !== puzzle.rules.emptyRooms) problems.push(`This case calls for ${puzzle.rules.emptyRooms} empty rooms; there are ${emptyRooms}.`);
  }
  return [...new Set(problems)];
}
