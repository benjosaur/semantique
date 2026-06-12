# Targets checklist UI

Replace the single `target: happy` with a checklist of all emotions at the top.
Each round's win checks off the emotion the judge picked; checks persist across
rounds ("hop again"). A round only "wins" if it lands a *new* (unchecked) emotion.

## Plan

- [x] `level.py`: `"target": "happy"` → `"targets": [happy, sad, angry, scared]`
- [x] `judge.py`: payload takes `targets` (remaining unchecked); verdict = win if winner ∈ targets
- [x] `static/game.html`: HUD target span → targets checklist markup
- [x] `static/style.css`: checklist item styles + checked state (green ✓, strike, faded)
- [x] `static/game.js`:
  - [x] build checklist items from `level.targets`, keep `checked` Set across resets
  - [x] submit sends remaining targets; bar highlight = unchecked targets
  - [x] on win: animate check-off after the stamp; "happy, again." stamp when winner already checked
  - [x] all-collected hint on reset
- [x] tests: `test_level.py` targets assertion
- [x] `README.md`: update the two target lines
- [x] verify: pytest + JUDGE_FAKE=1 Playwright run

## Review

- 13 fast tests pass. Played in-browser (fake judge, port 7866 — 7860-65 were
  other worktrees' servers): win "not sad" → happy checked after the stamp;
  "hop again" keeps the check; replaying the same sentence stamps
  "happy, again." (no win) and the verdict bars highlight only the remaining
  three; second win ("very fast annoy!" → sad) checks a second item.
- Server contract change: judge payload is `targets` (list of still-unchecked
  emotions) instead of `target`; verdict = win iff winner ∈ targets. Checked
  state lives client-side, so a full collect-them-all run is one page session.
