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
tags:
  - buildsmall
  - thousand-token-wood
  - off-brand
  - tiny-titan
---

# Semantique 🐇

**A prompt-hopping puzzle game.** Hop your doodle across a grid of word tiles
with the arrow keys. Every tile you land on appends its word to your sentence —
and uses up one hop. Reach `⏎` and a small open LLM
judges what emotion your sentence expresses. Check off every target emotion
on the list to collect them all.

The judge uses **structured output via logprob filtering**: one
chat-completion call with `max_tokens=1`, the next-token distribution is
masked to the allowed emotion labels and softmax-renormalized — constrained
decoding made visible as the verdict card's probability bars.

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
- **The AI is load-bearing**: `judge.py` calls the judge model via
  `huggingface_hub.InferenceClient` (HF Inference Providers), reads the top-20
  logprobs of the first answer token, masks to `happy/sad/angry/scared`, and
  renormalizes. Argmax decides the verdict; the full distribution feeds the UI.
- **Model**: `Qwen/Qwen3-4B-Instruct-2507` (≤4B → Tiny Titan), override with
  the `JUDGE_MODEL` env var.

## Levels

Boards live in `levels/`, one self-contained file each. A level declares its
grid **and** its judge spec — the `category` to identify plus a few few-shot
`(example, answer)` pairs — so the same logprob judge scores emotions, animals,
or whatever a board asks for. To add one, drop a `levels/<name>.py` that defines
`LEVEL = Level(...)`; it's auto-discovered and registered (`order` sets play
order, `home` flags the boot board). In the grid, `"start"` is the home tile,
`""` an empty walkable tile, and `"⏎"` a submit tile (a board can have several).
Players walk between boards with the hand-drawn arrows once they've collected a
target.

## Run locally

```bash
uv venv && uv pip install -r requirements-dev.txt
echo "HF_TOKEN=hf_..." > .env  # any valid HF token (or use `hf auth login`)
python app.py                  # http://127.0.0.1:7860
```

No token handy? `JUDGE_FAKE=1 python app.py` runs an offline stub judge.

Tests: `pytest -m "not slow"` (pure logic) · `pytest -m slow` (live API eval
on every board-attainable sentence).

## Deploy as a (private) HF Space

1. `pip install -U "huggingface_hub[cli]"` and `hf auth login` (write token).
2. Create the Space (private while you iterate):

   ```bash
   hf repo create semantique --repo-type space --space-sdk gradio --private
   ```

3. Add a secret so the app can call the inference API: Space → **Settings →
   Variables and secrets** → new **secret** `HF_TOKEN` (a read token is fine).
   Never commit tokens.
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
