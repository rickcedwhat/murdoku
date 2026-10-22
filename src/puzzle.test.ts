import { describe, expect, it } from 'vitest';
import { assignCellToRoom, cell, isWallEdge, newPuzzle, parsePuzzle, placeObject, resizePuzzle, validatePlacements, validatePuzzle } from './puzzle';

describe('puzzle rules', () => {
  it('keeps deliberately excluded cells excluded when a dimension changes', () => {
    const puzzle = newPuzzle();
    const excluded = cell(0, 0);
    const masked = {
      ...puzzle,
      playable: puzzle.playable.filter((key) => key !== excluded),
      rooms: puzzle.rooms.map((room) => ({ ...room, cells: room.cells.filter((key) => key !== excluded) })),
    };
    const resized = resizePuzzle(masked, 7, 6);
    expect(resized.playable).not.toContain(excluded);
    expect(resized.playable).toContain(cell(6, 0));
  });

  it('allows empty rows but enforces a case-specific count at completion', () => {
    const puzzle = newPuzzle();
    puzzle.rows = 10;
    puzzle.playable = Array.from({ length: 10 * 6 }, (_, index) => cell(Math.floor(index / 6), index % 6));
    puzzle.rooms[0].cells = puzzle.playable;
    puzzle.rules.emptyRows = 4;
    expect(validatePuzzle(puzzle)).toEqual([]);
    const placements = puzzle.suspects.map((suspect, index) => ({ suspectId: suspect.id, cell: cell(index, index) }));
    expect(validatePlacements(puzzle, placements)).toEqual([]);
    puzzle.rules.emptyRows = 3;
    expect(validatePlacements(puzzle, placements)).toContain('This case calls for 3 empty rows; there are 4.');
  });

  it('flags row collisions while a case is in progress', () => {
    const puzzle = newPuzzle();
    const placements = [
      { suspectId: puzzle.suspects[0].id, cell: cell(0, 0) },
      { suspectId: puzzle.suspects[1].id, cell: cell(0, 1) },
    ];
    expect(validatePlacements(puzzle, placements)).toContain('More than one person is in row 1.');
  });

  it('assigns every cell in a rapid room stroke without losing previous changes', () => {
    let puzzle = newPuzzle();
    const roomId = crypto.randomUUID();
    puzzle = { ...puzzle, rooms: [...puzzle.rooms, { id: roomId, name: 'Library', cells: [] }] };
    for (const key of [cell(0, 0), cell(0, 1), cell(0, 2)]) {
      puzzle = assignCellToRoom(puzzle, key, roomId);
    }
    expect(puzzle.rooms[1].cells).toEqual([cell(0, 0), cell(0, 1), cell(0, 2)]);
    expect(puzzle.rooms[0].cells).not.toContain(cell(0, 1));
  });

  it('places windows only on outside edges, including two edges of one cell', () => {
    let puzzle = newPuzzle();
    expect(isWallEdge(puzzle, cell(0, 1), 'N')).toBe(true);
    expect(isWallEdge(puzzle, cell(2, 2), 'N')).toBe(false);
    const firstRoom = puzzle.rooms[0];
    const roomId = crypto.randomUUID();
    puzzle = {
      ...puzzle,
      rooms: [
        { ...firstRoom, cells: firstRoom.cells.filter((key) => key !== cell(0, 0)) },
        { id: roomId, name: 'Hall', cells: [cell(0, 0)] },
      ],
    };
    puzzle = placeObject(puzzle, 'window', cell(0, 1), 'N');
    expect(puzzle.objects).toHaveLength(1);
    expect(puzzle.objects[0].side).toBe('N');
    expect(validatePlacements(puzzle, [{ suspectId: puzzle.suspects[0].id, cell: cell(0, 1) }])).toEqual([]);
    expect(placeObject(puzzle, 'window', cell(2, 2), 'N')).toBe(puzzle);
    expect(placeObject(puzzle, 'window', cell(0, 0), 'E')).toBe(puzzle);
    puzzle = placeObject(puzzle, 'window', cell(0, 0), 'N');
    puzzle = placeObject(puzzle, 'window', cell(0, 0), 'W');
    expect(puzzle.objects).toHaveLength(3);
    expect(puzzle.objects.filter((object) => object.cell === cell(0, 0)).map((object) => object.side)).toEqual(['N', 'W']);
    const invalid = { ...puzzle, objects: [...puzzle.objects, { id: 'old-inner-window', kindId: 'window', cell: cell(0, 0), side: 'E' as const }] };
    expect(validatePuzzle(invalid)).toContain('Window must be on an outside wall.');
    expect(validatePuzzle(puzzle)).toEqual([]);
  });

  it('uses object type occupancy and upgrades an existing local case', () => {
    let puzzle = newPuzzle();
    puzzle = placeObject(puzzle, 'table', cell(0, 0));
    expect(validatePlacements(puzzle, [{ suspectId: puzzle.suspects[0].id, cell: cell(0, 0) }]))
      .toContain(`${puzzle.suspects[0].name} is on blocked furniture (Table).`);

    const { objectKinds: _kinds, ...old } = puzzle;
    const v1 = { ...old, version: 1, objects: [{ id: 'old-object', name: 'Bench', cell: cell(1, 1), capacity: 1 }] };
    const upgraded = parsePuzzle(v1);
    expect(upgraded.version).toBe(2);
    expect(upgraded.objectKinds.find((kind) => kind.id === 'legacy-old-object')?.canOccupy).toBe(true);
  });

  it('loads older furniture definitions into the artwork system', () => {
    const puzzle = newPuzzle();
    expect(puzzle.objectKinds.find((kind) => kind.id === 'chair')?.art).toBe('chair');
    const oldKinds = puzzle.objectKinds.map(({ art: _art, ...kind }) => kind);
    const restored = parsePuzzle({ ...puzzle, objectKinds: [...oldKinds, { id: 'custom', name: 'Lamp', canOccupy: false, onWall: false }] });
    expect(restored.objectKinds.find((kind) => kind.id === 'chair')?.art).toBe('chair');
    expect(restored.objectKinds.find((kind) => kind.id === 'custom')?.art).toBe('custom');
    expect(restored.objectKinds.find((kind) => kind.id === 'window')?.outsideOnly).toBe(true);
    expect(parsePuzzle({ ...puzzle, objectKinds: [{ id: 'custom', name: 'Lamp', canOccupy: false, onWall: false, shape: 'plant' }] }).objectKinds[0].art).toBe('plant');
    expect(parsePuzzle({ ...puzzle, objectKinds: [{ id: 'window', name: 'Window', canOccupy: true, onWall: true, shape: 'diamond' }] }).objectKinds[0].art).toBe('bar');
    const savedTable = { ...puzzle, appearanceVersion: 3, objectKinds: [{ id: 'old-table', name: 'Table', canOccupy: false, onWall: false, art: 'custom' }] };
    expect(parsePuzzle(savedTable).objectKinds[0].art).toBe('table');
  });
});
