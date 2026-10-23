import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  assignCellToRoom,
  cell,
  coordinates,
  isOutsideWallEdge,
  isWallEdge,
  newPuzzle,
  normalizeRuleCount,
  objectCells,
  OBJECT_ART,
  parsePuzzle,
  placeObject,
  resizePuzzle,
  validatePlacements,
  validatePuzzle,
  type Cell,
  type Puzzle,
  type WallSide,
} from './puzzle';
import { ObjectMark } from './ObjectMark';
import { activeHypothesis, applyHypothesisToMain, changeDeduction, createHypothesis, discardHypothesis, newBranchWorkspace, reconcileBranches, redoDeduction, renameHypothesis, restoreCheckpoint, saveCheckpoint, switchHypothesis, undoDeduction, type BranchWorkspace } from './branches';
import { CASE_LIBRARY_KEY, LEGACY_CASE_KEY, fillLineWithXs, importTargetsActiveCase, newSavedCase, parseCaseLibrary, removeConfirmedCandidate, upsertCase, type SavedCase } from './cases';
import { suspectLetter as letterForSuspect, suspectsForInitial } from './suspectLetters';
import collegeDormitoryJson from '../local-cases/46-college-dormitory.json';

type Mode = 'edit' | 'play';
type Tool = 'outline' | 'room' | 'object' | 'erase';
type EditorTab = 'setup' | 'rooms' | 'furniture' | 'people' | 'rules';
type NoteTool = 'erase' | null;
const ROOM_COLORS = ['#d9e9df', '#f5e5cd', '#dce7f2', '#eadff0', '#f4deda', '#e8ebd6', '#e5dfea', '#dbece9'];
const HIDDEN_BUNDLED_CASES_KEY = 'murdoku-hidden-bundled-cases-v1';

function loadCases(): SavedCase[] {
  try {
    const existing = parseCaseLibrary(localStorage.getItem(CASE_LIBRARY_KEY), localStorage.getItem(LEGACY_CASE_KEY));
    const collegeDormitory = parsePuzzle(collegeDormitoryJson);
    let hidden: unknown = [];
    try { hidden = JSON.parse(localStorage.getItem(HIDDEN_BUNDLED_CASES_KEY) ?? '[]'); } catch { /* Ignore a damaged hidden-case list. */ }
    if (Array.isArray(hidden) && hidden.includes(collegeDormitory.id)) return existing;
    if (existing.some((saved) => saved.puzzle.id === collegeDormitory.id || saved.puzzle.title === collegeDormitory.title)) return existing;
    const cases = [newSavedCase(collegeDormitory, 'play'), ...existing];
    try { localStorage.setItem(CASE_LIBRARY_KEY, JSON.stringify({ version: 1, cases })); } catch { /* Keep the case available in memory. */ }
    return cases;
  } catch {
    return [];
  }
}

