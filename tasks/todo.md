# Board 3 — "subjects" with the wings flight mechanic

## Decisions (from user)
- Targets/labels = academic subjects: maths, science, philosophy, economics,
  literature, languages, art, music.
- Blank cell (2,3) = start. The two `enter` tiles = `⏎` submit (carriage return).
- Gliding is FREE: airborne mid-flight hops add no word and cost no budget.
- Wings flight: land on `[wings]` → rise + flap. Next two hops glide free
  (airborne). The third hop descends and lands for real (typically onto `⏎`).

## Tasks
- [x] Explore game.js mechanics (tiles, doodle, hop/land, submit, state)
- [x] levels/subjects.py (order=2, after animal=1)
- [x] game.js: `appendsWord` excludes "wings"
- [x] game.js: wings keycap icon + drawTileCanvas branch
- [x] game.js: doodle "fly" pose + wings drawing + slow flap timer
- [x] game.js: flight state (flightLeft, CRUISE) + resetFlight
- [x] game.js: takeOff() / glideTo() + hopTo branch + land() flight handling
- [x] game.js: reset hooks (resetGameState, die, loadLevel, swap)
- [x] game.js: takeoff/flap sfx
- [x] Restart server, verify with Playwright (renders, fly 2 + descend, submit)

## Review
- New board renders: 8 subject targets in the HUD, start at (2,3), two `⏎`
  submit keys, two accent wings tiles — 0 console errors.
- Flight verified end-to-end: hop onto a `[wings]` tile → doodle sprouts wings
  and rises to cruise (HUD stayed `2/12`, the wings tile added no word) →
  two glides stayed airborne and FREE (no word, budget held at 2/12) → the
  third hop descended onto the `⏎` and fired submit (cost one hop → `3/12`).
- Regression: a normal non-wings hop still appends its word and leaves the
  doodle grounded in the idle pose — flight state doesn't leak.
- The "judge dozed off" verdict is expected offline (judge needs Modal creds,
  same as every board; the old `JUDGE_FAKE` stub no longer exists).
- Mechanic shape: wings = a clean exit. Lock in the sentence you've written,
  then glide over the remaining keys to a submit button without typing them.

## How to play it normally
- subjects is board 3 (`order=2`), reached via the forward swap after clearing
  the animal board. Boot board is still emotion.
