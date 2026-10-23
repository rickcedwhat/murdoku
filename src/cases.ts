import { changeDeduction, newBranchWorkspace, parseBranchWorkspace, type BranchWorkspace, type CellNote } from './branches';
import { objectCells, parsePuzzle, type Cell, type Placement, type Puzzle } from './puzzle';

export const CASE_LIBRARY_KEY = 'murdoku-cases-v1';
export const LEGACY_CASE_KEY = 'murdoku-companion-v1';

export type CaseMode = 'edit' | 'play';
export type SavedCase = {
  puzzle: Puzzle;
  branchWorkspace: BranchWorkspace;
  consideredSuspectIds: string[];
  scratchNotes: string;
  lastMode: CaseMode;
  updatedAt: string;
};

function legacyDeduction(raw: Record<string, unknown>, puzzle: Puzzle) {
  const placements = (Array.isArray(raw.placements) ? raw.placements : []).filter((item): item is Placement =>
    !!item && typeof item === 'object' && typeof item.suspectId === 'string' && typeof item.cell === 'string',
  );
  const notes: Record<string, CellNote> = {};
  if (raw.notes && typeof raw.notes === 'object' && !Array.isArray(raw.notes)) {
    for (const [key, value] of Object.entries(raw.notes)) {
      if (!puzzle.playable.includes(key) || !value || typeof value !== 'object' || !('type' in value)) continue;
      if (value.type === 'empty' || value.type === 'blocked') notes[key] = { type: 'empty' };
      else if (value.type === 'candidates' && 'suspectIds' in value && Array.isArray(value.suspectIds)) {
        notes[key] = { type: 'candidates', suspectIds: value.suspectIds.filter((id: unknown): id is string => typeof id === 'string') };
      }
    }
  }
  return { placements, notes };
}

export function parseSavedCase(input: unknown): SavedCase | null {
  if (!input || typeof input !== 'object' || !('puzzle' in input)) return null;
  const raw = input as Record<string, unknown>;
  try {
    const puzzle = parsePuzzle(raw.puzzle);
    const consideredSuspectIds = Array.isArray(raw.consideredSuspectIds)
      ? [...new Set(raw.consideredSuspectIds.filter((id): id is string => typeof id === 'string' && puzzle.suspects.some((person) => person.id === id)))]
      : [];
    return {
      puzzle,
      branchWorkspace: parseBranchWorkspace(raw.branchWorkspace, puzzle, legacyDeduction(raw, puzzle)),
      consideredSuspectIds,
      scratchNotes: typeof raw.scratchNotes === 'string' ? raw.scratchNotes : '',
      lastMode: raw.lastMode === 'play' ? 'play' : 'edit',
      updatedAt: typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function parseCaseLibrary(rawLibrary: string | null, rawLegacy: string | null): SavedCase[] {
  try {
    if (rawLibrary !== null) {
      const parsed = JSON.parse(rawLibrary);
      if (parsed && typeof parsed === 'object' && parsed.version === 1 && Array.isArray(parsed.cases)) {
        const seen = new Set<string>();
        return parsed.cases.flatMap((raw: unknown) => {
          const saved = parseSavedCase(raw);
          if (!saved || seen.has(saved.puzzle.id)) return [];
          seen.add(saved.puzzle.id);
          return [saved];
        });
      }
    }
  } catch {
    // Keep the legacy save available if the new library cannot be read.
  }
  try {
    const migrated = rawLegacy === null ? null : parseSavedCase(JSON.parse(rawLegacy));
    return migrated ? [migrated] : [];
  } catch {
    return [];
  }
}

export function newSavedCase(puzzle: Puzzle, mode: CaseMode = 'edit'): SavedCase {
  return { puzzle, branchWorkspace: newBranchWorkspace(), consideredSuspectIds: [], scratchNotes: '', lastMode: mode, updatedAt: new Date().toISOString() };
}

export function upsertCase(cases: SavedCase[], saved: SavedCase): SavedCase[] {
  return [saved, ...cases.filter((entry) => entry.puzzle.id !== saved.puzzle.id)];
}

export function fillLineWithXs(workspace: BranchWorkspace, puzzle: Puzzle, confirmedCell: Cell, axis: 'row' | 'column'): BranchWorkspace {
  const deduction = workspace.branches.find((branch) => branch.id === workspace.activeId)?.present;
  const placement = deduction?.placements.find((item) => item.cell === confirmedCell);
  if (!placement) return workspace;
  const [targetRow, targetCol] = confirmedCell.split(',').map(Number);
  const occupied = new Set<string>(deduction?.placements.map((item) => item.cell));
  const blocked = new Set<string>(puzzle.objects.filter((object) => !object.side && !puzzle.objectKinds.find((kind) => kind.id === object.kindId)?.canOccupy).flatMap((object) => objectCells(puzzle, object)));
  const cells = puzzle.playable.filter((key) => {
    const [row, col] = key.split(',').map(Number);
    return (axis === 'row' ? row === targetRow : col === targetCol) && key !== confirmedCell && !occupied.has(key) && !blocked.has(key) && deduction?.notes[key]?.type !== 'blocked';
  });
  if (!cells.length) return workspace;
  return changeDeduction(workspace, (state) => {
    for (const key of cells) state.notes[key] = { type: 'empty' };
    return state;
  });
}
