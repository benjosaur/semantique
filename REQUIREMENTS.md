# Build Small Hackathon — Requirements

> Hugging Face × Gradio. _"Build something small, local, and yours."_
> Source: [Field Guide](https://build-small-hackathon-field-guide.hf.space/) · [HF Org](https://huggingface.co/BuildSmall)

**🎯 Our target track: Thousand Token Wood (the whimsical track).**

> Note: "Thousand Token Wood" is the *name* of the whimsical track — there is **no literal 1000-token budget**. The only hard model constraint is ≤ 32B parameters per model (see REQ-01).

---

## Key facts

| | |
|---|---|
| **Final deadline** | **June 15, 2026** |
| **Model cap** | ≤ 32B parameters (per model) |
| **Prize pool** | $48k+ cash, plus 20k Modal credits, 2× NVIDIA RTX GPUs, ChatGPT Pro |
| **Ways to win** | 29 |
| **Framework** | Gradio app, hosted as a Hugging Face Space in the official Build Small org |

---

## The big idea

The future of AI doesn't have to live in someone else's data center. Build Small is a return to small, local, tinkerable models — open weights you can read, run, and reshape, everything under 32B parameters, running on hardware you actually own. Less API bill, more workshop.

---

## Tracks — two trails, equal prize pool

### 🌲 Thousand Token Wood — the Whimsical Track (OUR TRACK)

Whimsical, delightful, AI-native apps that push the boundaries of fun. Wander somewhere stranger and show off what small models can dream up.

Examples:
- Interactive AI games
- Out-of-the-box entertainment tools
- A desktop pet that lives on your machine
- A text-adventure dungeon master

**What judges look for:** genuine delight, the AI being *load-bearing* (not auxiliary), originality, and Gradio app quality.

### 🏡 Backyard AI — the Practical Track (for reference)

Practical, problem-solving apps built to improve daily life — for you or someone close to you. Useful things that run on hardware you own.

Examples: a custom storybook generator for a child, a personal study tutor, a receipt/bill parser, an on-device document assistant.

---

## Entry criteria (REQ-01 → REQ-06)

Every submission needs all six.

- **REQ-01 — Stay under 32B.** Every model must be under 32B parameters. Combine several small models if you like — but each one's total parameter count must stay below the cap.
- **REQ-02 — Ship a Gradio app.** Deploy your project as a Gradio App inside the official Build Small org on Hugging Face. Docker is fine, as long as the interface is a Gradio Space.
- **REQ-03 — Record a demo.** Submit a demo video showing your app working — so judges can evaluate it even if GPU or API limits stop a live run.
- **REQ-04 — Post it.** Create one social-media post showcasing your app, and link to it from your Space README.
- **REQ-05 — Mind the GPU limit.** Submit as many apps as you like. If you rely on the provided Zero GPU resources, you're limited to 10 Zero GPU apps per user.
- **REQ-06 — Tag your README.** Add tags for the tracks and badges you want to be considered for to the YAML block at the top of your README, plus a short write-up of the idea and tech.

---

## Prizes — 29 ways to win

### General track prizes (awarded **per track** — so these apply to Thousand Token Wood)

| Place | Prize |
|---|---|
| 1st | $4,000 |
| 2nd | $2,500 |
| 3rd | $1,500 |
| 4th | $1,000 |
| Community Choice | $2,000 |

### Sponsor prizes (each has its own criteria)

- **OpenBMB — Best MiniCPM Build:** 1st $2,500 / 2nd $1,500 / 3rd $1,000.
  - Qualify: build with MiniCPM models.
  - Pool is split per track ($5,000 to Backyard AI, $5,000 to Thousand Token Wood); placements awarded within each track.
  - Vision (MiniCPM-V) and omni (MiniCPM-o) variants qualify, not just the text models.
- **OpenAI — Best Use of Codex:** 1st $5,000 / 2nd $3,000 / 3rd $1,000 ($10,000 total, across all submissions).
  - Qualify: Codex-attributed commits in your connected GitHub repo or Space.
  - Holistic use (fine-tuning, complex agents) ranks higher than light use.
- **NVIDIA — Nemotron Hardware Prize:** RTX 5080 for "Best space" + RTX 5080 for "Community engagement" (2 GPUs total, across all submissions).
  - Qualify: build with Nemotron models. "Best space" judged by NVIDIA team; "community engagement" judged on likes & interactions.
- **Modal — Best Use of Modal:** 1st 10,000 / 2nd 7,000 / 3rd 3,000 credits ($20,000 in credits total).
  - Qualify: use Modal for development or runtime, and note it in your README. Inference, fine-tuning, batch jobs, and sandboxes all count.

### Bonus badges (tag them in your README)

- **Off Brand — $1,500:** best custom UI that pushes past the default Gradio look. `gr.Server` is your friend — go well beyond stock components.
- **Tiny Titan — $1,500:** best app on a genuinely tiny model. Models must be **≤ 4B parameters**; biggest impact from the smallest weights wins.
- **Best Demo — $1,000:** the full package — great app, demo video, and social post. Storytelling counts as much as the build.
- **Best Agent — $1,000:** the best agentic app. Multi-step tool use and planning, all under the 32B cap.
- **Bonus Quest Champion — $2,000:** the most bonus criteria met across the board. Ties go to the most ambitious, highest-quality submission.
- **Judges' Wildcard — $1,000:** for the entry that's amazing but fits no category. No entry needed — every submission is in the running.

> **Prizes stack.** One Space can place in a track, win sponsor prizes, and collect bonus badges all at once.

---

## How to submit

1. **Meet the criteria** — double-check the entry rules (REQ-01→06) and any prize criteria you're targeting.
2. **Join the org** — join the [Build Small org](https://huggingface.co/BuildSmall) on Hugging Face.
3. **Upload your Space** — upload your submission as a Gradio Space inside the org.
4. **Record a demo** — film a demo selling your Space (no humility). Put it on YouTube, upload to the Space, or host it publicly.
5. **Post on social** — share one post about your build.
6. **Update your README** — add links to the post + demo video, tags for tracks + badges in the YAML block at the top, and a short write-up of the idea and tech.

Submit at: <https://build-small-hackathon-field-guide.hf.space/submit>

---

## FAQ highlights

- **What does "under 32B" mean?** Every model your project depends on must have under 32B *total* parameters (not just active params). You can combine several models (e.g. a 14B text + 7B speech + 12B image model) as long as each stays under the cap.
- **Must I use a sponsor's model?** No. General tracks accept any model under 32B, including from non-sponsoring orgs. Sponsor prizes require their own model/platform per their criteria.
- **Hosted API vs local?** Hosted APIs are allowed (some partners offer free hosted access; HF inference providers offer more). Some prizes require local execution to be eligible.
- **GPU limit?** If using the provided Zero GPU resources: max 10 Zero GPU apps per user. Otherwise run on consumer hardware or Modal credits.
- **Multiple apps?** Yes — submit as many as you like; each is considered.

---

## Partners / kit (small-AI models worth reaching for)

- **OpenBMB** — MiniCPM family: tiny text · vision · audio · omni models (1B–8B). E.g. MiniCPM-V 4.6 (~1.3B, strong OCR/doc understanding).
- **Black Forest Labs** — FLUX.2 Klein: text-to-image & precise image editing at 4B / 9B.
- **OpenAI · Codex** — Codex coding agent (GPT-5.5) with GitHub, Figma & Hugging Face plugins.
- **NVIDIA** — Nemotron 3 family: Nano · Omni · ASR · Parse · Embed (Nemotron Parse: sub-1B structured doc extraction).
- **Modal** — serverless compute for inference, training, batch & sandboxes.
- **JetBrains** — Mellum 2: 12B MoE coding models (Thinking & Instruct).
- **Cohere Labs** — Cohere Transcribe (ASR) and Tiny Aya multilingual models.

---

_© 2026 Build Small · ≤ 32B params · open weights · run it yourself_
