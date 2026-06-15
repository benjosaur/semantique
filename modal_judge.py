"""Modal GPU endpoint: exact per-label logprobs from a self-hosted open LLM.

The game's judge only needs the next-token distribution once (no generation), so
this is a single (batched) forward pass — no top-k cap. For each candidate label we
score its *whole* token sequence by teacher forcing: sum of log P(token_j | prefix),
read straight off one forward over [prompt + label]. That's the exact probability
the model would emit the word, handling multi-token labels correctly (a label like
"surprised" that splits into pieces is scored on the full word, not just its first
piece — which would otherwise borrow probability mass from "surprise", "super", ...).

The prompt is built client-side (judge.py) and arrives as chat `messages`; this
service just applies the tokenizer's chat template and scores the candidate labels.
All `labels × surface-forms` candidates ride in ONE batched forward pass.

Deploy:  modal deploy modal_judge.py     (stable URL)
Dev:     modal serve  modal_judge.py     (hot-reload, temporary URL)
The deployed web URL + a Modal proxy-auth token (Modal-Key / Modal-Secret) are what
judge.py calls. See README "Run on Modal".
"""

import modal

MODEL_ID = "openbmb/MiniCPM3-4B"  # ≤4B open weights (Tiny Titan); non-reasoning instruct
# Pin the exact commit: with trust_remote_code the custom modeling code is fetched per
# revision, so an unpinned (moving `main`) ref lets it change under us and re-download at
# load time. Pinning also makes the image-baked weights reproducible.
MODEL_REVISION = "d6b14ddaefdb11c624dd75c3c779549bc90b08cb"
CACHE = "/cache"  # HF cache path — baked into the image (see download_model), not a Volume


def download_model():
    # Runs once at image-build time. Pulls the weights + custom code into the image's HF
    # cache so they live on the *immutable* image layer. Memory snapshots mmap the weights
    # from wherever they were loaded; an image path can't drift or be deleted, so restores
    # can't break — unlike a mutable Volume (Modal: "Deleting files in a Volume used during
    # restore will cause restore failures").
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_ID, revision=MODEL_REVISION)


