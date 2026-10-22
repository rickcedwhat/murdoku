import type { Placement, Puzzle } from './puzzle';

export type CellNote = { type: 'empty' | 'blocked' } | { type: 'candidates'; suspectIds: string[] };
export type Deduction = { placements: Placement[]; notes: Record<string, CellNote> };
export type Hypothesis = { id: string; name: string; present: Deduction; undo: Deduction[]; redo: Deduction[] };
export type Checkpoint = { name: string; state: Deduction };
export type BranchWorkspace = { branches: Hypothesis[]; activeId: string; checkpoint?: Checkpoint };

const HISTORY_LIMIT = 100;

function copyDeduction(state: Deduction): Deduction {
  return {
    placements: state.placements.map((item) => ({ ...item })),
    notes: Object.fromEntries(Object.entries(state.notes).map(([key, note]) => [key, note.type === 'candidates' ? { type: 'candidates', suspectIds: [...note.suspectIds] } : { ...note }])),
  };
}

export function newBranchWorkspace(initial: Deduction = { placements: [], notes: {} }): BranchWorkspace {
  return { branches: [{ id: 'main', name: 'Main', present: copyDeduction(initial), undo: [], redo: [] }], activeId: 'main' };
}

export function activeHypothesis(workspace: BranchWorkspace): Hypothesis {
  return workspace.branches.find((branch) => branch.id === workspace.activeId) ?? workspace.branches[0];
}

function updateBranch(workspace: BranchWorkspace, id: string, update: (branch: Hypothesis) => Hypothesis): BranchWorkspace {
  return { ...workspace, branches: workspace.branches.map((branch) => branch.id === id ? update(branch) : branch) };
}

export function changeDeduction(workspace: BranchWorkspace, update: (state: Deduction) => Deduction): BranchWorkspace {
  const current = activeHypothesis(workspace);
  const next = update(copyDeduction(current.present));
  if (JSON.stringify(next) === JSON.stringify(current.present)) return workspace;
  return updateBranch(workspace, current.id, (branch) => ({ ...branch, present: copyDeduction(next), undo: [...branch.undo, copyDeduction(branch.present)].slice(-HISTORY_LIMIT), redo: [] }));
}

export function undoDeduction(workspace: BranchWorkspace): BranchWorkspace {
  const current = activeHypothesis(workspace);
  if (!current.undo.length) return workspace;
  return updateBranch(workspace, current.id, (branch) => ({ ...branch, present: branch.undo[branch.undo.length - 1], undo: branch.undo.slice(0, -1), redo: [...branch.redo, copyDeduction(branch.present)] }));
}

export function redoDeduction(workspace: BranchWorkspace): BranchWorkspace {
  const current = activeHypothesis(workspace);
  if (!current.redo.length) return workspace;
  return updateBranch(workspace, current.id, (branch) => ({ ...branch, present: branch.redo[branch.redo.length - 1], redo: branch.redo.slice(0, -1), undo: [...branch.undo, copyDeduction(branch.present)].slice(-HISTORY_LIMIT) }));
}

export function saveCheckpoint(workspace: BranchWorkspace): BranchWorkspace {
  return { ...workspace, checkpoint: { name: `Checkpoint from ${activeHypothesis(workspace).name}`, state: copyDeduction(activeHypothesis(workspace).present) } };
}

export function restoreCheckpoint(workspace: BranchWorkspace): BranchWorkspace {
  return workspace.checkpoint ? changeDeduction(workspace, () => copyDeduction(workspace.checkpoint!.state)) : workspace;
}

export function createHypothesis(workspace: BranchWorkspace): BranchWorkspace {
  const state = workspace.checkpoint?.state ?? activeHypothesis(workspace).present;
  let count = 1;
  while (workspace.branches.some((branch) => branch.name === `Hypothesis ${count}`)) count += 1;
  const branch: Hypothesis = { id: crypto.randomUUID(), name: `Hypothesis ${count}`, present: copyDeduction(state), undo: [], redo: [] };
  return { ...workspace, branches: [...workspace.branches, branch], activeId: branch.id, checkpoint: workspace.checkpoint ?? { name: `Checkpoint from ${activeHypothesis(workspace).name}`, state: copyDeduction(state) } };
}

export function switchHypothesis(workspace: BranchWorkspace, id: string): BranchWorkspace {
  return workspace.branches.some((branch) => branch.id === id) ? { ...workspace, activeId: id } : workspace;
}

