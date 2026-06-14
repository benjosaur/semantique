# Portal tiles on board 2 (animal)

Add `[portal]` tiles to the animal board (board 2). Each portal links to the
**next portal clockwise**; stepping onto one whisks the doodle there: it shrinks
and screws *into* the source spiral, then expands *out of* the destination one.
Portals render as hand-drawn ink **spirals that spin** on the keycap.

## Layout (user-supplied — replaces the current animal grid)

```
⏎       portal  ouch     cylinder ⏎
flying  fur     loud     puppy    ?
love    not     start    sea      portal
small   hate    wings    quiet    big
⏎       portal  frolick  grass    ⏎
```

`enter` → `⏎`, blank centre → `start`, `[portal]` → reserved word `"portal"`.
Three portals at (0,1) top, (2,4) right, (4,1) bottom. Clockwise links:
top → right → bottom → top.

## Plan

- [x] `levels/_base.py`: document the new reserved `"portal"` value
- [x] `levels/animal.py`: swap in the new grid (portals + corner ⏎ + word edits)
- [x] `static/game.js`:
  - [x] `appendsWord` + `drawTileCanvas`: treat `"portal"` as structural/blank
  - [x] shared spiral geometry/texture/material; `drawSpiralCanvas()` ink spiral
  - [x] `buildTiles`: attach a spinning spiral child mesh to each portal keycap
  - [x] `buildPortalLinks()`: clockwise dest map from the grid (angle sort)
  - [x] render loop: spin every portal spiral
  - [x] `land()`: portal branch → `portalWarp()`; factor tail into `settleIdle()`
  - [x] `portalWarp()`: shrink+spin into source, teleport, expand+unspin from dest
  - [x] `sfx.warp()`: a swirl whoosh on the warp
- [x] `CLAUDE.md`: add a `portal` terminology entry
- [x] verify: drive with Playwright — spirals spin, stepping a portal teleports
      clockwise with shrink/expand, no console errors

## Review

- Board 2 (animal, `order=1`) carries three `"portal"` tiles at (0,1) top,
  (2,4) right, (4,1) bottom, drawn as hand-drawn ink+accent spirals on wordless
  keycaps. Layout matches the user's table verbatim.
- Each portal links to the next **clockwise**, computed from the grid by angle
  around the centre (`buildPortalLinks`): top→right→bottom→top. All three links
  exercised live in the browser.
- Stepping onto a portal: the doodle shrinks + screws *into* the source spiral,
  vanishes, then expands + unwinds *out of* the destination (`portalWarp`), with
  a swirl SFX. The landing hop costs budget; no word is appended.
- Spirals spin continuously in the render loop (mesh spin, no texture redraw).
- Rebased onto #41 (the wings board). #41 reserved the word `"wings"` for its
  flight launchpad, which collided with the literal `"wings"` word at animal
  (3,2) — resolved by renaming that cell to `"winged"` (per user), so the animal
  board stays portal-only and the word still hints at winged critters.
