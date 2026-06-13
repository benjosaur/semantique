"""Emotion judge: structured output via exact logprob filtering over a self-hosted LLM.

The model runs on a Modal GPU (see modal_judge.py). For one sentence we get the
*exact* probability the model would answer with each emotion word — its full
multi-token sequence scored by the model, not just whatever lands in an API's
top-k. Those per-label logprobs are then masked to the allowed labels and
renormalized with a softmax — constrained decoding, enforced client-side.

`score_labels()` is the only seam to the model: it POSTs to the Modal endpoint.
Set JUDGE_FAKE=1 for an offline stub (no GPU, no network).
"""

import math
import os

import requests
from dotenv import load_dotenv

load_dotenv()  # local dev: MODAL_* live in .env (gitignored); the Space uses secrets

# Deployed Modal web endpoint + a Modal proxy-auth token. See README "Run on Modal".
MODAL_JUDGE_URL = os.environ.get("MODAL_JUDGE_URL", "")
MODAL_KEY = os.environ.get("MODAL_KEY", "")
MODAL_SECRET = os.environ.get("MODAL_SECRET", "")

# Cold start may reload (and, the very first time, download) the model, so allow slack.
REQUEST_TIMEOUT = 120


def assemble_sentence(words: list[str]) -> str:
    """Join words; punctuation attaches to the previous word ("great !" -> "great!")."""
    out = ""
    for w in words:
        if w in {"!", "?", ".", ","}:
            out += w
        else:
            out += (" " if out else "") + w
    return out


def renormalize(label_logprobs: dict[str, float]) -> dict[str, float]:
    """Softmax over just the label logprobs (the 'filter and renormalize' step)."""
    m = max(label_logprobs.values())
    exps = {label: math.exp(lp - m) for label, lp in label_logprobs.items()}
    total = sum(exps.values())
    return {label: e / total for label, e in exps.items()}


def score_labels(sentence: str, labels: list[str]) -> dict[str, float]:
    """One call to the Modal GPU endpoint -> exact per-label logprobs."""
    if not MODAL_JUDGE_URL:
        raise RuntimeError("MODAL_JUDGE_URL is not set (deploy modal_judge.py, or use JUDGE_FAKE=1)")
    headers = {}
    if MODAL_KEY and MODAL_SECRET:  # Modal proxy auth
        headers = {"Modal-Key": MODAL_KEY, "Modal-Secret": MODAL_SECRET}
    resp = requests.post(
        MODAL_JUDGE_URL,
        json={"sentence": sentence, "labels": labels},
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["logprobs"]


def judge(payload: dict) -> dict:
    """Server function called from JS when the player reaches ⏎.

    Single-dict payload: Gradio's component server reliably passes exactly
    one JSON argument through to server functions.
    """
    words = payload["words"]
    targets = payload["targets"]  # still-unchecked emotions; any of them wins
    labels = payload["labels"]
    if not words:
        return {
            "ok": True,
            "sentence": "",
            "probs": {label: 1.0 / len(labels) for label in labels},
            "winner": None,
            "verdict": "lose",
        }
    sentence = assemble_sentence(words)
    try:
        if os.environ.get("JUDGE_FAKE"):  # offline dev mode: no GPU, no network
            fake = {label: -6.0 - i for i, label in enumerate(labels)}
            fake["happy" if ("great" in words or "not" in words) else "sad"] = -0.3
            probs = renormalize(fake)
        else:
            probs = renormalize(score_labels(sentence, labels))
    except Exception as e:
        return {"ok": False, "error": str(e)}
    winner = max(probs, key=probs.get)
    return {
        "ok": True,
        "sentence": sentence,
        "probs": probs,
        "winner": winner,
        "verdict": "win" if winner in targets else "lose",
    }
