import { describe, expect, it } from 'vitest';
import { activeHypothesis, changeDeduction, newBranchWorkspace, undoDeduction } from './branches';
import { fillLineWithXs, newSavedCase, parseCaseLibrary, upsertCase } from './cases';
import { cell, newPuzzle, placeObject } from './puzzle';

describe('case library', () => {
  it('migrates a single browser save and retains it alongside a new case', () => {
    const puzzle = newPuzzle();
    puzzle.title = 'Old case';
    const legacy = JSON.stringify({ puzzle, placements: [{ suspectId: puzzle.suspects[0].id, cell: cell(1, 1) }], notes: { [cell(1, 2)]: { type: 'blocked' } } });
    const migrated = parseCaseLibrary(null, legacy);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].puzzle.title).toBe('Old case');
    expect(activeHypothesis(migrated[0].branchWorkspace).present.placements[0].cell).toBe(cell(1, 1));
    expect(activeHypothesis(migrated[0].branchWorkspace).present.notes[cell(1, 2)]).toEqual({ type: 'empty' });
    const next = newSavedCase(newPuzzle());
    const library = upsertCase(migrated, next);
    expect(parseCaseLibrary(JSON.stringify({ version: 1, cases: library }), legacy).map((saved) => saved.puzzle.id))
      .toEqual([next.puzzle.id, puzzle.id]);
  });

  it('fills only eligible cells in the chosen line and can undo the Xs', () => {
    let puzzle = newPuzzle();
    puzzle = placeObject(puzzle, 'table', cell(0, 2));
    let workspace = newBranchWorkspace();
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [
      { suspectId: puzzle.suspects[0].id, cell: cell(0, 0) },
      { suspectId: puzzle.suspects[1].id, cell: cell(0, 3) },
    ], notes: { [cell(0, 1)]: { type: 'candidates', suspectIds: [puzzle.suspects[2].id] }, [cell(0, 5)]: { type: 'blocked' } } }));
    const before = activeHypothesis(workspace).present;
    workspace = fillLineWithXs(workspace, puzzle, cell(0, 0), 'row');
    const after = activeHypothesis(workspace).present;
    expect(after.notes[cell(0, 1)]).toEqual({ type: 'empty' });
    expect(after.notes[cell(0, 2)]).toBeUndefined();
    expect(after.notes[cell(0, 3)]).toBeUndefined();
    expect(after.notes[cell(0, 4)]).toEqual({ type: 'empty' });
    expect(after.notes[cell(0, 5)]).toEqual({ type: 'blocked' });
    expect(after.notes[cell(1, 0)]).toBeUndefined();
    expect(activeHypothesis(undoDeduction(workspace)).present).toEqual(before);
  });
});
