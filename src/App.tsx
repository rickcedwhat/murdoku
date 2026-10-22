import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  assignCellToRoom,
  cell,
  coordinates,
  isOutsideWallEdge,
  isWallEdge,
  newPuzzle,
  normalizeRuleCount,
  OBJECT_ART,
  parsePuzzle,
  placeObject,
  resizePuzzle,
  validatePlacements,
  validatePuzzle,
  type Cell,
  type Placement,
  type Puzzle,
} from './puzzle';
import { ObjectMark } from './ObjectMark';
import { activeHypothesis, applyHypothesisToMain, changeDeduction, createHypothesis, discardHypothesis, newBranchWorkspace, parseBranchWorkspace, reconcileBranches, redoDeduction, renameHypothesis, restoreCheckpoint, saveCheckpoint, switchHypothesis, undoDeduction, type BranchWorkspace, type CellNote } from './branches';

type Mode = 'edit' | 'play';
type Tool = 'outline' | 'room' | 'object' | 'erase';
type EditorTab = 'setup' | 'rooms' | 'furniture' | 'people' | 'rules';
type NoteTool = 'candidate' | 'confirmed' | 'empty' | 'blocked' | 'erase';
type SavedCase = { puzzle: Puzzle; branchWorkspace: BranchWorkspace };

const STORAGE_KEY = 'murdoku-companion-v1';
const ROOM_COLORS = ['#d9e9df', '#f5e5cd', '#dce7f2', '#eadff0', '#f4deda', '#e8ebd6', '#e5dfea', '#dbece9'];

function loadCase(): SavedCase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { puzzle?: unknown; placements?: unknown; notes?: unknown; branchWorkspace?: unknown };
      const parsed = parsePuzzle(saved.puzzle);
      if (Array.isArray(saved.placements) || saved.branchWorkspace) {
        const placements = (Array.isArray(saved.placements) ? saved.placements : []).filter((item): item is Placement =>
          typeof item === 'object' && item !== null &&
          typeof (item as Placement).suspectId === 'string' &&
          typeof (item as Placement).cell === 'string',
        );
        const notes: Record<string, CellNote> = {};
        if (saved.notes && typeof saved.notes === 'object' && !Array.isArray(saved.notes)) {
          for (const [key, note] of Object.entries(saved.notes)) {
            if (!parsed.playable.includes(key) || !note || typeof note !== 'object' || !('type' in note)) continue;
            if (note.type === 'empty' || note.type === 'blocked') notes[key] = { type: note.type };
            else if (note.type === 'candidates' && 'suspectIds' in note && Array.isArray(note.suspectIds)) notes[key] = { type: 'candidates', suspectIds: note.suspectIds.filter((id: unknown): id is string => typeof id === 'string' && parsed.suspects.some((suspect) => suspect.id === id)) };
          }
        }
        return { puzzle: parsed, branchWorkspace: parseBranchWorkspace(saved.branchWorkspace, parsed, { placements, notes }) };
      }
    }
  } catch {
    // A damaged local save should not prevent the app from opening.
  }
  return { puzzle: newPuzzle(), branchWorkspace: newBranchWorkspace() };
}

