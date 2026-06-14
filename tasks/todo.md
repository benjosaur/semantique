# Board 4 — "countries" with the shift / column-shuffle mechanic

## Decisions (from user + my defaults)
- Board 4, `order=3`, reached after subjects (`order=2`).
- Targets/labels = countries: USA, Russia, Italy, France, India, China, Korea,
  England.
- Grid (5×5). Row 0 = four shift tiles + a blank `start` in the middle; rows 1–3
  are word tiles; row 4 is all `enter` (`⏎` submit).
- The user's `[swap]` tile is implemented as the reserved grid word **`"shift"`**
  — renamed from "swap" so it doesn't collide with the existing board-navigation
  "swap tiles" (the off-edge arrow keys). Icon = two stacked `⇨` arrows.
- **Mechanic:** hop onto a `shift` tile → every row UNDER the first row rotates
  its columns one to the RIGHT; the rightmost column of each row wraps around and
  becomes the leftmost, arcing up-and-over to its new home. Animated.
- Landing on a shift tile costs one budget hop (consistent with `wings`/every
  land); it appends no word.
- The shuffle persists across "hop again"/retry; it resets only on board (re)load
  (buildTiles rebuilds canonically from `level.grid`, which is never mutated).
- budget = 14 (tunable; shifts cost hops so a 5×5 gets a touch more than 12).

## Tasks
- [x] Explore game.js mechanics (tiles, hop/land, swap-nav tiles, sfx, reset)
- [x] levels/countries.py (order=3, after subjects=2)
- [x] game.js: `appendsWord` excludes "shift"
- [x] game.js: `drawShiftKeyIcon` (two stacked ⇨) + drawTileCanvas branch
- [x] game.js: `shiftColumns()` — rotate rows 1.. right, wrap arcs over, re-sort
      `tiles`; kill stale tile tweens in buildTiles
- [x] game.js: land() branch `if (word === "shift") return doShift()`
- [x] game.js: `sfx.shuffle()` slide/whoosh
- [x] Restart server, verify with Playwright (renders; shift rotates rows 1–3,
      wrap animates; row 0 fixed; no console errors)

## Review
- Board renders: 8 country targets (USA…England), doodle on the top-middle
  `start`, four shift tiles each stamped with **two stacked accent ⇨** arrows,
  three word rows, a dashed `⏎` submit row — 0 console errors.
- Shift verified end-to-end (booted countries as home for the test, reverted):
  four successive hops onto shift tiles each rotated rows 1–3 one column to the
  RIGHT, compounding exactly (canonical → `very·not·big·small·somewhat` →
  `somewhat·very·not·big·small` → `small·…·big` → `big·…·not`); the rightmost
  column wrapped to leftmost each time, and the top row (shift tiles + start)
  never moved. Each shift cost one budget hop (counter ticked 1→2→3→4 / 14).
- Wrap ARC proven by sampling the cap's mesh during a shift: the rightmost cap
  travels x +3 → −3 while its y lifts from rest (−0.21) to a peak of +0.64
  (lift = SHIFT_LIFT 0.85) at board centre, then sets down at the leftmost slot
  — it sails up-and-OVER the caps sliding right beneath it, not through them.
- The shuffle lives only in mesh positions + each tile's `col`; `level.grid` is
  never mutated, so a board (re)load restores the canonical layout for free.
- Regression: with the real config restored (home=emotion, order
  emotion→animal→subjects→countries), the boot board renders with 0 errors.
- Naming: the user's `[swap]` tile is the reserved grid word **`"shift"`** —
  renamed so it doesn't collide with the existing off-edge board-navigation
  "swap tiles". budget=14 is tunable (each shuffle costs a hop).
- Offline note: submitting still shows "judge dozed off" (judge needs Modal
  creds) — same as every board; layout/animation needs no secrets.
