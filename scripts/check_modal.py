"""Smoke-test the Modal judge endpoint over the emotion board's sentences.

Usage: python scripts/check_modal.py
Needs MODAL_JUDGE_URL (+ MODAL_KEY/MODAL_SECRET) in .env — see README "Run on Modal".

Prints, per sentence: the winning label, each label's exact logprob + renormalized
probability, and the top next-tokens after the prompt (a sanity check that the answer
slot really holds the candidate words). Also shows how each label tokenizes — so you
can see which labels are multi-token and that the whole-word scoring path is exercised.
"""

import os
import pathlib
import sys

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from judge import build_messages, renormalize  # noqa: E402
from levels import get_level  # noqa: E402

load_dotenv()

URL = os.environ.get("MODAL_JUDGE_URL")
if not URL:
    sys.exit("MODAL_JUDGE_URL not set — deploy modal_judge.py and fill in .env")
HEADERS = (
    {"Modal-Key": os.environ["MODAL_KEY"], "Modal-Secret": os.environ["MODAL_SECRET"]}
    if os.environ.get("MODAL_KEY")
    else {}
)

LEVEL = get_level("emotion")
SENTENCES = ["not sad", "great!", "very great!", "hurt", "yikes", "great sad"]


def call(sentence: str) -> dict:
    # Mirror the in-game call: every label is a target.
    messages = build_messages(sentence, LEVEL.labels)
    resp = requests.post(
        URL,
        json={"messages": messages, "labels": LEVEL.labels, "debug": True},
        headers=HEADERS,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


first = call(SENTENCES[0])
print("label tokenization (leading-space form):")
for label, toks in first["debug"]["label_tokens"].items():
    print(f"  {label:10s} {len(toks)} token(s): {toks}")

for sentence in SENTENCES:
    data = call(sentence)
    probs = renormalize(data["logprobs"])
    winner = max(probs, key=probs.get)
    print(f"\n{sentence!r}  ->  {winner}")
    for label in LEVEL.labels:
        print(f"  {label:10s} logprob {data['logprobs'][label]:8.3f}   p={probs[label]:.3f}")
    top = ", ".join(f"{tok!r}({lp})" for tok, lp in data["debug"]["top"][:8])
    print(f"  top next-tokens: {top}")
