from judge import assemble_sentence
from level import LEVEL

GRID = LEVEL["grid"]


def pos_of(word):
    return next((r, c) for r, row in enumerate(GRID) for c, w in enumerate(row) if w == word)


def walk(path):
    """Simulate hops along word positions; return the appended words.

    Asserts orthogonal adjacency of each hop and that the budget holds.
    <bos>/<eos> are structural: they append nothing (but each hop costs 1).
    """
    pos = tuple(LEVEL["start"])
    words = []
    for i, target_word in enumerate(path):
        nxt = pos_of(target_word) if target_word not in ("<bos>",) else tuple(LEVEL["start"])
        assert abs(nxt[0] - pos[0]) + abs(nxt[1] - pos[1]) == 1, f"hop {i} {pos}->{nxt} not adjacent"
        pos = nxt
        word = GRID[pos[0]][pos[1]]
        if word not in ("<bos>", "<eos>"):
            words.append(word)
    assert len(path) <= LEVEL["budget"]
    return words


def test_grid_shape_and_special_tiles():
    assert len(GRID) == 4 and all(len(row) == 4 for row in GRID)
    assert pos_of("<bos>") == tuple(LEVEL["start"])
    assert LEVEL["targets"] and all(t in LEVEL["labels"] for t in LEVEL["targets"])


def test_quick_win_path():
    assert assemble_sentence(walk(["great", "!", "<eos>"])) == "great!"


def test_clever_win_path():
    assert assemble_sentence(walk(["not", "sad", "<eos>"])) == "not sad"


def test_bos_revisit_win_path():
    assert assemble_sentence(walk(["very", "<bos>", "great", "!", "<eos>"])) == "very great!"


def test_min_hops_to_eos_prevents_empty_submit():
    br, bc = pos_of("<bos>")
    er, ec = pos_of("<eos>")
    assert abs(br - er) + abs(bc - ec) >= 2  # <eos> never adjacent to <bos>
