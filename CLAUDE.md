# Semantique — agent orientation

A prompt-hopping word puzzle. You hop a doodle across a grid of word **tiles**;
each tile appends its word to a sentence, and a small self-hosted LLM **judge**
scores which **target** emotion/animal the sentence reads as. Collect every
target on a board to clear it. See `README.md` for the player-facing pitch,
hackathon framing, and full deploy steps — this file is the map for working in
the code.

## Architecture in one breath

The entire game is **one `gr.HTML` component** (`app.py`) — Gradio 6 stitches
three static files into that component and hides all other Gradio chrome:

- `static/game.html` — the DOM skeleton (`html_template`)
- `static/style.css` — all styling (`css_template`)
- `static/game.js` — the whole game: three.js board, GSAP hops, HUD, audio,
  camera framing, verdict overlay (`js_on_load`)

The board renders **100% client-side** — three.js (ESM from CDN) draws tiles as
hand-drawn `CanvasTexture` keycaps. The only server call is the judge.

## Key files

| Path | What it is |
| --- | --- |
| `app.py` | Gradio wrapper: builds the `GAME` payload, mounts the `gr.HTML`, wires `judge` as a `server_function`. |
| `static/game.js` | ~1.7k lines: scene setup, tile/keycap drawing, character doodle, swap tiles, HUD, audio mixer, `resize()`/`reframe()` camera framing, judge call + verdict card. |
| `static/style.css` | Paper-and-ink theme; the phone layout lives in the `@media (max-width: 560px), (max-height: 540px)` block at the bottom. |
| `levels/*.py` | One board per file, auto-discovered. `Level(...)` dataclass in `levels/_base.py`. `emotion.py` is `home` (4×4, 8 targets); `animal.py` (5×5, 10 targets). |
| `judge.py` | Builds the judge prompt and POSTs the assembled sentence to the Modal endpoint. |
| `modal_judge.py` | The self-hosted GPU judge (MiniCPM3-4B on Modal): exact per-label logprobs. Auto-deployed on push to `main` via `.github/workflows/deploy-modal.yml`. |

## Terminology

- **board / level** — one grid (a `Level`). Boards are swapped client-side.
- **tile** — a grid cell. Reserved words: `"start"` (home, blank), `""` (walkable
  blank), `"⏎"` (submit — hopping onto it sends the sentence to the judge),
  `"portal"` (a spinning-spiral teleport — see below).
- **portal** — a wordless tile rendered as a spinning ink spiral (a flat disc
  child of the keycap, spun in the render loop). Hopping onto one whisks the
  doodle to the next portal **clockwise** around the board centre: it shrinks
  into the source spiral and expands out of the destination (`portalWarp` in
  `game.js`; links computed by `buildPortalLinks`). The animal board (board 2)
  has three. The landing hop costs budget; the teleport adds no word.
- **target** — a goal word to collect, shown as the wrapping checklist chips in
  the HUD (`.sq-target-list`). Checks persist per board.
- **swap tile** — hand-drawn arrow keys at a board's edge that walk you to the
  next/previous board (revealed once you've collected a target).
- **judge** — the LLM that scores the sentence against the board's candidate
  `labels` and returns the verdict + probability bars.

## Run & verify locally

```bash
.venv/bin/python app.py        # serve the app (a worktree .venv is set up)
```

- The **board renders without any Modal creds** — only *submitting a sentence*
  (the judge) needs `.env` (`MODAL_JUDGE_URL`, `MODAL_KEY`, `MODAL_SECRET`). So
  layout/visual work needs no secrets.
- For headless verification, launch on a dedicated port with the sandbox off
  (`GRADIO_SERVER_PORT=7899 nohup .venv/bin/python app.py &`) and drive it with
  Playwright. Avoid the default 7860 (other worktrees may serve stale HTML there).

## Gotchas

- **Static files are inlined at server start** (`app.py` reads them via
  `read_text()`), so **restart the app after editing `static/*`** — a browser
  refresh alone won't pick up changes.
- **HF Spaces runs inside an iframe-resizer iframe**: `100dvh` feeds back and
  runs away, so `game.js` pins the root to a fixed pixel height when embedded.
  Test embedded (the Space), not just localhost, for layout regressions.
- **Binary assets need git-LFS** for the HF Space to accept them.
