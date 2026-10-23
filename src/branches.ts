import { objectCells, type Placement, type Puzzle } from './puzzle';

export type CellNote = { type: 'empty' | 'blocked' } | { type: 'candidates'; suspectIds: string[] };
export type Deduction = { placements: Placement[]; notes: Record<string, CellNote> };
export type Hypothesis = { id: string; name: string; present: Deduction; undo: Deduction[]; redo: Deduction[]; headPointId?: string };
export type Checkpoint = { name: string; state: Deduction; consideredSuspectIds?: string[] };
export type HistoryPoint = { id: string; parentId?: string; branchId: string; kind: 'start' | 'branch' | 'checkpoint' | 'confirmed'; name?: string; suspectId?: string; state: Deduction; consideredSuspectIds?: string[] };
export type BranchWorkspace = { branches: Hypothesis[]; activeId: string; checkpoint?: Checkpoint; points?: HistoryPoint[] };

const HISTORY_LIMIT = 100;

function copyDeduction(state: Deduction): Deduction {
  return {
    placements: state.placements.map((item) => ({ ...item })),
    notes: Object.fromEntries(Object.entries(state.notes).map(([key, note]) => [key, note.type === 'candidates' ? { type: 'candidates', suspectIds: [...note.suspectIds] } : { ...note }])),
  };
}

export function newBranchWorkspace(initial: Deduction = { placements: [], notes: {} }): BranchWorkspace {
  const start: HistoryPoint = { id: crypto.randomUUID(), branchId: 'main', kind: 'start', state: { placements: [], notes: {} } };
  const points = [start];
  for (const placement of initial.placements) points.push({ id: crypto.randomUUID(), parentId: points.at(-1)!.id, branchId: 'main', kind: 'confirmed', suspectId: placement.suspectId, state: { placements: [...points.at(-1)!.state.placements, { ...placement }], notes: copyDeduction(initial).notes } });
  return { branches: [{ id: 'main', name: 'Main', present: copyDeduction(initial), undo: [], redo: [], headPointId: points.at(-1)!.id }], activeId: 'main', points };
}

export function activeHypothesis(workspace: BranchWorkspace): Hypothesis {
  return workspace.branches.find((branch) => branch.id === workspace.activeId) ?? workspace.branches[0];
}

function updateBranch(workspace: BranchWorkspace, id: string, update: (branch: Hypothesis) => Hypothesis): BranchWorkspace {
  return { ...workspace, branches: workspace.branches.map((branch) => branch.id === id ? update(branch) : branch) };
}

function samePlacements(left: Deduction, right: Deduction): boolean {
  return left.placements.length === right.placements.length && left.placements.every((item) => right.placements.some((other) => other.suspectId === item.suspectId && other.cell === item.cell));
}

function headForState(workspace: BranchWorkspace, branch: Hypothesis, state: Deduction): string | undefined {
  return [...(workspace.points ?? [])].reverse().find((point) => point.branchId === branch.id && samePlacements(point.state, state))?.id ?? branch.headPointId;
}

function pruneUnreachablePoints(workspace: BranchWorkspace): BranchWorkspace {
  const byId = new Map((workspace.points ?? []).map((point) => [point.id, point]));
  const keep = new Set<string>();
  for (const branch of workspace.branches) {
    let id = branch.headPointId;
    while (id && !keep.has(id)) {
      keep.add(id);
      id = byId.get(id)?.parentId;
    }
  }
  return { ...workspace, points: workspace.points?.filter((point) => keep.has(point.id)) };
}

export function changeDeduction(workspace: BranchWorkspace, update: (state: Deduction) => Deduction): BranchWorkspace {
  const current = activeHypothesis(workspace);
  const next = update(copyDeduction(current.present));
  if (JSON.stringify(next) === JSON.stringify(current.present)) return workspace;
  const base = current.redo.length ? pruneUnreachablePoints(workspace) : workspace;
  const added = next.placements.filter((item) => !current.present.placements.some((old) => old.suspectId === item.suspectId && old.cell === item.cell));
  const point: HistoryPoint | undefined = added.length ? { id: crypto.randomUUID(), parentId: current.headPointId, branchId: current.id, kind: 'confirmed', suspectId: added[0].suspectId, state: copyDeduction(next) } : undefined;
  const updated = updateBranch(base, current.id, (branch) => ({ ...branch, present: copyDeduction(next), undo: [...branch.undo, copyDeduction(branch.present)].slice(-HISTORY_LIMIT), redo: [], headPointId: point?.id ?? branch.headPointId }));
  return point ? { ...updated, points: [...(base.points ?? []), point] } : updated;
}

