"""Emotion judge: structured output via logprob filtering over an LLM API.

One chat-completion call with max_tokens=1 and top_logprobs; the next-token
distribution is masked to the allowed emotion labels and renormalized with a
softmax — i.e. constrained decoding, enforced client-side.

Swapping to a local model later only requires reimplementing score_labels().
"""

import math
import os

from huggingface_hub import InferenceClient

JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "Qwen/Qwen3-4B-Instruct-2507")

# Few-shot pairs pin the answer format to a single lowercase emotion word.
FEW_SHOT = [
    ("I just won the lottery!", "happy"),
    ("My best friend moved away forever.", "sad"),
    ("Stop touching my stuff!", "angry"),
    ("Something is moving in the dark basement.", "scared"),
]

# Labels absent from the returned top-k get the min found logprob minus this.
MISSING_LABEL_PENALTY = 5.0

_client = InferenceClient()


def assemble_sentence(words: list[str]) -> str:
    """Join words; punctuation attaches to the previous word ("great !" -> "great!")."""
    out = ""
    for w in words:
        if w in {"!", "?", ".", ","}:
            out += w
        else:
            out += (" " if out else "") + w
    return out


def extract_label_logprobs(top_logprobs: list, labels: list[str]) -> dict[str, float]:
    """Collect each label's best logprob from top-k (token, logprob) entries.

    Token strings are normalized (strip + lowercase) and matched if the label
    starts with the token or vice versa, covering tokenizations like " happy",
    "Happy", or a "hap" prefix piece. Missing labels get a floor.
    """
    found: dict[str, float] = {}
    for entry in top_logprobs:
        token = entry.token.strip().lower()
        if not token:
            continue
        for label in labels:
            if label.startswith(token) or token.startswith(label):
                if entry.logprob > found.get(label, -math.inf):
                    found[label] = entry.logprob
    floor = (min(found.values()) if found else 0.0) - MISSING_LABEL_PENALTY
    return {label: found.get(label, floor) for label in labels}


def renormalize(label_logprobs: dict[str, float]) -> dict[str, float]:
    """Softmax over just the label logprobs (the 'filter and renormalize' step)."""
    m = max(label_logprobs.values())
    exps = {label: math.exp(lp - m) for label, lp in label_logprobs.items()}
    total = sum(exps.values())
    return {label: e / total for label, e in exps.items()}


def score_labels(sentence: str, labels: list[str]) -> dict[str, float]:
    """One API call -> per-label logprobs of the first answer token."""
    messages = []
    for example, emotion in FEW_SHOT:
        messages.append({"role": "user", "content": f'What emotion does this sentence express, in one lowercase word: "{example}"'})
        messages.append({"role": "assistant", "content": emotion})
    messages.append({"role": "user", "content": f'What emotion does this sentence express, in one lowercase word: "{sentence}"'})

    resp = _client.chat_completion(
        model=JUDGE_MODEL,
        messages=messages,
        max_tokens=1,
        logprobs=True,
        top_logprobs=20,
    )
    content = resp.choices[0].logprobs.content
    if not content:
        raise RuntimeError(f"{JUDGE_MODEL} returned no logprobs")
    return extract_label_logprobs(content[0].top_logprobs, labels)


def judge(words: list[str], target: str, labels: list[str]) -> dict:
    """Server function called from JS when the player reaches <eos>."""
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
        probs = renormalize(score_labels(sentence, labels))
    except Exception as e:
        return {"ok": False, "error": str(e)}
    winner = max(probs, key=probs.get)
    return {
        "ok": True,
        "sentence": sentence,
        "probs": probs,
        "winner": winner,
        "verdict": "win" if winner == target else "lose",
    }