export default function App() {
  const [initial] = useState(loadCase);
  const [puzzle, setPuzzle] = useState<Puzzle>(initial.puzzle);
  const [branchWorkspace, setBranchWorkspace] = useState<BranchWorkspace>(initial.branchWorkspace);
  const [mode, setMode] = useState<Mode>('edit');
  const [editorTab, setEditorTab] = useState<EditorTab>('setup');
  const [playTab, setPlayTab] = useState<'people' | 'clues' | 'checks'>('clues');
  const [noteTool, setNoteTool] = useState<NoteTool>('candidate');
  const [tool, setTool] = useState<Tool>('room');
  const [selectedRoom, setSelectedRoom] = useState(initial.puzzle.rooms[0]?.id ?? '');
  const [selectedKind, setSelectedKind] = useState(initial.puzzle.objectKinds[0]?.id ?? '');
  const [selectedSuspect, setSelectedSuspect] = useState(initial.puzzle.suspects[0]?.id ?? '');
  const [notice, setNotice] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const drawingPointer = useRef<number | null>(null);
  const paintedCells = useRef(new Set<string>());

  useEffect(() => {
    setBranchWorkspace((current) => {
      const reconciled = reconcileBranches(current, puzzle);
      return JSON.stringify(reconciled) === JSON.stringify(current) ? current : reconciled;
    });
  }, [puzzle]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ puzzle, branchWorkspace } satisfies SavedCase));
      setSaveFailed(false);
    } catch (error) {
      console.warn('Could not save this case on this device.', error);
      setSaveFailed(true);
    }
  }, [puzzle, branchWorkspace]);

  const playable = useMemo(() => new Set(puzzle.playable), [puzzle.playable]);
  const roomByCell = useMemo(() => {
    const byCell = new Map<string, number>();
    puzzle.rooms.forEach((room, index) => room.cells.forEach((key) => byCell.set(key, index)));
    return byCell;
  }, [puzzle.rooms]);
  const roomLabelCells = useMemo(() => new Set(puzzle.rooms.map((room) =>
    [...room.cells].sort((a, b) => {
      const [ar, ac] = coordinates(a);
      const [br, bc] = coordinates(b);
      return ar - br || ac - bc;
    })[0],
  ).filter(Boolean)), [puzzle.rooms]);
  const floorObjectsByCell = useMemo(() => new Map(puzzle.objects.filter((object) => !object.side).map((object) => [object.cell, object])), [puzzle.objects]);
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
  const setupProblems = validatePuzzle(puzzle);
  const playProblems = validatePlacements(puzzle, placements);
  function suspectLetter(id: string): string {
    const index = puzzle.suspects.findIndex((suspect) => suspect.id === id);
    if (index < 0) return '?';
    const initial = puzzle.suspects[index].name.trim().slice(0, 1).toUpperCase() || '?';
    return puzzle.suspects.filter((suspect) => suspect.name.trim().slice(0, 1).toUpperCase() === initial).length > 1
      ? String.fromCharCode(65 + index)
      : initial;
  }

  function markCell(key: Cell) {
    if (!playable.has(key)) return;
    const floor = floorObjectsByCell.get(key);
    if (floor && !kindById.get(floor.kindId)?.canOccupy) return;
    if (noteTool === 'confirmed') {
      if (!selectedSuspect) return;
      setBranchWorkspace((current) => changeDeduction(current, (state) => {
        state.placements = state.placements.some((item) => item.suspectId === selectedSuspect && item.cell === key)
          ? state.placements.filter((item) => item.cell !== key)
          : [...state.placements.filter((item) => item.suspectId !== selectedSuspect && item.cell !== key), { suspectId: selectedSuspect, cell: key }];
        delete state.notes[key];
        return state;
      }));
      return;
    }
    if (noteTool === 'candidate') {
      if (!selectedSuspect) return;
      setBranchWorkspace((current) => changeDeduction(current, (state) => {
        state.placements = state.placements.filter((item) => item.cell !== key);
        const existing = state.notes[key]?.type === 'candidates' ? state.notes[key].suspectIds : [];
        const suspectIds = existing.includes(selectedSuspect) ? existing.filter((id) => id !== selectedSuspect) : [...existing, selectedSuspect];
        if (suspectIds.length) state.notes[key] = { type: 'candidates', suspectIds };
        else delete state.notes[key];
        return state;
      }));
      return;
    }
    setBranchWorkspace((current) => changeDeduction(current, (state) => {
      state.placements = state.placements.filter((item) => item.cell !== key);
      if (noteTool === 'erase' || state.notes[key]?.type === noteTool) delete state.notes[key];
      else state.notes[key] = { type: noteTool };
      return state;
    }));
  }

  function updatePuzzle(next: Puzzle) {
    setPuzzle(next);
    setNotice('');
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
      setPuzzle((current) => placeObject(current, selectedKind, key));
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
          objects: puzzle.objects.filter((object) => object.cell !== key),
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
      updatePuzzle({ ...puzzle, objects: puzzle.objects.filter((object) => object.cell !== key) });
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
    setSelectedSuspect(id);
  }

  function removeSuspect(id: string) {
    updatePuzzle({ ...puzzle, suspects: puzzle.suspects.filter((item) => item.id !== id) });
    if (selectedSuspect === id) setSelectedSuspect(puzzle.suspects.find((item) => item.id !== id)?.id ?? '');
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
      const parsed = parsePuzzle(JSON.parse(await file.text()));
      const problems = validatePuzzle(parsed);
      setPuzzle(parsed);
      setBranchWorkspace(newBranchWorkspace());
      setSelectedRoom(parsed.rooms[0]?.id ?? '');
      setSelectedKind(parsed.objectKinds[0]?.id ?? '');
      setSelectedSuspect(parsed.suspects[0]?.id ?? '');
      setMode('edit');
      setEditorTab('setup');
      setNotice(problems.length ? `Case imported with ${problems.length} item${problems.length === 1 ? '' : 's'} to correct.` : 'Case imported.');
    } catch {
      setNotice('Could not read that puzzle JSON file.');
    }
  }

  function newCase() {
    if (!window.confirm('Replace the current case? Export it first if you want a separate copy.')) return;
    const next = newPuzzle();
    setPuzzle(next);
    setBranchWorkspace(newBranchWorkspace());
    setSelectedRoom(next.rooms[0].id);
    setSelectedKind(next.objectKinds[0].id);
    setSelectedSuspect(next.suspects[0].id);
    setMode('edit');
    setEditorTab('setup');
    setNotice('New case ready.');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">M</span><span>Murdoku <strong>Companion</strong></span></div>
        <div className="save-indicator"><span aria-hidden="true" /> {saveFailed ? 'Could not save on this device — export your case' : 'Saved on this device'}</div>
      </header>

      <main className="main-layout">
        <div className="page-heading">
          <div>
            <p className="eyebrow">MANUAL CASE BUILDER</p>
            <h1>{mode === 'edit' ? 'Build the scene' : puzzle.title}</h1>
            <p className="subtitle">{mode === 'edit' ? 'Build the illustrated scene, then solve on a separate deduction grid.' : 'Use the illustrated map as reference and mark your deductions on the smaller grid.'}</p>
          </div>
          <div className="mode-switch" role="group" aria-label="Mode">
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
                  const connections = floorObject && (['N', 'E', 'S', 'W'] as const).filter((side) => {
                    const adjacent = side === 'N' ? cell(row - 1, col) : side === 'S' ? cell(row + 1, col) : side === 'E' ? cell(row, col + 1) : cell(row, col - 1);
                    return floorObjectsByCell.get(adjacent)?.kindId === floorObject.kindId;
                  });
                  const wallObjects = wallObjectsByCell.get(key) ?? [];
                  const selected = mode === 'edit' && tool === 'room' && room?.id === selectedRoom;
                  const tileStyle = isPlayable && roomIndex !== undefined ? {
                    backgroundColor: ROOM_COLORS[roomIndex % ROOM_COLORS.length],
                    borderTopWidth: row === 0 || roomByCell.get(cell(row - 1, col)) !== roomIndex ? 3 : 1,
                    borderLeftWidth: col === 0 || roomByCell.get(cell(row, col - 1)) !== roomIndex ? 3 : 1,
                  } : undefined;
                  return <div
                    key={key}
                    data-cell={key}
                    className={`cell ${isPlayable ? '' : 'outside'} ${selected ? 'room-selected' : ''} ${floorKind && !floorKind.canOccupy ? 'blocked-cell' : ''} ${floorKind?.art === 'table' || floorKind?.art === 'carpet' ? 'tile-board-cell' : ''}`}
                    role={mode === 'edit' ? 'button' : undefined}
                    tabIndex={mode === 'edit' ? 0 : undefined}
                    style={tileStyle}
                    onClick={(event) => { if (mode === 'edit' && (tool === 'room' || tool === 'object') && event.detail > 0) return; handleCell(key); }}
                    aria-label={`Row ${row + 1}, column ${col + 1}${!isPlayable ? ', outside map' : ''}${room ? `, ${room.name}` : ''}${floorKind ? `, ${floorKind.name}` : ''}${wallObjects.length ? `, ${wallObjects.map((object) => `${kindById.get(object.kindId)?.name ?? 'Object'} on ${object.side} wall`).join(', ')}` : ''}`}
                    aria-pressed={mode === 'edit' && tool === 'room' ? selected : undefined}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleCell(key); } }}
                  >
                    {isPlayable && <>
                      {room && roomLabelCells.has(key) && <span className="cell-room">{room.name}</span>}
                      {floorKind && <span className={`cell-object ${floorKind.art === 'table' || floorKind.art === 'carpet' ? 'tile-cell-object' : ''}`} title={floorKind.name}><ObjectMark kind={floorKind} connections={connections} /></span>}
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
              <div className="deduction-heading"><div><p className="eyebrow">DEDUCTION GRID</p><h2>Your notes</h2></div><span className="dimension-badge">{placements.length} confirmed</span></div>
              <div className="branch-panel" aria-label="Hypotheses">
                <div className="branch-heading"><strong>Hypotheses</strong><span>{branchWorkspace.checkpoint ? branchWorkspace.checkpoint.name : 'Save a point to try different ideas'}</span></div>
                <div className="branch-list" role="group" aria-label="Choose hypothesis">{branchWorkspace.branches.map((branch) => <button key={branch.id} type="button" className={branchWorkspace.activeId === branch.id ? 'selected' : ''} aria-pressed={branchWorkspace.activeId === branch.id} onClick={() => setBranchWorkspace((current) => switchHypothesis(current, branch.id))}>{branch.name}</button>)}</div>
                {activeBranch.id !== 'main' && <label className="branch-name">Branch name<input aria-label="Branch name" value={activeBranch.name} onChange={(event) => setBranchWorkspace((current) => renameHypothesis(current, activeBranch.id, event.target.value))} /></label>}
                <div className="branch-actions">
                  <button type="button" onClick={() => setBranchWorkspace(saveCheckpoint)}>Save checkpoint</button>
                  <button type="button" onClick={() => setBranchWorkspace(createHypothesis)}>+ New hypothesis</button>
                  {branchWorkspace.checkpoint && <button type="button" onClick={() => setBranchWorkspace(restoreCheckpoint)}>Restore checkpoint</button>}
                </div>
                {activeBranch.id !== 'main' && <div className="branch-actions branch-outcomes"><button type="button" onClick={() => setBranchWorkspace(applyHypothesisToMain)}>Apply to Main</button><button type="button" onClick={() => setBranchWorkspace(discardHypothesis)}>Discard hypothesis</button></div>}
                <div className="history-actions"><button type="button" disabled={!activeBranch.undo.length} onClick={() => setBranchWorkspace(undoDeduction)}>↶ Undo</button><button type="button" disabled={!activeBranch.redo.length} onClick={() => setBranchWorkspace(redoDeduction)}>↷ Redo</button><button type="button" onClick={() => setBranchWorkspace((current) => changeDeduction(current, () => ({ placements: [], notes: {} })))}>Reset notes</button></div>
              </div>
              <p className="hint">Choose a mark, then tap the smaller grid. Tap a mark again to remove it.</p>
              <div className="note-tools" role="group" aria-label="Deduction mark">
                {([['candidate', 'Pencil letters'], ['confirmed', 'Confirmed'], ['empty', 'Empty X'], ['blocked', 'Blocked /'], ['erase', 'Erase']] as const).map(([value, label]) => <button key={value} type="button" className={noteTool === value ? 'selected' : ''} onClick={() => setNoteTool(value)}>{label}</button>)}
              </div>
              {(noteTool === 'candidate' || noteTool === 'confirmed') && <div className="note-people" role="group" aria-label="Choose person">{puzzle.suspects.map((suspect) => <button key={suspect.id} type="button" title={suspect.name} className={selectedSuspect === suspect.id ? 'selected' : ''} onClick={() => setSelectedSuspect(suspect.id)}>{suspectLetter(suspect.id)} <span>{suspect.name}</span></button>)}</div>}
              <div className="deduction-scroll"><div className="deduction-grid" style={{ gridTemplateColumns: `repeat(${puzzle.cols}, 38px)` }}>{Array.from({ length: puzzle.rows * puzzle.cols }, (_, index) => {
                const row = Math.floor(index / puzzle.cols);
                const col = index % puzzle.cols;
                const key = cell(row, col);
                const isPlayable = playable.has(key);
                const roomIndex = roomByCell.get(key);
                const floor = floorObjectsByCell.get(key);
                const fixedBlocked = !!floor && !kindById.get(floor.kindId)?.canOccupy;
                const note = notes[key];
                const placement = placementsByCell.get(key);
                const confirmed = puzzle.suspects.find((suspect) => suspect.id === placement?.suspectId);
                const candidates = note?.type === 'candidates' ? note.suspectIds.map((id) => suspectLetter(id).toLowerCase()).join('') : '';
                const mark = fixedBlocked || note?.type === 'blocked' ? '' : note?.type === 'empty' ? 'X' : confirmed ? suspectLetter(confirmed.id) : candidates;
                return <button key={key} type="button" className={`deduction-cell ${!isPlayable ? 'outside' : ''} ${fixedBlocked || note?.type === 'blocked' ? 'slash' : ''} ${confirmed ? 'confirmed' : ''} ${candidates ? 'candidates' : ''}`} style={isPlayable && roomIndex !== undefined ? { backgroundColor: ROOM_COLORS[roomIndex % ROOM_COLORS.length], borderTopWidth: row === 0 || roomByCell.get(cell(row - 1, col)) !== roomIndex ? 2 : 1, borderLeftWidth: col === 0 || roomByCell.get(cell(row, col - 1)) !== roomIndex ? 2 : 1 } : undefined} disabled={!isPlayable || fixedBlocked} onClick={() => markCell(key)} aria-label={`Row ${row + 1}, column ${col + 1}: ${!isPlayable ? 'outside map' : fixedBlocked ? 'blocked by furniture' : confirmed ? `confirmed ${confirmed.name}` : note?.type === 'candidates' ? `possible ${note.suspectIds.map((id) => puzzle.suspects.find((suspect) => suspect.id === id)?.name).join(', ')}` : note?.type === 'empty' ? 'empty' : note?.type === 'blocked' ? 'marked blocked' : 'unmarked'}`}>{mark}</button>;
              })}</div></div>
            </section>}
          </section>

          <aside className="sidebar">
            {mode === 'edit' ? <>
              <nav className="sidebar-tabs" aria-label="Case builder steps">{([['setup', 'Setup'], ['rooms', 'Rooms'], ['furniture', 'Furniture'], ['people', 'People & clues'], ['rules', 'Rules']] as const).map(([value, label]) => <button key={value} type="button" className={editorTab === value ? 'active' : ''} aria-current={editorTab === value ? 'step' : undefined} onClick={() => { setEditorTab(value); if (value === 'rooms') setTool('room'); if (value === 'furniture') setTool('object'); }}>{label}</button>)}</nav>
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
              </section>}

              {editorTab === 'people' && <section className="card">
                <div className="card-title"><h2>People & clues</h2></div>
                {puzzle.suspects.map((suspect, index) => <div className="person-editor" key={suspect.id}>
                  <div className="person-header"><span className="person-number">{index + 1}</span><input aria-label={`Person ${index + 1} name`} value={suspect.name} onChange={(event) => updatePuzzle({ ...puzzle, suspects: puzzle.suspects.map((item) => item.id === suspect.id ? { ...item, name: event.target.value } : item) })} /><button type="button" className="icon-button" aria-label={`Remove ${suspect.name}`} onClick={() => removeSuspect(suspect.id)}>×</button></div>
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
              <nav className="sidebar-tabs play-tabs" aria-label="Play case panels">{([['clues', 'Clues'], ['people', 'People'], ['checks', 'Checks']] as const).map(([value, label]) => <button key={value} type="button" className={playTab === value ? 'active' : ''} onClick={() => setPlayTab(value)}>{label}</button>)}</nav>
              {playTab === 'people' && <section className="card"><div className="card-title"><h2>People</h2></div><p className="hint">Choose a person by the deduction grid to mark candidates or confirm a position.</p><div className="suspect-list">{puzzle.suspects.map((suspect) => {
                const placed = placements.find((item) => item.suspectId === suspect.id);
                return <div className="suspect-item" key={suspect.id}><button type="button" className={selectedSuspect === suspect.id ? 'selected' : ''} onClick={() => { setSelectedSuspect(suspect.id); setNoteTool('candidate'); }}><span className="suspect-avatar">{suspectLetter(suspect.id)}</span><span><strong>{suspect.name}</strong><small>{placed ? `Row ${coordinates(placed.cell)[0] + 1}, column ${coordinates(placed.cell)[1] + 1}` : 'Not placed'}</small></span></button>{placed && <button type="button" className="icon-button" aria-label={`Remove ${suspect.name} from board`} onClick={() => setBranchWorkspace((current) => changeDeduction(current, (state) => ({ ...state, placements: state.placements.filter((item) => item.suspectId !== suspect.id) })))}>×</button>}</div>;
              })}</div></section>}
              {playTab === 'clues' && <section className="card"><div className="card-title"><h2>Clues</h2></div>{puzzle.caseClues.filter(Boolean).map((clue, index) => <p className="clue" key={index}>{clue}</p>)}{puzzle.suspects.filter((suspect) => suspect.clue.trim()).map((suspect) => <p className="clue" key={suspect.id}><strong>{suspect.name}:</strong> {suspect.clue}</p>)}{!puzzle.caseClues.some(Boolean) && !puzzle.suspects.some((suspect) => suspect.clue.trim()) && <p className="empty-note">No clues entered yet.</p>}</section>}
              {playTab === 'checks' && playProblems.length > 0 && <section className="card issue-card" role="status"><h2>Check these placements</h2><ul>{playProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></section>}
              {playTab === 'checks' && playProblems.length === 0 && <section className="card good-card"><strong>No placement conflicts</strong><p>Clue text is for manual deduction in this first version.</p></section>}
              <button type="button" className="text-button back-button" onClick={() => setMode('edit')}>← Edit this case</button>
            </>}
          </aside>
        </div>
      </main>
    </div>
  );
}
