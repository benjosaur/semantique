"""The judge: structured output via exact logprob filtering over a self-hosted LLM.

A system message names the level's targets and asks for the one most similar to the
player's message; the user message is the assembled sentence. The model (on a Modal
GPU — see modal_judge.py) scores each candidate label's whole token sequence in one forward
pass; we get the *exact* probability of each label, not just whatever lands in a
hosted API's top-k. Those per-label logprobs are masked to the level's candidate
labels and renormalized with a softmax — constrained decoding, enforced
client-side. The candidate set is what makes the answer an emotion on one board
and an animal on another.

`score_labels()` is the only seam to the model: it POSTs to the Modal endpoint.
"""

import math
import os

import requests
from dotenv import load_dotenv

from levels import get_level

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


def build_messages(sentence: str, targets: list[str]) -> list[dict]:
    """The judge prompt: a system message naming `targets` and asking for the one
    closest to the player's message, then the assembled sentence as the user turn."""
    return [
        {
            "role": "system",
            "content": f"The targets are: {', '.join(targets)}. "
            "Output the one most similar to the user's message.",
        },
        {"role": "user", "content": sentence},
    ]


def renormalize(label_logprobs: dict[str, float]) -> dict[str, float]:
    """Softmax over just the label logprobs (the 'filter and renormalize' step)."""
    m = max(label_logprobs.values())
    exps = {label: math.exp(lp - m) for label, lp in label_logprobs.items()}
    total = sum(exps.values())
    return {label: e / total for label, e in exps.items()}


def score_labels(
    sentence: str,
    labels: list[str],
    targets: list[str],
) -> dict[str, float]:
    """One call to the Modal GPU endpoint -> exact per-label logprobs.

    The prompt (built from `targets`) is sent as chat messages; the candidate
    `labels` are what the endpoint scores and constrains the answer to.
    """
    if not MODAL_JUDGE_URL:
        raise RuntimeError("MODAL_JUDGE_URL is not set (deploy modal_judge.py — see README)")
    headers = {}
    if MODAL_KEY and MODAL_SECRET:  # Modal proxy auth
        headers = {"Modal-Key": MODAL_KEY, "Modal-Secret": MODAL_SECRET}
    resp = requests.post(
        MODAL_JUDGE_URL,
        json={"messages": build_messages(sentence, targets), "labels": labels},
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["logprobs"]


def judge(payload: dict) -> dict:
    """Server function called from JS when the player reaches "⏎".

    Single-dict payload: Gradio's component server reliably passes exactly
    one JSON argument through to server functions. The board sends its
    `level_id`; the candidate labels are resolved server-side so they never
    round-trip through the client.
    """
    words = payload["words"]
    remaining = payload["targets"]  # still-unchecked labels; only the win check (+ stub) use these
    level = get_level(payload["level_id"])
    labels = level.labels
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
        # Condition on the full target set so the prompt is stable across a session;
        # the win check below, not the prompt, is what tracks remaining targets.
        probs = renormalize(score_labels(sentence, labels, level.targets))
    except Exception as e:
        return {"ok": False, "error": str(e)}
    winner = max(probs, key=probs.get)
    return {
        "ok": True,
        "sentence": sentence,
        "probs": probs,
        "winner": winner,
        "verdict": "win" if winner in remaining else "lose",
    }