export function undoDeduction(workspace: BranchWorkspace): BranchWorkspace {
  const current = activeHypothesis(workspace);
  if (!current.undo.length) return workspace;
  const state = current.undo[current.undo.length - 1];
  return updateBranch(workspace, current.id, (branch) => ({ ...branch, present: state, undo: branch.undo.slice(0, -1), redo: [...branch.redo, copyDeduction(branch.present)], headPointId: headForState(workspace, branch, state) }));
}

export function redoDeduction(workspace: BranchWorkspace): BranchWorkspace {
  const current = activeHypothesis(workspace);
  if (!current.redo.length) return workspace;
  const state = current.redo[current.redo.length - 1];
  return updateBranch(workspace, current.id, (branch) => ({ ...branch, present: state, redo: branch.redo.slice(0, -1), undo: [...branch.undo, copyDeduction(branch.present)].slice(-HISTORY_LIMIT), headPointId: headForState(workspace, branch, state) }));
}

export function saveCheckpoint(workspace: BranchWorkspace, consideredSuspectIds: string[] = [], name?: string): BranchWorkspace {
  const branch = activeHypothesis(workspace);
  const label = name?.trim() || `Checkpoint ${(workspace.points ?? []).filter((point) => point.kind === 'checkpoint').length + 1}`;
  const state = copyDeduction(branch.present);
  const point: HistoryPoint = { id: crypto.randomUUID(), parentId: branch.headPointId, branchId: branch.id, kind: 'checkpoint', name: label, state, consideredSuspectIds: [...consideredSuspectIds] };
  const updated = updateBranch(workspace, branch.id, (item) => ({ ...item, headPointId: point.id }));
  return { ...updated, points: [...(workspace.points ?? []), point], checkpoint: { name: label, state, consideredSuspectIds: [...consideredSuspectIds] } };
}

export function restoreCheckpoint(workspace: BranchWorkspace): BranchWorkspace {
  return workspace.checkpoint ? changeDeduction(workspace, () => copyDeduction(workspace.checkpoint!.state)) : workspace;
}

export function createHypothesis(workspace: BranchWorkspace, consideredSuspectIds: string[] = [], fromPointId?: string): BranchWorkspace {
  const sourcePoint = workspace.points?.find((point) => point.id === fromPointId);
  const sourceTip = workspace.branches.find((branch) => branch.headPointId === sourcePoint?.id);
  const state = sourceTip?.present ?? sourcePoint?.state ?? activeHypothesis(workspace).present;
  let count = 1;
  while (workspace.branches.some((branch) => branch.name === `Branch ${count}`)) count += 1;
  const branch: Hypothesis = { id: crypto.randomUUID(), name: `Branch ${count}`, present: copyDeduction(state), undo: [], redo: [] };
  const point: HistoryPoint = { id: crypto.randomUUID(), parentId: sourcePoint?.id ?? activeHypothesis(workspace).headPointId, branchId: branch.id, kind: 'branch', name: branch.name, state: copyDeduction(state), consideredSuspectIds: [...consideredSuspectIds] };
  branch.headPointId = point.id;
  return { ...workspace, branches: [...workspace.branches, branch], activeId: branch.id, points: [...(workspace.points ?? []), point] };
}

export function switchHypothesis(workspace: BranchWorkspace, id: string): BranchWorkspace {
  return workspace.branches.some((branch) => branch.id === id) ? { ...workspace, activeId: id } : workspace;
}

export function continueFromPoint(workspace: BranchWorkspace, pointId: string): BranchWorkspace {
  const branch = workspace.branches.find((item) => item.headPointId === pointId);
  return branch ? { ...workspace, activeId: branch.id } : workspace;
}

