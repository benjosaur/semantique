# Modular levels API + the animal board

Add a second level (animals) and make adding levels a clean, drop-in API. Each
level carries its own grid **and** its own judge spec (category + few-shot), so
the judge is no longer emotion-hardcoded. Two boards, switchable in-browser.

## Level interpretation (from the mockup)

5×5, no walls. Center = start (blank). Four corners = `⏎` submit tiles. The
other blanks are walkable **empty** tiles that add no word (a free repositioning
hop). Targets are the ten animals; the word tiles hint at them.

## Plan

- [x] `levels/_base.py`: `Level` dataclass (grid/start/targets/labels/budget +
      category/few_shot/question/order/home), `client_value()`, `question_for()`
- [x] `levels/__init__.py`: registry + auto-discovery (drop a file = a level),
      `get_level`, `LEVELS`, `LEVEL_ORDER`, `HOME_ID`
- [x] `levels/emotion.py`: the existing board, moved verbatim + its judge spec
- [x] `levels/animal.py`: the new board
- [x] delete `level.py`
- [x] `judge.py`: `score_labels(sentence, level)`, `judge` resolves level by id
- [x] `app.py`: ship all levels + home/order to the component
- [x] `static/game.js`:
  - [x] empty `""` tiles: walkable, blank, append nothing
  - [x] factor board build into `buildTiles()` / `buildTargets()` / `loadLevel()`
  - [x] per-level `checkedByLevel` so progress persists across switches
  - [x] judge payload sends `level_id` (server owns labels/few-shot)
  - [x] hand-drawn nav arrows: next (↘, after 1 target collected) + back (↙)
  - [x] camera reframes for the bigger 5×5 board
- [x] `static/game.html` + `style.css`: nav button markup + ink-arrow styles
- [x] tests: split level tests per-board; keep emotion solution paths; add
      animal solvability; point the slow judge test at the level
- [x] `README.md`: short "Levels" section on the drop-in API
- [x] verify: `pytest -m "not slow"` + JUDGE_FAKE browser run of both boards

## Review

- 25 fast tests pass (was 13 + judge units; now generic per-board invariants
  over every level, emotion's documented win paths, animal solvability/empty
  tiles, registry order/home).
- Browser run (fake judge, port 7871, both 1516 + 1200 viewports), 0 console
  errors: home emotion board unchanged; win "great!" → happy checked; the
  "critters →" arrow unlocks bottom-right only after the first checkoff; click
  switches to the 5×5 animal board (center start, four ⏎ corners, walkable ""
  tiles, 10 targets, budget 12); "sea puppy?" judged with `level_id: animal`
  (10-label verdict card); "← feelings" arrow returns home with checks intact.
- Adding a board is now one file: `levels/<name>.py` with `LEVEL = Level(...)`,
  auto-discovered. The judge is category-agnostic — each board carries its own
  few-shot + labels, resolved server-side from the `level_id` the client sends.
- HUD tightened: 10 target chips were wrapping/colliding with the title at
  1200px; smaller chips + a HUD gap keep them on one line.
- Note: the offline `JUDGE_FAKE` stub just favours the first uncollected
  target, so every fake submit "wins" — real judging needs an HF token.
