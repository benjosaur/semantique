"""Modal GPU endpoint: exact per-label logprobs from a self-hosted open LLM.

The game's judge only needs the next-token distribution once (no generation), so
this is a single (batched) forward pass — no top-k cap. For each emotion label we
score its *whole* token sequence by teacher forcing: sum of log P(token_j | prefix),
read straight off one forward over [prompt + label]. That's the exact probability
the model would emit the word, handling multi-token labels correctly (a label like
"scared" that splits into pieces is scored on the full word, not just its first
piece — which would otherwise borrow probability mass from "scary", "score", ...).

All `labels × surface-forms` candidates ride in ONE batched forward pass: at batch=1
an 8B model is memory-bandwidth-bound (it streams ~16 GB of weights per pass), so
batching ~8 candidates is ~as cheap as scoring one.

Deploy:  modal deploy modal_judge.py     (stable URL)
Dev:     modal serve  modal_judge.py     (hot-reload, temporary URL)
The deployed web URL + a Modal proxy-auth token (Modal-Key / Modal-Secret) are what
judge.py calls. See README "Run on Modal".
"""

import modal

MODEL_ID = "openbmb/MiniCPM3-4B"  # ≤4B open weights (Tiny Titan); non-reasoning instruct
CACHE = "/cache"  # HF download cache, persisted in a Volume so cold starts skip re-download

# MiniCPM3-4B ships custom modeling (trust_remote_code) validated on transformers 4.49.0.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.5.1",
        "transformers==4.49.0",
        "accelerate==1.1.1",
        "sentencepiece==0.2.0",
        "fastapi[standard]==0.115.5",
    )
    .env({"HF_HOME": CACHE})
)

app = modal.App("semantique-judge", image=image)
cache_vol = modal.Volume.from_name("semantique-hf-cache", create_if_missing=True)

# Import heavy libs in the container's global scope so they're captured by the snapshot.
with image.imports():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

# Few-shot pins the answer to a single lowercase emotion word (kept next to the model,
# since the right prompting is model-specific).
FEW_SHOT = [
    ("I just won the lottery!", "happy"),
    ("My best friend moved away forever.", "sad"),
    ("Stop touching my stuff!", "angry"),
    ("Something is moving in the dark basement.", "scared"),
]

QUESTION = 'What emotion does this sentence express, in one lowercase word: "{}"'


def _build_messages(sentence: str) -> list[dict]:
    msgs: list[dict] = []
    for example, emotion in FEW_SHOT:
        msgs.append({"role": "user", "content": QUESTION.format(example)})
        msgs.append({"role": "assistant", "content": emotion})
    msgs.append({"role": "user", "content": QUESTION.format(sentence)})
    return msgs


@app.cls(
    gpu="l4",  # 24 GB; MiniCPM3-4B in bf16 is ~8 GB — comfortable headroom.
    volumes={CACHE: cache_vol},
    enable_memory_snapshot=True,  # snapshot the CPU-loaded model to cut cold starts
    scaledown_window=120,  # idle 2 min, then scale to zero (no cost while nobody plays)
    min_containers=0,
)
class Judge:
    @modal.enter(snap=True)
    def load(self):
        # Runs once before snapshotting: load weights to CPU so they land in the snapshot.
        self.tok = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID, torch_dtype=torch.bfloat16, trust_remote_code=True
        )
        self.model.eval()
        self.pad_id = self.tok.pad_token_id or self.tok.eos_token_id or 0

    @modal.enter(snap=False)
    def to_gpu(self):
        # Runs on every (snapshot) restore: move the model onto the GPU.
        self.model.to("cuda")

    def _score_logprobs(self, sentence: str, labels: list[str]) -> dict[str, float]:
        """Exact joint log-prob of the model emitting each label as its one-word answer.

        Scores each label's *whole* token sequence (max over leading-space / bare
        surface forms). All candidates ride one batched forward pass.
        """
        base = self.tok.apply_chat_template(
            _build_messages(sentence), add_generation_prompt=True, tokenize=True
        )
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

    def _debug(self, sentence: str, labels: list[str]) -> dict:
        """Diagnostics for scripts/check_modal.py: how labels tokenize, and the top
        next-tokens after the prompt (to confirm the answer slot holds emotion words)."""
        base = self.tok.apply_chat_template(
            _build_messages(sentence), add_generation_prompt=True, tokenize=True
        )
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
        """POST {"sentence": str, "labels": [str], "debug"?: bool} -> {"logprobs": {label: float}}."""
        resp = {"logprobs": self._score_logprobs(data["sentence"], data["labels"])}
        if data.get("debug"):
            resp["debug"] = self._debug(data["sentence"], data["labels"])
        return resp

    @modal.method()
    def score_remote(self, sentence: str, labels: list[str]) -> dict[str, float]:
        """Same scoring, callable via `.remote()` for smoke tests (no HTTP layer)."""
        return self._score_logprobs(sentence, labels)


@app.local_entrypoint()
def main(sentence: str = "not sad"):
    """Smoke test against the deployed/served class: `modal run modal_judge.py`."""
    labels = ["happy", "sad", "angry", "scared"]
    result = Judge().score_remote.remote(sentence, labels)
    print(f"{sentence!r}")
    for label, lp in sorted(result.items(), key=lambda kv: -kv[1]):
        print(f"  {label:8s} {lp:8.3f}")