export function renameHypothesis(workspace: BranchWorkspace, id: string, name: string): BranchWorkspace {
  if (id === 'main') return workspace;
  const updated = updateBranch(workspace, id, (branch) => ({ ...branch, name }));
  return { ...updated, points: updated.points?.map((point) => point.branchId === id && point.kind === 'branch' ? { ...point, name } : point) };
}

export function applyHypothesisToMain(workspace: BranchWorkspace): BranchWorkspace {
  const source = activeHypothesis(workspace);
  if (source.id === 'main') return workspace;
  const updated = updateBranch(workspace, 'main', (main) => ({ ...main, present: copyDeduction(source.present), undo: [...main.undo, copyDeduction(main.present)].slice(-HISTORY_LIMIT), redo: [] }));
  return { ...updated, activeId: 'main' };
}

export function discardHypothesis(workspace: BranchWorkspace): BranchWorkspace {
  if (workspace.activeId === 'main') return workspace;
  return { ...workspace, branches: workspace.branches.filter((branch) => branch.id !== workspace.activeId), points: workspace.points?.filter((point) => point.branchId !== workspace.activeId), activeId: 'main' };
}

function pruneDeduction(state: Deduction, puzzle: Puzzle): Deduction {
  const playable = new Set(puzzle.playable);
  const suspects = new Set(puzzle.suspects.map((suspect) => suspect.id));
  const blockingKinds = new Set(puzzle.objectKinds.filter((kind) => !kind.onWall && !kind.canOccupy).map((kind) => kind.id));
  const blocked = new Set<string>(puzzle.objects.filter((object) => !object.side && blockingKinds.has(object.kindId)).flatMap((object) => objectCells(puzzle, object)));
  const notes: Record<string, CellNote> = {};
  for (const [key, note] of Object.entries(state.notes)) {
    if (!playable.has(key) || blocked.has(key)) continue;
    if (note.type === 'blocked') notes[key] = { type: 'empty' };
    else if (note.type !== 'candidates') notes[key] = note;
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
    checkpoint: workspace.checkpoint && { ...workspace.checkpoint, state: pruneDeduction(workspace.checkpoint.state, puzzle), consideredSuspectIds: workspace.checkpoint.consideredSuspectIds?.filter((id) => puzzle.suspects.some((suspect) => suspect.id === id)) },
    points: workspace.points?.map((point) => ({ ...point, state: pruneDeduction(point.state, puzzle), consideredSuspectIds: point.consideredSuspectIds?.filter((id) => puzzle.suspects.some((suspect) => suspect.id === id)) })),
  };
}

function migrateHistory(workspace: BranchWorkspace): BranchWorkspace {
  if (workspace.points?.length) return workspace;
  const start: HistoryPoint = { id: crypto.randomUUID(), branchId: 'main', kind: 'start', state: { placements: [], notes: {} } };
  const points: HistoryPoint[] = [start];
  const branches = workspace.branches.map((branch) => {
    let parentId = start.id;
    if (branch.id !== 'main') {
      const forkState = branch.undo[0] ?? branch.present;
      parentId = [...points].reverse().find((point) => point.branchId === 'main' && samePlacements(point.state, forkState))?.id ?? start.id;
      const fork: HistoryPoint = { id: crypto.randomUUID(), parentId, branchId: branch.id, kind: 'branch', name: branch.name, state: copyDeduction(forkState) };
      points.push(fork);
      parentId = fork.id;
    }
    const states = [...branch.undo, branch.present];
    let previous = start.state;
    for (const state of states) {
      const added = state.placements.filter((item) => !previous.placements.some((old) => old.suspectId === item.suspectId && old.cell === item.cell));
      for (const placement of added) {
        const point: HistoryPoint = { id: crypto.randomUUID(), parentId, branchId: branch.id, kind: 'confirmed', suspectId: placement.suspectId, state: copyDeduction(state) };
        points.push(point);
        parentId = point.id;
      }
      previous = state;
    }
    return { ...branch, headPointId: parentId };
  });
  if (workspace.checkpoint && !workspace.checkpoint.name.startsWith('Checkpoint from ')) {
    const branch = branches.find((item) => item.id === workspace.activeId) ?? branches[0];
    const source = [...points].reverse().find((point) => samePlacements(point.state, workspace.checkpoint!.state));
    const point: HistoryPoint = { id: crypto.randomUUID(), parentId: source?.id ?? branch.headPointId, branchId: source?.branchId ?? branch.id, kind: 'checkpoint', name: workspace.checkpoint.name, state: copyDeduction(workspace.checkpoint.state), consideredSuspectIds: workspace.checkpoint.consideredSuspectIds };
    points.push(point);
    if (JSON.stringify(branch.present) === JSON.stringify(workspace.checkpoint.state)) branch.headPointId = point.id;
  }
  return { ...workspace, branches, points };
}

