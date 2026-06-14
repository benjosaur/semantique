---
title: Semantique
emoji: 🐇
colorFrom: gray
colorTo: gray
sdk: gradio
sdk_version: 6.17.3
app_file: app.py
pinned: false
license: mit
short_description: Can you get AI to guess all the words?
thumbnail: https://huggingface.co/spaces/benjosaur/semantique/resolve/main/static/social-card.png
tags:
  - buildsmall
  - thousand-token-wood
  - off-brand
  - tiny-titan
  - modal
---

# Semantique 🐇

**Can you get AI to guess all the words?** Hop your doodle across a grid of word tiles
with the arrow keys. Every tile you land on appends its word to your sentence —
and uses up one hop. Reach `⏎` and a small open LLM
judges what emotion your sentence expresses. Check off every target emotion
on the list to collect them all.

The judge uses **structured output via exact logprob filtering**: a system prompt
names the board's targets and asks for the one most similar to your sentence, and a
single forward pass on a self-hosted open model scores how likely each candidate
label is as the answer. The next-token distribution is masked to the board's labels
and softmax-renormalized — constrained decoding made visible as the verdict card's
probability bars.

> Try it: for **happy**, `start → not → sad → ⏎` works.
> So does `great → !`. The geometry is the puzzle — word order is path order.

Built for the **Build Small Hackathon** (Thousand Token Wood track).

## How it works

- **One `gr.HTML` component is the whole game** — Gradio 6's `html_template` /
  `css_template` / `js_on_load`, with three.js (ESM, CDN) rendering the board
  and GSAP driving the hops. No build step.
- **Hand-drawn everything**: tiles are offscreen-canvas drawings (jittered
  double-stroke ink, Patrick Hand lettering) used as `CanvasTexture`s, re-drawn
  ~3×/s for a living "sketch boil". The character is a billboarded doodle with
  procedural idle/hop/think frames.
- **The AI is load-bearing**: `judge.py` builds the prompt and POSTs it to a
  **Modal GPU endpoint** (`modal_judge.py`) that runs one forward pass and reads
  the *exact* probability of each candidate label — its whole token sequence scored
  by the model, not just whatever lands in a hosted API's top-k. The label logprobs
  are masked and renormalized; argmax decides the verdict, the full distribution
  feeds the UI. No top-20 cap, no missing-label fudge factor.
- **Model**: `openbmb/MiniCPM3-4B` (open weights, ≤4B → Tiny Titan), self-hosted
  on Modal. Swap it with the `MODEL_ID` in `modal_judge.py`.

## Levels

Boards live in `levels/`, one self-contained file each. A level declares its
grid and its candidate `labels` — and that's it; the judge prompt (`sentence =`)
is universal, so the label set alone makes the answer an emotion on one board
and an animal on another. To add one, drop a `levels/<name>.py` that defines
`LEVEL = Level(...)`; it's auto-discovered and registered (`order` sets play
order, `home` flags the boot board). In the grid, `"start"` is the home tile,
`""` an empty walkable tile, and `"="` a submit tile (a board can have several).
Players walk between boards with the hand-drawn arrows once they've collected a
target.

## Run locally

```bash
uv venv && uv pip install -r requirements-dev.txt
cp .env.example .env           # fill in MODAL_JUDGE_URL + MODAL_KEY/MODAL_SECRET
python app.py                  # http://127.0.0.1:7860
```

## Run on Modal (the GPU judge)

The judge model is self-hosted on [Modal](https://modal.com) — serverless GPU,
scale-to-zero, so it costs ~nothing while nobody's playing.

```bash
pip install modal && modal setup        # one-time auth
modal serve modal_judge.py              # dev: hot-reload, prints a temporary URL
modal deploy modal_judge.py             # prod: stable URL
```

`modal_judge.py` loads `openbmb/MiniCPM3-4B` on an L4, with the weights baked into
the container image (pinned revision, loaded offline) and the CPU-loaded model
captured in a memory snapshot to keep cold starts to a few seconds. The endpoint
takes `{"messages", "labels"}` (the prompt is built in `judge.py`) and returns
exact per-label logprobs.

Protect it with a **proxy-auth token** (Modal dashboard → Settings → Proxy Auth
Tokens) and put the URL + token in `.env` (local) or the Space secrets (deploy):
`MODAL_JUDGE_URL`, `MODAL_KEY`, `MODAL_SECRET`.

Smoke-test it: `modal run modal_judge.py --sentence "not sad"` or
`python scripts/check_modal.py`.

### Best Use of Modal

Modal is the **runtime for the load-bearing AI**: every verdict is a live GPU
forward pass on Modal, not a hosted-API call. Going self-hosted is what unlocks
reading the *full* next-token distribution — we score each emotion word's entire
token sequence and renormalize over exact logprobs, instead of being capped at a
provider's top-20. Scale-to-zero + image-baked weights + memory snapshots keep
it cheap and fast.

## Deploy as a (private) HF Space

1. `pip install -U "huggingface_hub[cli]"` and `hf auth login` (write token).
2. Create the Space (private while you iterate):

   ```bash
   hf repo create semantique --repo-type space --space-sdk gradio --private
   ```

3. Add secrets so the Space can call the Modal judge: Space → **Settings →
   Variables and secrets** → add `MODAL_JUDGE_URL`, `MODAL_KEY`, `MODAL_SECRET`
   (from `modal deploy` + a Modal proxy-auth token). Never commit tokens.
4. Push the code:

   ```bash
   hf upload <your-username>/semantique . . --repo-type space \
     --exclude ".env" --exclude ".venv/*" --exclude ".playwright-mcp/*"
   ```

   (or `git remote add space https://huggingface.co/spaces/<you>/semantique
   && git push space main`). Each push redeploys.
5. Open the Space and hop. At submission time, duplicate/transfer it into the
   [BuildSmall org](https://huggingface.co/BuildSmall), flip it public, and
   check the YAML tags above match the track/badges you're entering.

_Demo video and social post links to be added at submission (REQ-03/04)._
