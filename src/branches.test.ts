import { describe, expect, it } from 'vitest';
import { activeHypothesis, applyHypothesisToMain, changeDeduction, continueFromPoint, createHypothesis, discardHypothesis, newBranchWorkspace, parseBranchWorkspace, reconcileBranches, redoDeduction, restoreCheckpoint, saveCheckpoint, switchHypothesis, undoDeduction } from './branches';
import { cell, newPuzzle, placeObject } from './puzzle';

describe('hypothesis branches', () => {
  const mark = (at: string, suspectId: string) => (state: ReturnType<typeof activeHypothesis>['present']) => ({ ...state, notes: { ...state.notes, [at]: { type: 'candidates' as const, suspectIds: [suspectId] } } });

  it('records named checkpoints and confirmed people as points that can be branched from', () => {
    const puzzle = newPuzzle();
    const personId = puzzle.suspects[0].id;
    let workspace = newBranchWorkspace();
    workspace = changeDeduction(workspace, mark(cell(0, 0), personId));
    workspace = saveCheckpoint(workspace, [], 'First theory');
    const checkpoint = workspace.points?.at(-1);
    expect(workspace.points?.map((point) => point.kind)).toEqual(['start', 'checkpoint']);
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [{ suspectId: personId, cell: cell(0, 1) }] }));
    expect(workspace.points?.at(-1)).toMatchObject({ kind: 'confirmed', suspectId: personId, parentId: checkpoint?.id });
    workspace = createHypothesis(workspace, [], checkpoint?.id);
    expect(activeHypothesis(workspace).present.placements).toEqual([]);
    expect(workspace.points?.at(-1)).toMatchObject({ kind: 'branch', parentId: checkpoint?.id });
    expect(parseBranchWorkspace(JSON.parse(JSON.stringify(workspace)), puzzle, { placements: [], notes: {} }).points).toHaveLength(4);
  });

  it('drops an undone confirmation when a different confirmation replaces it', () => {
    const puzzle = newPuzzle();
    const personId = puzzle.suspects[0].id;
    let workspace = newBranchWorkspace();
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [{ suspectId: personId, cell: cell(0, 0) }] }));
    workspace = undoDeduction(workspace);
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [{ suspectId: personId, cell: cell(0, 1) }] }));
    expect(workspace.points?.filter((point) => point.kind === 'confirmed')).toHaveLength(1);
    const tip = workspace.points?.at(-1);
    workspace = createHypothesis(workspace, [], workspace.points?.[0].id);
    workspace = continueFromPoint(workspace, tip!.id);
    expect(workspace.activeId).toBe('main');
  });

  it('compacts repeated confirmations for one person when loading older history', () => {
    const puzzle = newPuzzle();
    const personId = puzzle.suspects[0].id;
    let workspace = newBranchWorkspace();
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [{ suspectId: personId, cell: cell(0, 0) }] }));
    workspace = changeDeduction(workspace, (state) => ({ ...state, placements: [{ suspectId: personId, cell: cell(0, 1) }] }));
    const restored = parseBranchWorkspace(JSON.parse(JSON.stringify(workspace)), puzzle, { placements: [], notes: {} });
    expect(restored.points?.filter((point) => point.kind === 'confirmed')).toHaveLength(1);
    expect(restored.points?.at(-1)?.state.placements[0].cell).toBe(cell(0, 1));
  });

  it('starts sibling hypotheses from the saved checkpoint and keeps their notes separate', () => {
    const puzzle = newPuzzle();
    let workspace = newBranchWorkspace();
    workspace = changeDeduction(workspace, mark(cell(0, 0), puzzle.suspects[0].id));
    workspace = saveCheckpoint(workspace);
    const checkpointId = workspace.points?.find((point) => point.kind === 'checkpoint')?.id;
    workspace = createHypothesis(workspace, [], checkpointId);
    const firstId = workspace.activeId;
    workspace = changeDeduction(workspace, mark(cell(0, 1), puzzle.suspects[1].id));
    workspace = createHypothesis(workspace, [], checkpointId);
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

  it('keeps checked people with the checkpoint across reloads and removes deleted people', () => {
    const puzzle = newPuzzle();
    const firstId = puzzle.suspects[0].id;
    const secondId = puzzle.suspects[1].id;
    let workspace = changeDeduction(newBranchWorkspace(), mark(cell(0, 0), firstId));
    workspace = saveCheckpoint(workspace, [firstId, secondId]);
    expect(workspace.checkpoint?.state.notes[cell(0, 0)]).toBeDefined();
    expect(workspace.checkpoint?.consideredSuspectIds).toEqual([firstId, secondId]);
    workspace = parseBranchWorkspace(JSON.parse(JSON.stringify(workspace)), puzzle, { placements: [], notes: {} });
    expect(workspace.checkpoint?.consideredSuspectIds).toEqual([firstId, secondId]);
    puzzle.suspects = puzzle.suspects.filter((person) => person.id !== secondId);
    expect(reconcileBranches(workspace, puzzle).checkpoint?.consideredSuspectIds).toEqual([firstId]);
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