function compactReplayPoints(workspace: BranchWorkspace): BranchWorkspace {
  const points = [...(workspace.points ?? [])];
  const removed = new Map<string, string>();
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const parentIndex = points.findIndex((item) => item.id === point.parentId);
    const parent = points[parentIndex];
    if (point.kind !== 'confirmed' || parent?.kind !== 'confirmed' || point.branchId !== parent.branchId || point.suspectId !== parent.suspectId) continue;
    if (points.some((item) => item.id !== point.id && item.parentId === parent.id)) continue;
    point.parentId = parent.parentId;
    removed.set(parent.id, point.id);
    points.splice(parentIndex, 1);
    if (parentIndex < index) index -= 1;
  }
  const resolve = (id?: string) => { while (id && removed.has(id)) id = removed.get(id); return id; };
  return { ...workspace, points: points.map((point) => ({ ...point, parentId: resolve(point.parentId) })), branches: workspace.branches.map((branch) => ({ ...branch, headPointId: resolve(branch.headPointId) })) };
}

export function parseBranchWorkspace(input: unknown, puzzle: Puzzle, legacy: Deduction): BranchWorkspace {
  if (!input || typeof input !== 'object' || !('branches' in input) || !Array.isArray(input.branches)) return reconcileBranches(newBranchWorkspace(legacy), puzzle);
  const candidate = input as BranchWorkspace;
  const validState = (state: Deduction): boolean => !!state && Array.isArray(state.placements) && state.placements.every((item) => item && typeof item.suspectId === 'string' && typeof item.cell === 'string') && !!state.notes && typeof state.notes === 'object' && !Array.isArray(state.notes) && Object.values(state.notes).every((note) => note && (note.type === 'empty' || note.type === 'blocked' || (note.type === 'candidates' && Array.isArray(note.suspectIds) && note.suspectIds.every((id) => typeof id === 'string'))));
  if (!candidate.branches.length || !candidate.branches.some((branch) => branch.id === 'main') || candidate.branches.some((branch) => !branch || typeof branch.id !== 'string' || typeof branch.name !== 'string' || !validState(branch.present) || !Array.isArray(branch.undo) || !Array.isArray(branch.redo) || branch.undo.some((state) => !validState(state)) || branch.redo.some((state) => !validState(state)))) return reconcileBranches(newBranchWorkspace(legacy), puzzle);
  const checkpoint = candidate.checkpoint && typeof candidate.checkpoint.name === 'string' && validState(candidate.checkpoint.state) ? {
    name: candidate.checkpoint.name,
    state: candidate.checkpoint.state,
    consideredSuspectIds: Array.isArray(candidate.checkpoint.consideredSuspectIds) ? candidate.checkpoint.consideredSuspectIds.filter((id): id is string => typeof id === 'string') : undefined,
  } : undefined;
  const validPoints = Array.isArray(candidate.points) && candidate.points.length > 0 && candidate.points.every((point) => point && typeof point.id === 'string' && typeof point.branchId === 'string' && ['start', 'branch', 'checkpoint', 'confirmed'].includes(point.kind) && validState(point.state));
  return reconcileBranches(pruneUnreachablePoints(compactReplayPoints(migrateHistory({ ...candidate, points: validPoints ? candidate.points : undefined, activeId: candidate.branches.some((branch) => branch.id === candidate.activeId) ? candidate.activeId : 'main', checkpoint }))), puzzle);
}