export default function App() {
  const [initial] = useState(loadCases);
  const [cases, setCases] = useState<SavedCase[]>(initial);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle>(() => initial[0]?.puzzle ?? newPuzzle());
  const [branchWorkspace, setBranchWorkspace] = useState<BranchWorkspace>(() => initial[0]?.branchWorkspace ?? newBranchWorkspace());
  const [consideredSuspectIds, setConsideredSuspectIds] = useState<string[]>(initial[0]?.consideredSuspectIds ?? []);
  const [scratchNotes, setScratchNotes] = useState(initial[0]?.scratchNotes ?? '');
  const [mode, setMode] = useState<Mode>('edit');
  const [editorTab, setEditorTab] = useState<EditorTab>('setup');
  const [playTab, setPlayTab] = useState<'clues' | 'checks'>('clues');
  const [noteTool, setNoteTool] = useState<NoteTool>(null);
  const [tool, setTool] = useState<Tool>('room');
  const [selectedRoom, setSelectedRoom] = useState(initial[0]?.puzzle.rooms[0]?.id ?? '');
  const [selectedKind, setSelectedKind] = useState(initial[0]?.puzzle.objectKinds[0]?.id ?? '');
  const [bedDirection, setBedDirection] = useState<WallSide>('E');
  const [activeNoteCell, setActiveNoteCell] = useState<Cell | null>(null);
  const [personChoices, setPersonChoices] = useState<{ cell: Cell; ids: string[]; confirmed: boolean } | null>(null);
  const [overlayPinned, setOverlayPinned] = useState(false);
  const [overlayHeld, setOverlayHeld] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [cellWidth, setCellWidth] = useState(58);
  const boardRef = useRef<HTMLDivElement>(null);
  const drawingPointer = useRef<number | null>(null);
  const paintedCells = useRef(new Set<string>());
  const libraryReady = useRef(false);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      const width = board.querySelector('.cell')?.getBoundingClientRect().width;
      if (width) setCellWidth((current) => Math.abs(current - width) > 0.5 ? width : current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [activeCaseId, puzzle.rows, puzzle.cols]);

  useEffect(() => {
    setBranchWorkspace((current) => {
      const reconciled = reconcileBranches(current, puzzle);
      return JSON.stringify(reconciled) === JSON.stringify(current) ? current : reconciled;
    });
  }, [puzzle]);

  useEffect(() => {
    if (!activeCaseId) return;
    setCases((current) => upsertCase(current, { puzzle, branchWorkspace, consideredSuspectIds, scratchNotes, lastMode: mode, updatedAt: new Date().toISOString() }));
  }, [activeCaseId, puzzle, branchWorkspace, consideredSuspectIds, scratchNotes, mode]);

  useEffect(() => {
    if (!libraryReady.current) { libraryReady.current = true; return; }
    try {
      localStorage.setItem(CASE_LIBRARY_KEY, JSON.stringify({ version: 1, cases }));
      setSaveFailed(false);
    } catch (error) {
      console.warn('Could not save this case on this device.', error);
      setSaveFailed(true);
    }
  }, [cases]);

  useEffect(() => {
    if (mode !== 'play') return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Shift' && !target?.closest('input, textarea, select, [contenteditable="true"]')) setOverlayHeld(true);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => { if (event.key === 'Shift') setOverlayHeld(false); };
    const onBlur = () => setOverlayHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, [mode]);

  const playable = useMemo(() => new Set(puzzle.playable), [puzzle.playable]);
  const roomByCell = useMemo(() => {
    const byCell = new Map<string, number>();
    puzzle.rooms.forEach((room, index) => room.cells.forEach((key) => byCell.set(key, index)));
    return byCell;
  }, [puzzle.rooms]);
  const roomLabels = useMemo(() => {
    const labels = new Map<Cell, { edge: 'top' | 'bottom'; left: string; fontSize: number }>();
    const occupied = new Set(puzzle.objects.filter((object) => !object.side).flatMap((object) => objectCells(puzzle, object)));
    const context = document.createElement('canvas').getContext('2d');
    for (const room of puzzle.rooms) {
      const roomCells = new Set(room.cells);
      const roomCenter = room.cells.reduce((sum, key) => sum + coordinates(key)[1] + 0.5, 0) / Math.max(room.cells.length, 1);
      const fontSize = room.name.length > 11 ? 11 : 12;
      if (context) context.font = `900 ${fontSize}px Georgia`;
      const labelWidth = ((context?.measureText(room.name.toUpperCase()).width ?? room.name.length * fontSize * 0.65) + 22) / cellWidth;
      const candidates: { key: Cell; edge: 'top' | 'bottom'; left: string; blocked: number; spill: number; score: number }[] = [];
      for (const key of room.cells) {
        const [row, col] = coordinates(key);
        for (const edge of ['top', 'bottom'] as const) {
          const boundary = !roomCells.has(cell(row + (edge === 'top' ? -1 : 1), col));
          let runStart = col;
          let runEnd = col;
          while (roomCells.has(cell(row, runStart - 1))) runStart--;
          while (roomCells.has(cell(row, runEnd + 1))) runEnd++;
          for (let step = 1; step <= 10; step++) {
            const x = col + step / 10;
            const left = x - labelWidth / 2;
            const right = x + labelWidth / 2;
            const spill = Math.max(0, runStart - left) + Math.max(0, right - runEnd - 1);
            const covered = Array.from({ length: Math.max(0, Math.ceil(right) - Math.floor(left)) }, (_, index) => cell(row, Math.floor(left) + index));
            const blocked = covered.reduce((total, coveredCell) => {
              if (!occupied.has(coveredCell) && !puzzle.objects.some((object) => object.cell === coveredCell && object.side === (edge === 'top' ? 'N' : 'S'))) return total;
              const coveredCol = coordinates(coveredCell)[1];
              return total + Math.max(0, Math.min(right, coveredCol + 1) - Math.max(left, coveredCol));
            }, 0);
            const score = Math.abs(x - roomCenter) * 10 + (boundary ? 0 : 3) + (edge === 'bottom' ? 0.5 : 0);
            candidates.push({ key: key as Cell, edge, left: `${(x - col) * 100}%`, blocked, spill, score });
          }
        }
      }
      const best = candidates.sort((a, b) => (a.spill > 0 ? 1 : 0) - (b.spill > 0 ? 1 : 0) || a.blocked - b.blocked || a.score - b.score || a.spill - b.spill)[0];
      if (best) labels.set(best.key, { edge: best.edge, left: best.left, fontSize });
    }
    return labels;
  }, [puzzle, cellWidth]);
  const floorObjectsByCell = useMemo(() => new Map(puzzle.objects.filter((object) => !object.side).flatMap((object) => objectCells(puzzle, object).map((key) => [key, object] as const))), [puzzle]);
  const wallObjectsByCell = useMemo(() => {
    const byCell = new Map<string, Puzzle['objects']>();
    for (const object of puzzle.objects.filter((item) => item.side)) {
      byCell.set(object.cell, [...(byCell.get(object.cell) ?? []), object]);
    }
    return byCell;
  }, [puzzle.objects]);
  const kindById = useMemo(() => new Map(puzzle.objectKinds.map((kind) => [kind.id, kind])), [puzzle.objectKinds]);
  const activeBranch = activeHypothesis(branchWorkspace);
  const { placements, notes } = activeBranch.present;
  const placementsByCell = useMemo(() => new Map(placements.map((placement) => [placement.cell, placement])), [placements]);
  const victimId = puzzle.suspects.find((suspect) => suspect.isVictim)?.id;
  const victimPlacement = placements.find((placement) => placement.suspectId === victimId);
  const victimRoom = victimPlacement && roomByCell.get(victimPlacement.cell);
  const victimRoommates = victimRoom === undefined ? [] : placements.filter((placement) => placement.suspectId !== victimId && roomByCell.get(placement.cell) === victimRoom);
  const murdererId = victimRoommates.length === 1 ? victimRoommates[0].suspectId : undefined;
  const selectedPlacement = placements.find((placement) => placement.cell === activeNoteCell);
  const showDiagramMap = mode === 'play' && (overlayPinned || overlayHeld);
  const deductionCellSize = Math.max(42, Math.ceil(Math.sqrt(puzzle.suspects.length)) * 14);
  const setupProblems = validatePuzzle(puzzle);
  const playProblems = validatePlacements(puzzle, placements);
  function suspectLetter(id: string): string {
    return letterForSuspect(puzzle.suspects, id);
  }

  function moveNoteFocus(key: Cell, arrow: string) {
    const [row, col] = coordinates(key);
    const [stepRow, stepCol] = arrow === 'ArrowUp' ? [-1, 0] : arrow === 'ArrowDown' ? [1, 0] : arrow === 'ArrowLeft' ? [0, -1] : [0, 1];
    for (let nextRow = row + stepRow, nextCol = col + stepCol; nextRow >= 0 && nextRow < puzzle.rows && nextCol >= 0 && nextCol < puzzle.cols; nextRow += stepRow, nextCol += stepCol) {
      const nextKey = cell(nextRow, nextCol);
      const nextCell = document.getElementById(`deduction-${nextKey}`) as HTMLButtonElement | null;
      if (nextCell && !nextCell.disabled) {
        setActiveNoteCell(nextKey);
        nextCell.focus();
        return;
      }
    }
  }

  function markCell(key: Cell, suspectId?: string, confirmed = false) {
    if (!playable.has(key)) return;
    const floor = floorObjectsByCell.get(key);
    if (floor && !kindById.get(floor.kindId)?.canOccupy) return;
    if (suspectId && confirmed) {
      setBranchWorkspace((current) => changeDeduction(current, (state) => {
        state.placements = state.placements.some((item) => item.suspectId === suspectId && item.cell === key)
          ? state.placements.filter((item) => item.cell !== key)
          : [...state.placements.filter((item) => item.suspectId !== suspectId && item.cell !== key), { suspectId, cell: key }];
        delete state.notes[key];
        return state;
      }));
      return;
    }
    if (suspectId) {
      setBranchWorkspace((current) => changeDeduction(current, (state) => {
        state.placements = state.placements.filter((item) => item.cell !== key);
        const existing = state.notes[key]?.type === 'candidates' ? state.notes[key].suspectIds : [];
        const suspectIds = existing.includes(suspectId) ? existing.filter((id) => id !== suspectId) : [...existing, suspectId];
        if (suspectIds.length) state.notes[key] = { type: 'candidates', suspectIds };
        else delete state.notes[key];
        return state;
      }));
      return;
    }
    if (!noteTool) return;
    setBranchWorkspace((current) => changeDeduction(current, (state) => {
      state.placements = state.placements.filter((item) => item.cell !== key);
      delete state.notes[key];
      return state;
    }));
  }

  function toggleX(key: Cell) {
    if (!playable.has(key)) return;
    const floor = floorObjectsByCell.get(key);
    if (floor && !kindById.get(floor.kindId)?.canOccupy) return;
    setBranchWorkspace((current) => changeDeduction(current, (state) => {
      state.placements = state.placements.filter((item) => item.cell !== key);
      if (state.notes[key]?.type === 'empty') delete state.notes[key];
      else state.notes[key] = { type: 'empty' };
      return state;
    }));
  }

  function clearDeductionCell(key: Cell) {
    if (!playable.has(key)) return;
    setBranchWorkspace((current) => changeDeduction(current, (state) => {
      state.placements = state.placements.filter((item) => item.cell !== key);
      delete state.notes[key];
      return state;
    }));
  }

  function updatePuzzle(next: Puzzle) {
    setPuzzle(next);
    setConsideredSuspectIds((current) => current.filter((id) => next.suspects.some((person) => person.id === id)));
    setNotice('');
  }

  async function uploadPortrait(suspectId: string, file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setNotice('Choose an image for the portrait.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 320;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      const size = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 320, 320);
      bitmap.close();
      const portrait = canvas.toDataURL('image/jpeg', 0.82);
      setPuzzle((current) => ({ ...current, suspects: current.suspects.map((suspect) => suspect.id === suspectId ? { ...suspect, portrait } : suspect) }));
      setNotice('Portrait added.');
    } catch {
      setNotice('Could not read that portrait image.');
    }
  }

  function typePerson(key: Cell, typed: string) {
    const matches = suspectsForInitial(puzzle.suspects, typed);
    if (!matches.length) return false;
    const confirmed = typed === typed.toUpperCase();
    if (matches.length > 1) {
      setPersonChoices({ cell: key, ids: matches.map((person) => person.id), confirmed });
      return true;
    }
    setPersonChoices(null);
    markCell(key, matches[0].id, confirmed);
    return true;
  }

  function choosePerson(key: Cell, id: string, confirmed: boolean) {
    setPersonChoices(null);
    markCell(key, id, confirmed);
    document.getElementById(`deduction-${key}`)?.focus();
  }

  function handleNoteKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: Cell) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      setPersonChoices(null);
      moveNoteFocus(key, event.key);
    } else if (event.key === 'Escape' && personChoices) {
      event.preventDefault();
      setPersonChoices(null);
    } else if (personChoices?.cell === key && /^[1-9]$/.test(event.key) && personChoices.ids[Number(event.key) - 1]) {
      event.preventDefault();
      choosePerson(key, personChoices.ids[Number(event.key) - 1], personChoices.confirmed);
    } else if (!event.repeat && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault();
      setPersonChoices(null);
      clearDeductionCell(key);
    } else if (!event.repeat && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      setPersonChoices(null);
      toggleX(key);
    } else if (!event.repeat && event.key.length === 1 && typePerson(key, event.key)) {
      event.preventDefault();
    }
  }

  function paintSelected(key: Cell) {
    if (paintedCells.current.has(key)) return;
    paintedCells.current.add(key);
    if (tool === 'room') {
      setPuzzle((current) => assignCellToRoom(current, key, selectedRoom));
    } else if (tool === 'object') {
      const kind = kindById.get(selectedKind);
      if (!kind) return;
      if (kind.onWall) return;
      setPuzzle((current) => placeObject(current, selectedKind, key, undefined, bedDirection));
    }
    setNotice('');
  }

  function roomCellFromPoint(event: PointerEvent<HTMLDivElement>): Cell | null {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const button = element?.closest<HTMLElement>('[data-cell]');
    return button && event.currentTarget.contains(button) ? button.dataset.cell as Cell : null;
  }

  function beginPaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (mode !== 'edit' || (tool !== 'room' && tool !== 'object') || event.button !== 0) return;
    if (tool === 'object' && kindById.get(selectedKind)?.onWall) return;
    const key = roomCellFromPoint(event);
    if (!key) return;
    drawingPointer.current = event.pointerId;
    paintedCells.current.clear();
    event.currentTarget.setPointerCapture(event.pointerId);
    paintSelected(key);
  }

  function continuePaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (drawingPointer.current !== event.pointerId) return;
    if (tool === 'object' && kindById.get(selectedKind)?.art === 'bed') return;
    const key = roomCellFromPoint(event);
    if (key) paintSelected(key);
  }

  function endPaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (drawingPointer.current !== event.pointerId) return;
    drawingPointer.current = null;
    paintedCells.current.clear();
  }

  function handleCell(key: Cell) {
    if (mode === 'play') return;

    if (tool === 'outline') {
      if (playable.has(key)) {
        updatePuzzle({
          ...puzzle,
          playable: puzzle.playable.filter((item) => item !== key),
          rooms: puzzle.rooms.map((room) => ({ ...room, cells: room.cells.filter((item) => item !== key) })),
          objects: puzzle.objects.filter((object) => !objectCells(puzzle, object).includes(key)),
          walls: puzzle.walls.filter((wall) => wall.from !== key && wall.to !== key),
        });
      } else {
        const roomId = selectedRoom || puzzle.rooms[0]?.id;
        updatePuzzle({
          ...puzzle,
          playable: [...puzzle.playable, key],
          rooms: puzzle.rooms.map((room) => room.id === roomId ? { ...room, cells: [...room.cells, key] } : room),
        });
      }
      return;
    }
    if (!playable.has(key)) return;
    if (tool === 'room') {
      setPuzzle((current) => assignCellToRoom(current, key, selectedRoom));
      setNotice('');
    } else if (tool === 'erase') {
      updatePuzzle({ ...puzzle, objects: puzzle.objects.filter((object) => !objectCells(puzzle, object).includes(key)) });
    } else if (tool === 'object') {
      if (kindById.get(selectedKind)?.onWall) return;
      paintedCells.current.clear();
      paintSelected(key);
    }
  }

  function setDimension(which: 'rows' | 'cols', value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 24) return;
    const next = resizePuzzle(puzzle, which === 'rows' ? value : puzzle.rows, which === 'cols' ? value : puzzle.cols);
    updatePuzzle(next);
  }

  function addRoom() {
    const id = crypto.randomUUID();
    updatePuzzle({ ...puzzle, rooms: [...puzzle.rooms, { id, name: `Room ${puzzle.rooms.length + 1}`, cells: [] }] });
    setSelectedRoom(id);
    setTool('room');
  }

  function removeRoom(id: string) {
    if (puzzle.rooms.length < 2) return;
    const removed = puzzle.rooms.find((room) => room.id === id);
    const firstOther = puzzle.rooms.find((room) => room.id !== id);
    if (!removed || !firstOther) return;
    updatePuzzle({
      ...puzzle,
      rooms: puzzle.rooms.filter((room) => room.id !== id).map((room) => room.id === firstOther.id
        ? { ...room, cells: [...room.cells, ...removed.cells] }
        : room),
    });
    if (selectedRoom === id) setSelectedRoom(firstOther.id);
  }

  function addSuspect() {
    const id = crypto.randomUUID();
    updatePuzzle({
      ...puzzle,
      suspects: [...puzzle.suspects, { id, name: `Person ${puzzle.suspects.length + 1}`, clue: '', isVictim: false }],
    });
  }

  function removeSuspect(id: string) {
    updatePuzzle({ ...puzzle, suspects: puzzle.suspects.filter((item) => item.id !== id) });
  }

  function addObjectKind() {
    const id = crypto.randomUUID();
    updatePuzzle({
      ...puzzle,
      objectKinds: [...puzzle.objectKinds, { id, name: 'Custom object', canOccupy: false, onWall: false, outsideOnly: false, art: 'custom' }],
    });
    setSelectedKind(id);
    setTool('object');
  }

  function removeObjectKind(id: string) {
    updatePuzzle({
      ...puzzle,
      objectKinds: puzzle.objectKinds.filter((kind) => kind.id !== id),
      objects: puzzle.objects.filter((object) => object.kindId !== id),
    });
    if (selectedKind === id) setSelectedKind(puzzle.objectKinds.find((kind) => kind.id !== id)?.id ?? '');
  }

  function setRule(key: keyof Puzzle['rules'], raw: string) {
    const rules = { ...puzzle.rules };
    if (raw === '') delete rules[key];
    else rules[key] = normalizeRuleCount(Number(raw));
    updatePuzzle({ ...puzzle, rules });
  }

  function downloadPuzzle() {
    const blob = new Blob([JSON.stringify(puzzle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${puzzle.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'murdoku-case'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importPuzzle(file: File | undefined) {
    if (!file) return;
    try {
      const imported = parsePuzzle(JSON.parse(await file.text()));
      const replacingCurrent = importTargetsActiveCase(imported, activeCaseId);
      const parsed = { ...imported, id: replacingCurrent ? imported.id : crypto.randomUUID() };
      const problems = validatePuzzle(parsed);
      setCases((current) => upsertCase(current, replacingCurrent
        ? { puzzle: parsed, branchWorkspace: reconcileBranches(branchWorkspace, parsed), consideredSuspectIds: consideredSuspectIds.filter((id) => parsed.suspects.some((suspect) => suspect.id === id)), scratchNotes, lastMode: 'edit', updatedAt: new Date().toISOString() }
        : newSavedCase(parsed)));
      setActiveCaseId(parsed.id);
      setPuzzle(parsed);
      setBranchWorkspace(replacingCurrent ? reconcileBranches(branchWorkspace, parsed) : newBranchWorkspace());
      setConsideredSuspectIds(replacingCurrent ? consideredSuspectIds.filter((id) => parsed.suspects.some((suspect) => suspect.id === id)) : []);
      if (!replacingCurrent) setScratchNotes('');
      setSelectedRoom(parsed.rooms[0]?.id ?? '');
      setSelectedKind(parsed.objectKinds[0]?.id ?? '');
      setActiveNoteCell(null);
      setPersonChoices(null);
      setMode('edit');
      setEditorTab('setup');
      setNotice(problems.length ? `Case imported with ${problems.length} item${problems.length === 1 ? '' : 's'} to correct.` : replacingCurrent ? 'Case updated from JSON.' : 'Case imported.');
    } catch {
      setNotice('Could not read that puzzle JSON file.');
    }
  }

  function newCase() {
    const next = newPuzzle();
    setCases((current) => upsertCase(current, newSavedCase(next)));
    setActiveCaseId(next.id);
    setPuzzle(next);
    setBranchWorkspace(newBranchWorkspace());
    setConsideredSuspectIds([]);
    setScratchNotes('');
    setSelectedRoom(next.rooms[0].id);
    setSelectedKind(next.objectKinds[0].id);
    setActiveNoteCell(null);
    setPersonChoices(null);
    setMode('edit');
    setEditorTab('setup');
    setNotice('New case ready.');
  }

  function openCase(saved: SavedCase) {
    setActiveCaseId(saved.puzzle.id);
    setPuzzle(saved.puzzle);
    setBranchWorkspace(saved.branchWorkspace);
    setConsideredSuspectIds(saved.consideredSuspectIds);
    setScratchNotes(saved.scratchNotes);
    setSelectedRoom(saved.puzzle.rooms[0]?.id ?? '');
    setSelectedKind(saved.puzzle.objectKinds[0]?.id ?? '');
    setActiveNoteCell(null);
    setPersonChoices(null);
    setOverlayPinned(false);
    setOverlayHeld(false);
    setMode(saved.lastMode);
    setNotice('');
  }

  function deleteCase(saved: SavedCase) {
    if (!window.confirm(`Delete “${saved.puzzle.title || 'Untitled case'}” and its saved notes? This cannot be undone.`)) return;
    if (saved.puzzle.id === collegeDormitoryJson.id) {
      try {
        const hidden = JSON.parse(localStorage.getItem(HIDDEN_BUNDLED_CASES_KEY) ?? '[]');
        localStorage.setItem(HIDDEN_BUNDLED_CASES_KEY, JSON.stringify([...new Set([...(Array.isArray(hidden) ? hidden : []), saved.puzzle.id])]));
      } catch { setSaveFailed(true); }
    }
    setCases((current) => current.filter((item) => item.puzzle.id !== saved.puzzle.id));
    setNotice(`Deleted ${saved.puzzle.title || 'Untitled case'}.`);
  }

  function toggleConsidered(id: string) {
    setConsideredSuspectIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button type="button" className="brand brand-button" onClick={() => { setActiveCaseId(null); setNotice(''); }} aria-label="Go to cases"><span className="brand-mark">M</span><span>Murdoku <strong>Companion</strong></span></button>
        <div className="save-indicator"><span aria-hidden="true" /> {saveFailed ? 'Could not save on this device — export your case' : 'Saved on this device'}</div>
      </header>

      <main className="main-layout">
        {activeCaseId === null ? <section className="home-page" aria-label="Your cases">
          <div className="home-heading"><div><p className="eyebrow">CASE LIBRARY</p><h1>Your cases</h1><p className="subtitle">Create a scene or pick up where you left off.</p></div><div className="home-actions"><button type="button" className="primary-button" onClick={newCase}>+ New case</button><label className="file-button">Import JSON<input type="file" accept="application/json,.json" onChange={(event) => { void importPuzzle(event.target.files?.[0]); event.target.value = ''; }} /></label></div></div>
          {notice && <p className="notice" role="status">{notice}</p>}
          {cases.length ? <div className="case-list">{cases.map((saved) => <article className="case-card" key={saved.puzzle.id}>
            <div><p className="eyebrow">{saved.puzzle.rows} × {saved.puzzle.cols} MAP · {saved.puzzle.suspects.length} PEOPLE</p><h2>{saved.puzzle.title.trim() || 'Untitled case'}</h2><p>{activeHypothesis(saved.branchWorkspace).present.placements.length} confirmed · Last worked on {new Date(saved.updatedAt).toLocaleDateString()}</p></div>
            <div className="case-card-actions"><button type="button" className="primary-button" onClick={() => openCase(saved)}>Continue →</button><button type="button" className="case-delete" onClick={() => deleteCase(saved)} aria-label={`Delete ${saved.puzzle.title || 'Untitled case'}`}>Delete</button></div>
          </article>)}</div> : <div className="empty-library"><h2>No cases yet</h2><p>Start by drawing your first map. It will appear here whenever you return.</p><button type="button" className="primary-button" onClick={newCase}>Create a case</button></div>}
        </section> : <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">MANUAL CASE BUILDER</p>
            <h1>{mode === 'edit' ? 'Build the scene' : puzzle.title}</h1>
            <p className="subtitle">{mode === 'edit' ? 'Build the illustrated scene, then solve on a separate deduction grid.' : 'Use the illustrated map as reference and mark your deductions on the smaller grid.'}</p>
          </div>
          <div className="mode-switch" role="group" aria-label="Mode">
            <button type="button" onClick={() => setActiveCaseId(null)}>← Cases</button>
            <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit map</button>
            <button type="button" className={mode === 'play' ? 'active' : ''} onClick={() => {
              if (setupProblems.length) { setNotice(setupProblems[0]); return; }
              setMode('play'); setNotice('');
            }}>Play case</button>
          </div>
        </div>

        {notice && <p className="notice" role="status">{notice}</p>}

        <div className="workspace">
          <section className="board-panel" aria-label="Puzzle board">
            <div className="panel-heading">
              <div><p className="eyebrow">CASE MAP</p><h2>{puzzle.title}</h2></div>
              <span className="dimension-badge">{puzzle.rows} × {puzzle.cols}</span>
            </div>
            {mode === 'edit' && <div className="tool-row" role="group" aria-label="Map tool">
              {([
                ['outline', 'Outline'], ['room', 'Room'], ['object', 'Object'], ['erase', 'Erase object'],
              ] as const).map(([value, label]) => <button key={value} type="button" className={tool === value ? 'selected' : ''} onClick={() => setTool(value)}>{label}</button>)}
            </div>}
            <div className="board-scroll">
              <div
                ref={boardRef}
                className={`board ${mode === 'edit' && (tool === 'room' || tool === 'object') ? 'painting' : ''}`}
                style={{ gridTemplateColumns: `repeat(${puzzle.cols}, minmax(46px, 1fr))` }}
                onPointerDown={beginPaintStroke}
                onPointerMove={continuePaintStroke}
                onPointerUp={endPaintStroke}
                onPointerCancel={endPaintStroke}
              >
                {Array.from({ length: puzzle.rows * puzzle.cols }, (_, index) => {
                  const row = Math.floor(index / puzzle.cols);
                  const col = index % puzzle.cols;
                  const key = cell(row, col);
                  const isPlayable = playable.has(key);
                  const roomIndex = roomByCell.get(key);
                  const room = roomIndex === undefined ? undefined : puzzle.rooms[roomIndex];
                  const floorObject = floorObjectsByCell.get(key);
                  const floorKind = floorObject && kindById.get(floorObject.kindId);
                  const bedCells = floorObject && floorKind?.art === 'bed' ? objectCells(puzzle, floorObject) : [];
                  const bedPart = bedCells.length === 2 ? (
                    bedCells.map(coordinates).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0].join(',') === key ? 'first' : 'second'
                  ) : undefined;
                  const bedAxis = bedCells.length === 2 && coordinates(bedCells[0])[0] !== coordinates(bedCells[1])[0] ? 'vertical' : 'horizontal';
                  const connections = floorObject && (['N', 'E', 'S', 'W'] as const).filter((side) => {
                    const adjacent = side === 'N' ? cell(row - 1, col) : side === 'S' ? cell(row + 1, col) : side === 'E' ? cell(row, col + 1) : cell(row, col - 1);
                    return floorObjectsByCell.get(adjacent)?.kindId === floorObject.kindId && roomByCell.get(adjacent) === roomIndex;
                  });
                  const wallObjects = wallObjectsByCell.get(key) ?? [];
                  const selected = mode === 'edit' && tool === 'room' && room?.id === selectedRoom;
                  const roomWalls = isPlayable && roomIndex !== undefined ? {
                    top: row === 0 || roomByCell.get(cell(row - 1, col)) !== roomIndex,
                    left: col === 0 || roomByCell.get(cell(row, col - 1)) !== roomIndex,
                    bottom: row === puzzle.rows - 1 || !playable.has(cell(row + 1, col)),
                    right: col === puzzle.cols - 1 || !playable.has(cell(row, col + 1)),
                  } : null;
                  const tileStyle = isPlayable && roomIndex !== undefined ? {
                    backgroundColor: ROOM_COLORS[roomIndex % ROOM_COLORS.length],
                  } : undefined;
                  return <div
                    key={key}
                    data-cell={key}
                    className={`cell ${isPlayable ? '' : 'outside'} ${selected ? 'room-selected' : ''} ${floorKind?.art === 'table' || floorKind?.art === 'carpet' || floorKind?.art === 'bed' ? 'tile-board-cell' : ''} ${bedPart === 'first' ? 'bed-anchor' : ''}`}
                    role={mode === 'edit' ? 'button' : undefined}
                    tabIndex={mode === 'edit' ? 0 : undefined}
                    style={tileStyle}
                    onClick={(event) => { if (mode === 'edit' && (tool === 'room' || tool === 'object') && event.detail > 0) return; handleCell(key); }}
                    aria-label={`Row ${row + 1}, column ${col + 1}${!isPlayable ? ', outside map' : ''}${room ? `, ${room.name}` : ''}${floorKind ? `, ${floorKind.name}` : ''}${wallObjects.length ? `, ${wallObjects.map((object) => `${kindById.get(object.kindId)?.name ?? 'Object'} on ${object.side} wall`).join(', ')}` : ''}`}
                    aria-pressed={mode === 'edit' && tool === 'room' ? selected : undefined}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleCell(key); } }}
                  >
                    {isPlayable && <>
                      {roomWalls?.top && <span className="room-wall room-wall-top" aria-hidden="true" />}
                      {roomWalls?.left && <span className="room-wall room-wall-left" aria-hidden="true" />}
                      {roomWalls?.bottom && <span className="room-wall room-wall-bottom" aria-hidden="true" />}
                      {roomWalls?.right && <span className="room-wall room-wall-right" aria-hidden="true" />}
                      {room && roomLabels.has(key) && <span className={`cell-room label-${roomLabels.get(key)?.edge}`} style={{ left: roomLabels.get(key)?.left, fontSize: roomLabels.get(key)?.fontSize }}>{room.name}</span>}
                      {floorKind && <span className={`cell-object ${floorKind.art === 'table' || floorKind.art === 'carpet' || floorKind.art === 'bed' ? 'tile-cell-object' : ''}`} title={floorKind.name}><ObjectMark kind={floorKind} connections={connections} bedPart={bedPart} bedAxis={bedAxis} bedReverse={floorObject?.bedDirection === 'W' || floorObject?.bedDirection === 'N'} /></span>}
                      {wallObjects.map((object) => {
                        const wallKind = kindById.get(object.kindId);
                        return wallKind && <ObjectMark key={object.id} kind={wallKind} className={`wall-object wall-${object.side?.toLowerCase()}`} />;
                      })}
                      {mode === 'edit' && (tool === 'erase' || (tool === 'object' && kindById.get(selectedKind)?.onWall)) && (['N', 'E', 'S', 'W'] as const).map((side) => {
                        const existing = wallObjects.find((object) => object.side === side);
                        const kind = kindById.get(selectedKind);
                        const available = tool === 'erase' ? !!existing : !!kind && isWallEdge(puzzle, key, side) && (!(kind.id === 'window' || kind.outsideOnly) || isOutsideWallEdge(puzzle, key, side));
                        if (!available) return null;
                        return <span key={side} role="button" tabIndex={0} className={`edge-target edge-${side.toLowerCase()} ${existing ? 'occupied' : ''}`} aria-label={`${tool === 'erase' ? 'Remove' : 'Place'} ${tool === 'erase' ? kindById.get(existing?.kindId ?? '')?.name ?? 'object' : kind?.name} on ${side} wall of row ${row + 1}, column ${col + 1}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                          event.stopPropagation();
                          if (tool === 'erase' && existing) updatePuzzle({ ...puzzle, objects: puzzle.objects.filter((object) => object.id !== existing.id) });
                          if (tool === 'object') { setPuzzle((current) => placeObject(current, selectedKind, key, side)); setNotice(''); }
                        }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }} />;
                      })}
                    </>}
                  </div>;
                })}
              </div>
            </div>
            <div className="board-footer">
              <span>{puzzle.playable.length} playable cells · {puzzle.rooms.length} rooms</span>
              <span>{mode === 'edit' ? (tool === 'object' && kindById.get(selectedKind)?.onWall ? 'Click a highlighted wall edge' : tool === 'room' || tool === 'object' ? 'Tap or drag to paint' : 'Tap cells to apply the selected tool') : 'Illustrated reference map'}</span>
            </div>
            {mode === 'play' && <section className="deduction-panel" aria-label="Deduction grid">
              <div className="deduction-heading"><div><p className="eyebrow">DEDUCTION GRID</p><h2>Your notes</h2></div><div className="diagram-heading-actions"><button type="button" className="diagram-map-toggle" aria-pressed={overlayPinned} onClick={() => setOverlayPinned((current) => !current)}>{overlayPinned ? 'Hide map' : 'Show map'}</button><span className="dimension-badge">{placements.length} confirmed</span></div></div>
              <div className="branch-panel" aria-label="Hypotheses">
                <div className="branch-heading"><strong>Hypotheses</strong><span>{branchWorkspace.checkpoint ? branchWorkspace.checkpoint.name : 'Save a point to try different ideas'}</span></div>
                {branchWorkspace.checkpoint && <div className="checkpoint-summary">
                  <span>{branchWorkspace.checkpoint.state.placements.length} confirmed · {Object.keys(branchWorkspace.checkpoint.state.notes).length} noted cells</span>
                  <span>{branchWorkspace.checkpoint.consideredSuspectIds ? `Checked: ${puzzle.suspects.filter((person) => branchWorkspace.checkpoint?.consideredSuspectIds?.includes(person.id)).map((person) => person.name).join(', ') || 'none'}` : 'Checked people were not saved in this older checkpoint'}</span>
                </div>}
                <div className="branch-list" role="group" aria-label="Choose hypothesis">{branchWorkspace.branches.map((branch) => <button key={branch.id} type="button" className={branchWorkspace.activeId === branch.id ? 'selected' : ''} aria-pressed={branchWorkspace.activeId === branch.id} onClick={() => setBranchWorkspace((current) => switchHypothesis(current, branch.id))}>{branch.name}</button>)}</div>
                {activeBranch.id !== 'main' && <label className="branch-name">Branch name<input aria-label="Branch name" value={activeBranch.name} onChange={(event) => setBranchWorkspace((current) => renameHypothesis(current, activeBranch.id, event.target.value))} /></label>}
                <div className="branch-actions">
                  <button type="button" onClick={() => setBranchWorkspace((current) => saveCheckpoint(current, consideredSuspectIds))}>Save checkpoint</button>
                  <button type="button" onClick={() => setBranchWorkspace((current) => createHypothesis(current, consideredSuspectIds))}>+ New hypothesis</button>
                  {branchWorkspace.checkpoint && <button type="button" onClick={() => {
                    setBranchWorkspace(restoreCheckpoint);
                    if (branchWorkspace.checkpoint?.consideredSuspectIds) setConsideredSuspectIds([...branchWorkspace.checkpoint.consideredSuspectIds]);
                  }}>Restore checkpoint</button>}
                </div>
                {activeBranch.id !== 'main' && <div className="branch-actions branch-outcomes"><button type="button" onClick={() => setBranchWorkspace(applyHypothesisToMain)}>Apply to Main</button><button type="button" onClick={() => setBranchWorkspace(discardHypothesis)}>Discard hypothesis</button></div>}
                <div className="history-actions"><button type="button" disabled={!activeBranch.undo.length} onClick={() => setBranchWorkspace(undoDeduction)}>↶ Undo</button><button type="button" disabled={!activeBranch.redo.length} onClick={() => setBranchWorkspace(redoDeduction)}>↷ Redo</button><button type="button" onClick={() => setBranchWorkspace((current) => changeDeduction(current, () => ({ placements: [], notes: {} })))}>Reset notes</button></div>
              </div>
              <p className="hint">Click a cell, then type a lowercase initial to pencil a person or uppercase to confirm them. Press X to mark it empty or Backspace to clear it. Hold Shift to see the map beneath your notes. Use arrow keys to move between cells.</p>
              <div className="note-tools" role="group" aria-label="Deduction mark">
                <button type="button" className={noteTool === 'erase' ? 'selected' : ''} onClick={() => {
                  setNoteTool((current) => current === 'erase' ? null : 'erase');
                  setPersonChoices(null);
                  if (activeNoteCell) document.getElementById(`deduction-${activeNoteCell}`)?.focus();
                }}>Erase</button>
              </div>
              {personChoices && <div className="person-choices" role="group" aria-label="Choose person for repeated initial"><span>Which person?</span>{personChoices.ids.map((id, index) => {
                const person = puzzle.suspects.find((suspect) => suspect.id === id);
                return person && <button key={id} type="button" onClick={() => choosePerson(personChoices.cell, id, personChoices.confirmed)}>{index < 9 ? `${index + 1} · ` : ''}{personChoices.confirmed ? suspectLetter(id) : suspectLetter(id).toLowerCase()} {person.name}</button>;
              })}<span className="choice-hint">Press a number or click a name.</span></div>}
              {selectedPlacement && <div className="line-actions"><span>{suspectLetter(selectedPlacement.suspectId)} confirmed at row {coordinates(selectedPlacement.cell)[0] + 1}, column {coordinates(selectedPlacement.cell)[1] + 1}</span><button type="button" onClick={() => setBranchWorkspace((current) => removeConfirmedCandidate(current, selectedPlacement.suspectId, selectedPlacement.cell))}>Clear other {suspectLetter(selectedPlacement.suspectId)} pencils</button><button type="button" onClick={() => setBranchWorkspace((current) => fillLineWithXs(current, puzzle, selectedPlacement.cell, 'row'))}>Fill row Xs</button><button type="button" onClick={() => setBranchWorkspace((current) => fillLineWithXs(current, puzzle, selectedPlacement.cell, 'column'))}>Fill column Xs</button></div>}
              <div className="deduction-content"><div className="deduction-scroll"><div className={`deduction-grid ${showDiagramMap ? 'map-view' : ''}`} style={{ gridTemplateColumns: `repeat(${puzzle.cols}, ${deductionCellSize}px)` }}>{Array.from({ length: puzzle.rows * puzzle.cols }, (_, index) => {
                const row = Math.floor(index / puzzle.cols);
                const col = index % puzzle.cols;
                const key = cell(row, col);
                const isPlayable = playable.has(key);
                const roomIndex = roomByCell.get(key);
                const diagramWalls = isPlayable && roomIndex !== undefined ? {
                  top: row === 0 || roomByCell.get(cell(row - 1, col)) !== roomIndex,
                  left: col === 0 || roomByCell.get(cell(row, col - 1)) !== roomIndex,
                  bottom: row === puzzle.rows - 1 || !playable.has(cell(row + 1, col)),
                  right: col === puzzle.cols - 1 || !playable.has(cell(row, col + 1)),
                } : null;
                const floor = floorObjectsByCell.get(key);
                const floorKind = floor && kindById.get(floor.kindId);
                const bedCells = floor && floorKind?.art === 'bed' ? objectCells(puzzle, floor) : [];
                const bedPart = bedCells.length === 2 ? (
                  bedCells.map(coordinates).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0].join(',') === key ? 'first' : 'second'
                ) : undefined;
                const bedAxis = bedCells.length === 2 && coordinates(bedCells[0])[0] !== coordinates(bedCells[1])[0] ? 'vertical' : 'horizontal';
                const connections = floor && (['N', 'E', 'S', 'W'] as const).filter((side) => {
                  const adjacent = side === 'N' ? cell(row - 1, col) : side === 'S' ? cell(row + 1, col) : side === 'E' ? cell(row, col + 1) : cell(row, col - 1);
                  return floorObjectsByCell.get(adjacent)?.kindId === floor.kindId && roomByCell.get(adjacent) === roomIndex;
                });
                const tableCorner = floor && floorKind?.art === 'table' && connections?.includes('S') && !connections.includes('E') && floorObjectsByCell.get(cell(row + 1, col + 1))?.kindId === floor.kindId ? 'table-inner-corner-se' : '';
                const wallObjects = wallObjectsByCell.get(key) ?? [];
                const fixedBlocked = !!floor && !kindById.get(floor.kindId)?.canOccupy;
                const note = notes[key];
                const placement = placementsByCell.get(key);
                const confirmed = puzzle.suspects.find((suspect) => suspect.id === placement?.suspectId);
                const candidateIds = note?.type === 'candidates' ? note.suspectIds : [];
                const mark = fixedBlocked ? '' : note?.type === 'empty' || note?.type === 'blocked' ? 'X' : confirmed ? <span className={`confirmed-token ${confirmed.isVictim ? 'victim-token' : confirmed.id === murdererId ? 'murderer-token' : ''}`} title={confirmed.isVictim ? 'Victim' : confirmed.id === murdererId ? 'Murderer: alone with the victim' : undefined}>{suspectLetter(confirmed.id)}</span> : candidateIds.length ? <span className="candidate-grid" style={{ gridTemplateColumns: `repeat(${Math.max(3, Math.ceil(Math.sqrt(puzzle.suspects.length)))}, 1fr)` }}>{Array.from({ length: Math.max(9, puzzle.suspects.length) }, (_, slot) => <span className="candidate-slot" key={slot}>{puzzle.suspects[slot] && candidateIds.includes(puzzle.suspects[slot].id) ? suspectLetter(puzzle.suspects[slot].id).toLowerCase() : ''}</span>)}</span> : '';
                return <button key={key} id={`deduction-${key}`} type="button" className={`deduction-cell ${!isPlayable ? 'outside' : ''} ${fixedBlocked ? 'slash' : ''} ${confirmed ? 'confirmed' : ''} ${candidateIds.length ? 'candidates' : ''} ${activeNoteCell === key ? 'active' : ''} ${showDiagramMap && bedPart === 'first' ? 'map-bed-anchor' : ''}`} style={isPlayable && roomIndex !== undefined ? { backgroundColor: ROOM_COLORS[roomIndex % ROOM_COLORS.length], width: deductionCellSize, height: deductionCellSize } : { width: deductionCellSize, height: deductionCellSize }} disabled={!isPlayable || fixedBlocked} aria-pressed={activeNoteCell === key} onFocus={() => { setActiveNoteCell(key); if (personChoices?.cell !== key) setPersonChoices(null); }} onClick={() => { setActiveNoteCell(key); if (noteTool) markCell(key); }} onKeyDown={(event) => handleNoteKeyDown(event, key)} aria-label={`Row ${row + 1}, column ${col + 1}: ${!isPlayable ? 'outside map' : fixedBlocked ? 'blocked by furniture' : confirmed ? `confirmed ${confirmed.name}` : note?.type === 'candidates' ? `possible ${note.suspectIds.map((id) => puzzle.suspects.find((suspect) => suspect.id === id)?.name).join(', ')}` : note?.type === 'empty' || note?.type === 'blocked' ? 'empty' : 'unmarked'}`}>
                  {showDiagramMap && isPlayable && <span className={`diagram-map-overlay ${tableCorner}`} aria-hidden="true">{floorKind && <ObjectMark kind={floorKind} connections={connections} bedPart={bedPart} bedAxis={bedAxis} bedReverse={floor?.bedDirection === 'W' || floor?.bedDirection === 'N'} />}{wallObjects.map((object) => { const kind = kindById.get(object.kindId); return kind && <ObjectMark key={object.id} kind={kind} className={`wall-object wall-${object.side?.toLowerCase()}`} />; })}</span>}
                  <span className="deduction-mark">{mark}</span>
                  {diagramWalls?.top && <span className="deduction-wall deduction-wall-top" aria-hidden="true" />}{diagramWalls?.left && <span className="deduction-wall deduction-wall-left" aria-hidden="true" />}{diagramWalls?.bottom && <span className="deduction-wall deduction-wall-bottom" aria-hidden="true" />}{diagramWalls?.right && <span className="deduction-wall deduction-wall-right" aria-hidden="true" />}
                </button>;
              })}</div></div><label className="scratchpad">Scratch notes<textarea aria-label="Scratch notes" placeholder="Jot down ideas, room possibilities, or anything else…" value={scratchNotes} onChange={(event) => setScratchNotes(event.target.value)} /></label></div>
            </section>}
          </section>

          <aside className="sidebar">
            {mode === 'edit' ? <>
              <nav className="sidebar-tabs" aria-label="Case builder steps">{([['setup', 'Setup'], ['rooms', 'Rooms'], ['furniture', 'Furniture'], ['people', 'Clues'], ['rules', 'Rules']] as const).map(([value, label]) => <button key={value} type="button" className={editorTab === value ? 'active' : ''} aria-current={editorTab === value ? 'step' : undefined} onClick={() => { setEditorTab(value); if (value === 'rooms') setTool('room'); if (value === 'furniture') setTool('object'); }}>{label}</button>)}</nav>
              {editorTab === 'setup' && <section className="card">
                <div className="card-title"><h2>Case setup</h2></div>
                <label>Case title<input value={puzzle.title} onChange={(event) => updatePuzzle({ ...puzzle, title: event.target.value })} /></label>
                <div className="two-fields">
                  <label>Rows<input type="number" min="1" max="24" value={puzzle.rows} onChange={(event) => setDimension('rows', Number(event.target.value))} /></label>
                  <label>Columns<input type="number" min="1" max="24" value={puzzle.cols} onChange={(event) => setDimension('cols', Number(event.target.value))} /></label>
                </div>
                <p className="hint">Use Outline on the map to remove cells from an irregular scene.</p>
              </section>}

              {editorTab === 'rooms' && <section className="card">
                <div className="card-title"><h2>Rooms</h2></div>
                {puzzle.rooms.map((room, index) => <div className="list-row" key={room.id}>
                  <button type="button" className={`swatch ${selectedRoom === room.id ? 'chosen' : ''}`} style={{ backgroundColor: ROOM_COLORS[index % ROOM_COLORS.length] }} onClick={() => { setSelectedRoom(room.id); setTool('room'); }} aria-label={`Paint ${room.name}`} />
                  <input aria-label={`Room ${index + 1} name`} value={room.name} onChange={(event) => updatePuzzle({ ...puzzle, rooms: puzzle.rooms.map((item) => item.id === room.id ? { ...item, name: event.target.value } : item) })} />
                  <span className="count">{room.cells.length}</span>
                  <button type="button" className="icon-button" onClick={() => removeRoom(room.id)} disabled={puzzle.rooms.length < 2} aria-label={`Remove ${room.name}`}>×</button>
                </div>)}
                <button type="button" className="text-button" onClick={addRoom}>+ Add room</button>
              </section>}

              {editorTab === 'furniture' && <section className="card">
                <div className="card-title"><h2>Furniture</h2></div>
                <p className="hint">For floor objects, tap or drag across cells. For wall objects, click the wall edge itself.</p>
                <div className="kind-list">{puzzle.objectKinds.map((kind) => <div className={`kind-row ${selectedKind === kind.id && tool === 'object' ? 'chosen' : ''}`} key={kind.id}>
                  <button type="button" className="kind-picker" aria-label={`Place ${kind.name}`} aria-pressed={selectedKind === kind.id && tool === 'object'} onClick={() => { setSelectedKind(kind.id); setTool('object'); }}>
                    <ObjectMark kind={kind} className="kind-symbol" />
                  </button>
                  <div className="kind-fields">
                    <input aria-label={`${kind.name} type name`} value={kind.name} onChange={(event) => updatePuzzle({ ...puzzle, objectKinds: puzzle.objectKinds.map((item) => item.id === kind.id ? { ...item, name: event.target.value } : item) })} />
                    <select className="art-select" aria-label={`${kind.name} artwork`} value={kind.art} disabled={kind.onWall} onChange={(event) => updatePuzzle({ ...puzzle, objectKinds: puzzle.objectKinds.map((item) => item.id === kind.id ? { ...item, art: event.target.value as Puzzle['objectKinds'][number]['art'] } : item) })}>
                      {(kind.onWall ? ['bar'] as const : OBJECT_ART.filter((art) => art !== 'bar')).map((art) => <option key={art} value={art}>{art === 'tv' ? 'TV' : art === 'custom' ? 'Letter' : art[0].toUpperCase() + art.slice(1)}</option>)}
                    </select>
                    <div className="kind-flags">
                      <label className="checkbox-label"><input type="checkbox" checked={kind.canOccupy} onChange={(event) => updatePuzzle({ ...puzzle, objectKinds: puzzle.objectKinds.map((item) => item.id === kind.id ? { ...item, canOccupy: event.target.checked } : item) })} /> Can occupy</label>
                      <label className="checkbox-label" title={puzzle.objects.some((object) => object.kindId === kind.id) ? 'Remove placed copies before changing wall placement.' : undefined}><input type="checkbox" checked={kind.onWall} disabled={puzzle.objects.some((object) => object.kindId === kind.id)} onChange={(event) => updatePuzzle({ ...puzzle, objectKinds: puzzle.objectKinds.map((item) => item.id === kind.id ? { ...item, onWall: event.target.checked, art: event.target.checked ? 'bar' : 'custom' } : item) })} /> On wall</label>
                      {kind.onWall && <label className="checkbox-label"><input type="checkbox" checked={kind.id === 'window' || kind.outsideOnly} disabled={kind.id === 'window'} onChange={(event) => updatePuzzle({ ...puzzle, objectKinds: puzzle.objectKinds.map((item) => item.id === kind.id ? { ...item, outsideOnly: event.target.checked } : item) })} /> Outside only</label>}
                    </div>
                  </div>
                  <button type="button" className="icon-button" aria-label={`Remove ${kind.name} type and its placed copies`} onClick={() => removeObjectKind(kind.id)}>×</button>
                </div>)}</div>
                <button type="button" className="text-button" onClick={addObjectKind}>+ Add custom object</button>
                {kindById.get(selectedKind)?.onWall && <p className="hint">Highlighted wall edges are placement targets. Windows are limited to outside walls.</p>}
                {kindById.get(selectedKind)?.art === 'bed' && <div className="bed-direction" role="group" aria-label="Bed direction"><span>Bed extends</span>{([['E', 'Right'], ['S', 'Down'], ['W', 'Left'], ['N', 'Up']] as const).map(([value, label]) => <button key={value} type="button" className={bedDirection === value ? 'selected' : ''} onClick={() => setBedDirection(value)}>{label}</button>)}</div>}
              </section>}

              {editorTab === 'people' && <section className="card">
                <div className="card-title"><h2>Clues</h2></div>
                {puzzle.suspects.map((suspect, index) => <div className="person-editor" key={suspect.id}>
                  <div className="person-header"><span className="person-number">{index + 1}</span>{suspect.portrait && <img className="person-editor-portrait" src={suspect.portrait} alt={`${suspect.name} portrait`} />}<input aria-label={`Person ${index + 1} name`} value={suspect.name} onChange={(event) => updatePuzzle({ ...puzzle, suspects: puzzle.suspects.map((item) => item.id === suspect.id ? { ...item, name: event.target.value } : item) })} /><button type="button" className="icon-button" aria-label={`Remove ${suspect.name}`} onClick={() => removeSuspect(suspect.id)}>×</button></div>
                  <label className="portrait-upload">{suspect.portrait ? 'Change portrait' : 'Add portrait'}<input type="file" accept="image/*" aria-label={`${suspect.name} portrait image`} onChange={(event) => { void uploadPortrait(suspect.id, event.target.files?.[0]); event.target.value = ''; }} /></label>
                  <textarea aria-label={`${suspect.name} clue`} placeholder="Their clue, exactly as printed" value={suspect.clue} rows={2} onChange={(event) => updatePuzzle({ ...puzzle, suspects: puzzle.suspects.map((item) => item.id === suspect.id ? { ...item, clue: event.target.value } : item) })} />
                  <label className="checkbox-label"><input type="checkbox" checked={suspect.isVictim} onChange={(event) => updatePuzzle({ ...puzzle, suspects: puzzle.suspects.map((item) => item.id === suspect.id ? { ...item, isVictim: event.target.checked } : item) })} /> Victim</label>
                </div>)}
                <button type="button" className="text-button" onClick={addSuspect}>+ Add person</button>
                <label>Case-wide clues<textarea rows={3} placeholder="One clue per line" value={puzzle.caseClues.join('\n')} onChange={(event) => updatePuzzle({ ...puzzle, caseClues: event.target.value.split('\n') })} /></label>
              </section>}

              {editorTab === 'rules' && <section className="card">
                <div className="card-title"><h2>Special rules</h2></div>
                <p className="hint">Only fill these when the case explicitly states a count.</p>
                <div className="three-fields">
                  {([['emptyRows', 'Empty rows'], ['emptyCols', 'Empty columns'], ['emptyRooms', 'Empty rooms']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="1" value={puzzle.rules[key] ?? ''} onChange={(event) => setRule(key, event.target.value)} /></label>)}
                </div>
              </section>}

              {setupProblems.length > 0 && <section className="card issue-card"><h2>Before playing</h2><ul>{setupProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></section>}
              <section className="card actions-card">
                <button type="button" className="primary-button" onClick={() => { if (setupProblems.length) { setNotice(setupProblems[0]); return; } setMode('play'); setNotice(''); }}>Play this case →</button>
                <div className="secondary-actions"><button type="button" onClick={downloadPuzzle}>Export JSON</button><label className="file-button">Import JSON<input type="file" accept="application/json,.json" onChange={(event) => { void importPuzzle(event.target.files?.[0]); event.target.value = ''; }} /></label><button type="button" onClick={newCase}>New case</button></div>
              </section>
            </> : <>
              <nav className="sidebar-tabs play-tabs" aria-label="Play case panels">{([['clues', 'Clues'], ['checks', 'Checks']] as const).map(([value, label]) => <button key={value} type="button" className={playTab === value ? 'active' : ''} onClick={() => setPlayTab(value)}>{label}</button>)}</nav>
              {playTab === 'clues' && <section className="card"><div className="card-title"><h2>Clues</h2></div>{puzzle.caseClues.filter(Boolean).map((clue, index) => <p className="clue" key={index}>{clue}</p>)}<p className="hint">Check a person once you have considered every possible spot.</p><div className="person-clues">{puzzle.suspects.map((suspect) => {
                const placed = placements.find((item) => item.suspectId === suspect.id);
                return <div className="person-clue" key={suspect.id}><div className="person-clue-heading">{suspect.portrait ? <img className="person-portrait" src={suspect.portrait} alt={`${suspect.name} portrait`} /> : <span className="suspect-avatar">{suspectLetter(suspect.id)}</span>}<div className="person-clue-copy"><strong>{suspectLetter(suspect.id)} · {suspect.name}{suspect.isVictim ? ' · Victim' : ''}</strong><p>{suspect.clue.trim() || 'No clue entered.'}</p>{placed && <small>Placed at row {coordinates(placed.cell)[0] + 1}, column {coordinates(placed.cell)[1] + 1}</small>}</div><label className="checkbox-label considered-check"><input type="checkbox" checked={consideredSuspectIds.includes(suspect.id)} onChange={() => toggleConsidered(suspect.id)} aria-label={`${suspect.name} fully considered`} /></label></div></div>;
              })}</div>{!puzzle.caseClues.some(Boolean) && puzzle.suspects.length === 0 && <p className="empty-note">No clues entered yet.</p>}</section>}
              {playTab === 'checks' && playProblems.length > 0 && <section className="card issue-card" role="status"><h2>Check these placements</h2><ul>{playProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></section>}
              {playTab === 'checks' && playProblems.length === 0 && <section className="card good-card"><strong>No placement conflicts</strong><p>Clue text is for manual deduction in this first version.</p></section>}
              <button type="button" className="text-button back-button" onClick={() => setMode('edit')}>← Edit this case</button>
            </>}
          </aside>
        </div>
        </>}
      </main>
    </div>
  );
}