# MiniCPM3-4B ships custom modeling (trust_remote_code) validated on transformers 4.49.0.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.5.1",
        "transformers==4.49.0",
        "accelerate==1.1.1",
        "sentencepiece==0.2.0",
        "fastapi[standard]==0.115.5",
        "hf_transfer==0.1.8",  # faster weight pull during the build
    )
    .env({"HF_HOME": CACHE, "HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_function(download_model)  # bake weights into the image; no runtime download
    # Never phone HF at runtime: load straight from the baked cache. This also kills the
    # trust_remote_code re-fetch that was mutating the cache mid-snapshot.
    .env({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
)

app = modal.App("semantique-judge", image=image)

# Import heavy libs in the container's global scope so they're captured by the snapshot.
with image.imports():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer


@app.cls(
    gpu="l4",  # 24 GB; MiniCPM3-4B in bf16 is ~8 GB — comfortable headroom.
    enable_memory_snapshot=True,  # snapshot the CPU-loaded model to cut cold starts
    scaledown_window=120,  # only affects burst containers beyond the floor now
    min_containers=1,  # keep one L4 resident at all times — no cold starts (~$0.80/hr 24/7)
)
# Let one warm L4 absorb a small burst of verdicts (sharing its single resident model)
# before Modal scales out a fresh container — far cheaper than a cold start per overlap,
# and this game's traffic is bursty and turn-based, never GPU-saturating.
@modal.concurrent(max_inputs=4)
class Judge:
    @modal.enter(snap=True)
    def load(self):
        # Runs once before snapshotting: load weights to CPU so they land in the snapshot.
        # Offline + pinned revision → reads the image-baked cache (no network, no re-download).
        self.tok = AutoTokenizer.from_pretrained(
            MODEL_ID, revision=MODEL_REVISION, trust_remote_code=True
        )
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID, revision=MODEL_REVISION, torch_dtype=torch.bfloat16, trust_remote_code=True
        )
        self.model.eval()
        self.pad_id = self.tok.pad_token_id or self.tok.eos_token_id or 0

    @modal.enter(snap=False)
    def to_gpu(self):
        # Runs on every (snapshot) restore: move the model onto the GPU.
        self.model.to("cuda")

    def _score_logprobs(self, messages: list[dict], labels: list[str]) -> dict[str, float]:
        """Exact joint log-prob of the model continuing `messages` with each label.

        Scores each label's *whole* token sequence (max over leading-space / bare
        surface forms). All candidates ride one batched forward pass.
        """
        base = self.tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=True)
        prompt_len = len(base)

        # One candidate per (label, surface form): score the whole word, not just its
        # first token; try both forms a tokenizer might emit and take the max.
        cands: list[tuple[str, list[int]]] = [
            (label, self.tok.encode(form, add_special_tokens=False))
            for label in labels
            for form in (f" {label}", label)
        ]
        width = prompt_len + max(len(form_ids) for _, form_ids in cands)

        input_ids = torch.tensor(
            [base + ids + [self.pad_id] * (width - prompt_len - len(ids)) for _, ids in cands],
            device="cuda",
        )
        attn = torch.tensor(
            [[1] * (prompt_len + len(ids)) + [0] * (width - prompt_len - len(ids)) for _, ids in cands],
            device="cuda",
        )
        with torch.no_grad():
            logprobs = self.model(input_ids, attention_mask=attn).logits.float().log_softmax(-1)

        out: dict[str, float] = {}
        for row, (label, form_ids) in enumerate(cands):
            # logits[t] predict token t+1, so the word's j-th token (seq index
            # prompt_len + j) is predicted at position prompt_len - 1 + j.
            score = sum(
                float(logprobs[row, prompt_len - 1 + j, tid]) for j, tid in enumerate(form_ids)
            )
            out[label] = max(out.get(label, float("-inf")), score)
        return out

    def _debug(self, messages: list[dict], labels: list[str]) -> dict:
        """Diagnostics for scripts/check_modal.py: how labels tokenize, and the top
        next-tokens after the prompt (to confirm the answer slot holds label words)."""
        base = self.tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=True)
        with torch.no_grad():
            final = self.model(torch.tensor([base], device="cuda")).logits[0, -1].float().log_softmax(-1)
        top_lp, top_id = final.topk(15)
        return {
            "top": [[self.tok.decode([int(i)]), round(float(lp), 3)] for lp, i in zip(top_lp, top_id)],
            "label_tokens": {
                label: self.tok.convert_ids_to_tokens(self.tok.encode(f" {label}", add_special_tokens=False))
                for label in labels
            },
        }

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, docs=False)
    def score(self, data: dict) -> dict:
        """POST {"messages": [...], "labels": [str], "debug"?: bool} -> {"logprobs": {label: float}}."""
        resp = {"logprobs": self._score_logprobs(data["messages"], data["labels"])}
        if data.get("debug"):
            resp["debug"] = self._debug(data["messages"], data["labels"])
        return resp

    @modal.method()
    def score_remote(self, messages: list[dict], labels: list[str]) -> dict[str, float]:
        """Same scoring, callable via `.remote()` for smoke tests (no HTTP layer)."""
        return self._score_logprobs(messages, labels)


@app.local_entrypoint()
def main(sentence: str = "not sad"):
    """Smoke test against the deployed/served class: `modal run modal_judge.py`."""
    labels = ["happy", "betrayed", "surprised"]
    messages = [
        {
            "role": "system",
            "content": f"The targets are: {', '.join(labels)}. "
            "Output the one most similar to the user's message.",
        },
        {"role": "user", "content": sentence},
    ]
    result = Judge().score_remote.remote(messages, labels)
    print(f"{sentence!r}")
    for label, lp in sorted(result.items(), key=lambda kv: -kv[1]):
        print(f"  {label:10s} {lp:8.3f}")