export function renameHypothesis(workspace: BranchWorkspace, id: string, name: string): BranchWorkspace {
  if (id === 'main') return workspace;
  return updateBranch(workspace, id, (branch) => ({ ...branch, name }));
}

export function applyHypothesisToMain(workspace: BranchWorkspace): BranchWorkspace {
  const source = activeHypothesis(workspace);
  if (source.id === 'main') return workspace;
  const updated = updateBranch(workspace, 'main', (main) => ({ ...main, present: copyDeduction(source.present), undo: [...main.undo, copyDeduction(main.present)].slice(-HISTORY_LIMIT), redo: [] }));
  return { ...updated, activeId: 'main' };
}

export function discardHypothesis(workspace: BranchWorkspace): BranchWorkspace {
  if (workspace.activeId === 'main') return workspace;
  return { ...workspace, branches: workspace.branches.filter((branch) => branch.id !== workspace.activeId), activeId: 'main' };
}

function pruneDeduction(state: Deduction, puzzle: Puzzle): Deduction {
  const playable = new Set(puzzle.playable);
  const suspects = new Set(puzzle.suspects.map((suspect) => suspect.id));
  const blockingKinds = new Set(puzzle.objectKinds.filter((kind) => !kind.onWall && !kind.canOccupy).map((kind) => kind.id));
  const blocked = new Set(puzzle.objects.filter((object) => !object.side && blockingKinds.has(object.kindId)).map((object) => object.cell));
  const notes: Record<string, CellNote> = {};
  for (const [key, note] of Object.entries(state.notes)) {
    if (!playable.has(key) || blocked.has(key)) continue;
    if (note.type !== 'candidates') notes[key] = note;
    else {
      const suspectIds = note.suspectIds.filter((id) => suspects.has(id));
      if (suspectIds.length) notes[key] = { type: 'candidates', suspectIds };
    }
  }
  return { placements: state.placements.filter((item) => playable.has(item.cell) && suspects.has(item.suspectId) && !blocked.has(item.cell)), notes };
}

export function reconcileBranches(workspace: BranchWorkspace, puzzle: Puzzle): BranchWorkspace {
  return {
    ...workspace,
    branches: workspace.branches.map((branch) => ({ ...branch, present: pruneDeduction(branch.present, puzzle), undo: branch.undo.map((state) => pruneDeduction(state, puzzle)), redo: branch.redo.map((state) => pruneDeduction(state, puzzle)) })),
    checkpoint: workspace.checkpoint && { ...workspace.checkpoint, state: pruneDeduction(workspace.checkpoint.state, puzzle) },
  };
}

export function parseBranchWorkspace(input: unknown, puzzle: Puzzle, legacy: Deduction): BranchWorkspace {
  if (!input || typeof input !== 'object' || !('branches' in input) || !Array.isArray(input.branches)) return reconcileBranches(newBranchWorkspace(legacy), puzzle);
  const candidate = input as BranchWorkspace;
  const validState = (state: Deduction): boolean => !!state && Array.isArray(state.placements) && state.placements.every((item) => item && typeof item.suspectId === 'string' && typeof item.cell === 'string') && !!state.notes && typeof state.notes === 'object' && !Array.isArray(state.notes) && Object.values(state.notes).every((note) => note && (note.type === 'empty' || note.type === 'blocked' || (note.type === 'candidates' && Array.isArray(note.suspectIds) && note.suspectIds.every((id) => typeof id === 'string'))));
  if (!candidate.branches.length || !candidate.branches.some((branch) => branch.id === 'main') || candidate.branches.some((branch) => !branch || typeof branch.id !== 'string' || typeof branch.name !== 'string' || !validState(branch.present) || !Array.isArray(branch.undo) || !Array.isArray(branch.redo) || branch.undo.some((state) => !validState(state)) || branch.redo.some((state) => !validState(state)))) return reconcileBranches(newBranchWorkspace(legacy), puzzle);
  return reconcileBranches({ ...candidate, activeId: candidate.branches.some((branch) => branch.id === candidate.activeId) ? candidate.activeId : 'main', checkpoint: candidate.checkpoint && typeof candidate.checkpoint.name === 'string' && validState(candidate.checkpoint.state) ? candidate.checkpoint : undefined }, puzzle);
}
