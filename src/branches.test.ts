import { describe, expect, it } from 'vitest';
import { activeHypothesis, applyHypothesisToMain, changeDeduction, createHypothesis, discardHypothesis, newBranchWorkspace, parseBranchWorkspace, reconcileBranches, redoDeduction, restoreCheckpoint, saveCheckpoint, switchHypothesis, undoDeduction } from './branches';
import { cell, newPuzzle, placeObject } from './puzzle';

describe('hypothesis branches', () => {
  const mark = (at: string, suspectId: string) => (state: ReturnType<typeof activeHypothesis>['present']) => ({ ...state, notes: { ...state.notes, [at]: { type: 'candidates' as const, suspectIds: [suspectId] } } });

  it('starts sibling hypotheses from the saved checkpoint and keeps their notes separate', () => {
    const puzzle = newPuzzle();
    let workspace = newBranchWorkspace();
    workspace = changeDeduction(workspace, mark(cell(0, 0), puzzle.suspects[0].id));
    workspace = saveCheckpoint(workspace);
    workspace = createHypothesis(workspace);
    const firstId = workspace.activeId;
    workspace = changeDeduction(workspace, mark(cell(0, 1), puzzle.suspects[1].id));
    workspace = createHypothesis(workspace);
    expect(activeHypothesis(workspace).present.notes[cell(0, 1)]).toBeUndefined();
    workspace = changeDeduction(workspace, mark(cell(0, 2), puzzle.suspects[2].id));
    const secondId = workspace.activeId;
    workspace = switchHypothesis(workspace, firstId);
    expect(activeHypothesis(workspace).present.notes[cell(0, 1)]).toBeDefined();
    expect(activeHypothesis(workspace).present.notes[cell(0, 2)]).toBeUndefined();
    workspace = switchHypothesis(workspace, secondId);
    expect(activeHypothesis(workspace).present.notes[cell(0, 2)]).toBeDefined();
    workspace = restoreCheckpoint(workspace);
    expect(activeHypothesis(workspace).present.notes[cell(0, 2)]).toBeUndefined();
  });

  it('undoes and redoes within a branch, then discards it without changing Main', () => {
    const puzzle = newPuzzle();
    let workspace = newBranchWorkspace({ placements: [{ suspectId: puzzle.suspects[0].id, cell: cell(0, 0) }], notes: {} });
    workspace = saveCheckpoint(workspace);
    workspace = createHypothesis(workspace);
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [{ suspectId: puzzle.suspects[0].id, cell: cell(1, 1) }] }));
    workspace = undoDeduction(workspace);
    expect(activeHypothesis(workspace).present.placements[0].cell).toBe(cell(0, 0));
    workspace = redoDeduction(workspace);
    expect(activeHypothesis(workspace).present.placements[0].cell).toBe(cell(1, 1));
    workspace = discardHypothesis(workspace);
    expect(workspace.activeId).toBe('main');
    expect(activeHypothesis(workspace).present.placements[0].cell).toBe(cell(0, 0));
  });

  it('applies a hypothesis to Main as one undoable step and restores saved branches after reload', () => {
    const puzzle = newPuzzle();
    let workspace = createHypothesis(newBranchWorkspace());
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [{ suspectId: puzzle.suspects[0].id, cell: cell(2, 2) }] }));
    workspace = applyHypothesisToMain(workspace);
    expect(workspace.activeId).toBe('main');
    expect(activeHypothesis(workspace).present.placements[0].cell).toBe(cell(2, 2));
    workspace = undoDeduction(workspace);
    expect(activeHypothesis(workspace).present.placements).toEqual([]);
    workspace = redoDeduction(workspace);
    expect(activeHypothesis(workspace).present.placements[0].cell).toBe(cell(2, 2));
    expect(parseBranchWorkspace(JSON.parse(JSON.stringify(workspace)), puzzle, { placements: [], notes: {} }).branches).toHaveLength(2);
    puzzle.playable = puzzle.playable.filter((key) => key !== cell(2, 2));
    expect(reconcileBranches(workspace, puzzle).branches[0].present.placements).toEqual([]);
  });

  it('clears redo after a different move and migrates the prior browser save', () => {
    const puzzle = newPuzzle();
    let workspace = newBranchWorkspace();
    workspace = changeDeduction(workspace, mark(cell(0, 0), puzzle.suspects[0].id));
    workspace = undoDeduction(workspace);
    workspace = changeDeduction(workspace, mark(cell(0, 1), puzzle.suspects[1].id));
    expect(activeHypothesis(workspace).redo).toEqual([]);
    expect(redoDeduction(workspace)).toBe(workspace);
    const legacy = { placements: [{ suspectId: puzzle.suspects[0].id, cell: cell(1, 1) }], notes: { [cell(1, 2)]: { type: 'empty' as const } } };
    const restored = parseBranchWorkspace(undefined, puzzle, legacy);
    expect(activeHypothesis(restored).present).toEqual(legacy);
  });

  it('removes placements hidden by new furniture from every hypothesis and its history', () => {
    let puzzle = newPuzzle();
    const blockedCell = cell(0, 0);
    let workspace = newBranchWorkspace({ placements: [{ suspectId: puzzle.suspects[0].id, cell: blockedCell }], notes: {} });
    workspace = saveCheckpoint(workspace);
    workspace = createHypothesis(workspace);
    workspace = changeDeduction(workspace, mark(cell(1, 1), puzzle.suspects[1].id));
    workspace = undoDeduction(workspace);
    puzzle = placeObject(puzzle, 'table', blockedCell);
    workspace = reconcileBranches(workspace, puzzle);
    for (const branch of workspace.branches) {
      for (const state of [branch.present, ...branch.undo, ...branch.redo]) {
        expect(state.placements.some((item) => item.cell === blockedCell)).toBe(false);
      }
    }
    expect(workspace.checkpoint?.state.placements.some((item) => item.cell === blockedCell)).toBe(false);
    expect(activeHypothesis(redoDeduction(workspace)).present.placements.some((item) => item.cell === blockedCell)).toBe(false);
  });
});
