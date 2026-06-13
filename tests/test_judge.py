import math
from types import SimpleNamespace

import pytest

from judge import assemble_sentence, extract_label_logprobs, renormalize

LABELS = ["happy", "sad", "angry", "scared"]


def tlp(token: str, logprob: float) -> SimpleNamespace:
    return SimpleNamespace(token=token, logprob=logprob)


def test_assemble_sentence_attaches_punctuation():
    assert assemble_sentence(["great", "!"]) == "great!"
    assert assemble_sentence(["not", "sad"]) == "not sad"
    assert assemble_sentence(["very", "great", "!"]) == "very great!"
    assert assemble_sentence(["?"]) == "?"


def test_extract_matches_whitespace_and_case_variants():
    top = [tlp(" happy", -0.1), tlp("Sad", -2.0), tlp(" angry", -4.0), tlp("scared", -6.0)]
    out = extract_label_logprobs(top, LABELS)
    assert out == {"happy": -0.1, "sad": -2.0, "angry": -4.0, "scared": -6.0}


def test_extract_matches_prefix_token_pieces():
    # BPE may split: "hap" is a prefix piece of "happy"
    top = [tlp("hap", -0.5), tlp(" sad", -1.0)]
    out = extract_label_logprobs(top, LABELS)
    assert out["happy"] == -0.5
    assert out["sad"] == -1.0


def test_extract_keeps_best_logprob_per_label():
    top = [tlp(" happy", -1.0), tlp("happy", -0.2)]
    assert extract_label_logprobs(top, LABELS)["happy"] == -0.2


def test_extract_floors_missing_labels():
    top = [tlp(" happy", -0.1), tlp(" sad", -3.0)]
    out = extract_label_logprobs(top, LABELS)
    assert out["angry"] == out["scared"] == -3.0 - 5.0


def test_extract_ignores_unrelated_tokens():
    top = [tlp(" the", -0.1), tlp("!", -1.0), tlp(" happy", -2.0)]
    out = extract_label_logprobs(top, LABELS)
    assert out["happy"] == -2.0


def test_renormalize_sums_to_one_and_preserves_order():
    probs = renormalize({"happy": -0.1, "sad": -2.0, "angry": -4.0, "scared": -8.0})
    assert math.isclose(sum(probs.values()), 1.0)
    assert probs["happy"] > probs["sad"] > probs["angry"] > probs["scared"]
    assert max(probs, key=probs.get) == "happy"


def test_renormalize_handles_large_negative_logprobs():
    probs = renormalize({"happy": -1000.0, "sad": -1001.0, "angry": -1002.0, "scared": -1003.0})
    assert math.isclose(sum(probs.values()), 1.0)
    assert max(probs, key=probs.get) == "happy"


# --- Live API eval (slow, needs a valid HF token) ---------------------------

BOARD_SENTENCES = [
    ("great!", "happy", True),
    ("very great!", "happy", True),
    ("not sad", "happy", True),
    ("hurt", "betrayed", True),
    ("yikes", "surprised", True),
    ("great!", "betrayed", False),
    ("yikes", "happy", False),
]


@pytest.mark.slow
@pytest.mark.parametrize("sentence,target,should_win", BOARD_SENTENCES)
def test_live_judge_on_board_sentences(sentence, target, should_win):
    from judge import score_labels
    from levels import get_level

    # Mirror the in-game judge() call: every label is passed as a target (so the
    # system prompt hints no single answer) and the board's own few-shot examples
    # calibrate the read. This measures the discrimination players actually get,
    # which is what makes labels like "betrayed"/"surprised" reachable at all.
    level = get_level("emotion")
    probs = renormalize(
        score_labels(sentence, level.labels, targets=level.labels, examples=level.examples)
    )
    winner = max(probs, key=probs.get)
    assert (winner == target) == should_win, f"{sentence!r} -> {probs}"
