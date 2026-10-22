# Murdoku Companion

A manual-first companion for building and playing deduction puzzle maps. The same versioned puzzle JSON can later be filled by an image parser and corrected in the editor.

## Run locally

```sh
npm install
npm run dev
```

The dev server uses port 5180, matching the local Dev Dashboard registration. Run `npm test` for puzzle-rule tests and `npm run build` to check the production bundle.

## Current features

- Draw an irregular grid, tap or drag to paint rooms, and place default or custom object types.
- Choose artwork and occupancy per object type. Chair, bed, desk, TV, and plant use illustrated PNGs; adjacent table or carpet cells join into one surface. Wall objects use bars on clickable edges; windows are limited to outside walls and leave the cell open.
- Work through named setup tabs to enter people, clues, and explicit empty row, column, or room counts.
- Play against the illustrated reference map using a separate compact deduction grid. Mark empty cells with X, blocked cells with a diagonal line, confirmed people with capital letters, and multiple candidates with lowercase letters. Blocking furniture is marked automatically.
- See basic conflicts for confirmed placements.
- Autosave the case and deduction marks in this browser; export and import the versioned puzzle definition as JSON.

Photo scanning, AI parsing, automatic clue interpretation, branching hypotheses, and a multi-case library are later steps. Older puzzle JSON and browser saves are upgraded when loaded.
