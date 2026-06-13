"""Level invariants — generic over every registered board, plus a few
board-specific solution paths."""

from collections import deque

import pytest

from judge import assemble_sentence
from levels import HOME_ID, LEVEL_ORDER, LEVELS, get_level

ALL_LEVELS = list(LEVELS.values())


# ---- tile-kind helpers (mirror game.js) -----------------------------------

def is_submit(word: str) -> bool:
    return word == "⏎"


def appends(word: str) -> bool:
    """A real word tile — not start, blank, or submit."""
    return bool(word) and word not in ("start", "⏎")


def neighbors(level, r, c):
    rows, cols = len(level.grid), len(level.grid[0])
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < rows and 0 <= nc < cols:
            yield nr, nc


def min_hops_to_real_submit(level):
    """Shortest hop count from start to a "⏎" with a non-empty sentence.

    BFS over (row, col, collected_a_word) — every cell is walkable (no walls),
    "⏎" tiles are terminal. None if no winnable path exists.
    """
    sr, sc = level.start
    seen = {(sr, sc, False)}
    q = deque([(sr, sc, False, 0)])
    while q:
        r, c, has_word, dist = q.popleft()
        for nr, nc in neighbors(level, r, c):
            word = level.grid[nr][nc]
            nxt_has_word = has_word or appends(word)
            if is_submit(word):
                if nxt_has_word:
                    return dist + 1  # a real, non-empty submit
                continue  # empty submit — terminal, not a win
            state = (nr, nc, nxt_has_word)
            if state not in seen:
                seen.add(state)
                q.append((nr, nc, nxt_has_word, dist + 1))
    return None


# ---- generic invariants ----------------------------------------------------

@pytest.mark.parametrize("level", ALL_LEVELS, ids=[lvl.id for lvl in ALL_LEVELS])
def test_grid_is_rectangular(level):
    width = len(level.grid[0])
    assert level.grid and all(len(row) == width for row in level.grid)


@pytest.mark.parametrize("level", ALL_LEVELS, ids=[lvl.id for lvl in ALL_LEVELS])
def test_start_is_in_bounds_and_blank(level):
    r, c = level.start
    assert 0 <= r < len(level.grid) and 0 <= c < len(level.grid[0])
    word = level.grid[r][c]
    assert not appends(word) and not is_submit(word)  # start tile stays wordless


@pytest.mark.parametrize("level", ALL_LEVELS, ids=[lvl.id for lvl in ALL_LEVELS])
def test_targets_are_scoreable(level):
    assert level.targets and all(t in level.labels for t in level.targets)


@pytest.mark.parametrize("level", ALL_LEVELS, ids=[lvl.id for lvl in ALL_LEVELS])
def test_has_a_submit_tile(level):
    assert any(is_submit(w) for row in level.grid for w in row)


@pytest.mark.parametrize("level", ALL_LEVELS, ids=[lvl.id for lvl in ALL_LEVELS])
def test_solvable_within_budget_and_no_instant_submit(level):
    hops = min_hops_to_real_submit(level)
    assert hops is not None, f"{level.id}: no winnable path to ⏎"
    assert hops >= 2, f"{level.id}: ⏎ reachable with an empty sentence"
    assert hops <= level.budget, f"{level.id}: shortest win {hops} > budget {level.budget}"


# ---- registry --------------------------------------------------------------

def test_registry_order_and_home():
    assert LEVEL_ORDER == ["emotion", "animal"]
    assert HOME_ID == "emotion"
    assert get_level("animal").title == "critters"


# ---- emotion board: the documented solution paths --------------------------

EMOTION = get_level("emotion")


def emotion_pos_of(word):
    grid = EMOTION.grid
    return next((r, c) for r, row in enumerate(grid) for c, w in enumerate(row) if w == word)


def emotion_walk(path):
    """Word-based walk (emotion words are unique); returns appended words."""
    pos = tuple(EMOTION.start)
    words = []
    for i, target_word in enumerate(path):
        nxt = tuple(EMOTION.start) if target_word == "start" else emotion_pos_of(target_word)
        assert abs(nxt[0] - pos[0]) + abs(nxt[1] - pos[1]) == 1, f"hop {i} {pos}->{nxt} not adjacent"
        pos = nxt
        word = EMOTION.grid[pos[0]][pos[1]]
        if appends(word):
            words.append(word)
    assert len(path) <= EMOTION.budget
    return words


def test_emotion_quick_win_path():
    assert assemble_sentence(emotion_walk(["great", "!", "⏎"])) == "great!"


def test_emotion_clever_win_path():
    assert assemble_sentence(emotion_walk(["not", "sad", "⏎"])) == "not sad"


def test_emotion_start_revisit_win_path():
    assert assemble_sentence(emotion_walk(["very", "start", "great", "!", "⏎"])) == "very great!"


# ---- animal board: empty tiles are walkable but wordless -------------------

ANIMAL = get_level("animal")


def test_animal_empty_tiles_add_no_word():
    # A centre-out route that crosses an empty "" tile: it costs a hop but
    # contributes no word. (2,2)->(2,1)fur->(1,1)!->(0,1)""->(0,0)⏎
    pos = tuple(ANIMAL.start)
    coords = [(2, 1), (1, 1), (0, 1), (0, 0)]
    words = []
    for r, c in coords:
        assert abs(r - pos[0]) + abs(c - pos[1]) == 1
        pos = (r, c)
        if appends(ANIMAL.grid[r][c]):
            words.append(ANIMAL.grid[r][c])
    assert is_submit(ANIMAL.grid[0][0])  # last hop is a corner submit
    assert assemble_sentence(words) == "fur!"  # the "" tile dropped out
