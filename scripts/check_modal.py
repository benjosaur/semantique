"""Smoke-test the Modal judge endpoint over the board sentences.

Usage: python scripts/check_modal.py
Needs MODAL_JUDGE_URL (+ MODAL_KEY/MODAL_SECRET) in .env — see README "Run on Modal".

Prints, per sentence: the winning emotion, each label's exact logprob + renormalized
probability, and the top next-tokens after the prompt (a sanity check that the answer
slot really holds emotion words). Also shows how each label tokenizes — so you can see
which labels are multi-token and that the whole-word scoring path is exercised.
"""

import os
import pathlib
import sys

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from judge import renormalize  # noqa: E402

load_dotenv()

URL = os.environ.get("MODAL_JUDGE_URL")
if not URL:
    sys.exit("MODAL_JUDGE_URL not set — deploy modal_judge.py and fill in .env")
HEADERS = (
    {"Modal-Key": os.environ["MODAL_KEY"], "Modal-Secret": os.environ["MODAL_SECRET"]}
    if os.environ.get("MODAL_KEY")
    else {}
)

LABELS = ["happy", "sad", "angry", "scared"]
SENTENCES = ["not sad", "great!", "very great!", "great sad", "apple hurt not sad"]


def call(sentence: str) -> dict:
    resp = requests.post(
        URL, json={"sentence": sentence, "labels": LABELS, "debug": True}, headers=HEADERS, timeout=120
    )
    resp.raise_for_status()
    return resp.json()


first = call(SENTENCES[0])
print("label tokenization (leading-space form):")
for label, toks in first["debug"]["label_tokens"].items():
    print(f"  {label:8s} {len(toks)} token(s): {toks}")

for sentence in SENTENCES:
    data = call(sentence)
    probs = renormalize(data["logprobs"])
    winner = max(probs, key=probs.get)
    print(f"\n{sentence!r}  ->  {winner}")
    for label in LABELS:
        print(f"  {label:8s} logprob {data['logprobs'][label]:8.3f}   p={probs[label]:.3f}")
    top = ", ".join(f"{tok!r}({lp})" for tok, lp in data["debug"]["top"][:8])
    print(f"  top next-tokens: {top}")
