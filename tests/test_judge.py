import math
import os

import pytest

from judge import assemble_sentence, renormalize

LABELS = ["happy", "sad", "angry", "scared"]


def test_assemble_sentence_attaches_punctuation():
    assert assemble_sentence(["great", "!"]) == "great!"
    assert assemble_sentence(["not", "sad"]) == "not sad"
    assert assemble_sentence(["very", "great", "!"]) == "very great!"
    assert assemble_sentence(["?"]) == "?"


def test_renormalize_sums_to_one_and_preserves_order():
    probs = renormalize({"happy": -0.1, "sad": -2.0, "angry": -4.0, "scared": -8.0})
    assert math.isclose(sum(probs.values()), 1.0)
    assert probs["happy"] > probs["sad"] > probs["angry"] > probs["scared"]
    assert max(probs, key=probs.get) == "happy"


def test_renormalize_handles_large_negative_logprobs():
    probs = renormalize({"happy": -1000.0, "sad": -1001.0, "angry": -1002.0, "scared": -1003.0})
    assert math.isclose(sum(probs.values()), 1.0)
    assert max(probs, key=probs.get) == "happy"


# --- Live eval (slow, needs the Modal judge endpoint) -----------------------

BOARD_SENTENCES = [
    ("great!", "happy", True),
    ("not sad", "happy", True),
    ("very great!", "happy", True),
    ("great sad", "happy", False),
    ("apple hurt not sad", "happy", False),
]


@pytest.mark.slow
@pytest.mark.skipif(not os.environ.get("MODAL_JUDGE_URL"), reason="MODAL_JUDGE_URL not set")
@pytest.mark.parametrize("sentence,target,should_win", BOARD_SENTENCES)
def test_live_judge_on_board_sentences(sentence, target, should_win):
    from judge import score_labels

    probs = renormalize(score_labels(sentence, LABELS))
    winner = max(probs, key=probs.get)
    assert (winner == target) == should_win, f"{sentence!r} -> {probs}"
