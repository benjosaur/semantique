"""The emotion board — the home level.

Grid geometry note: a 4x4 grid graph is bipartite, so start/⏎ placement
fixes sentence-length parity. With start at (1,1) and ⏎ at (2,3) (Manhattan
distance 3), walks have odd hop counts and sentences even word counts -- which
is what makes "not sad" and "great !" reachable.
"""

from levels._base import Level

LEVEL = Level(
    id="emotion",
    title="feelings",
    grid=[
        ["slowly", "very", "fast", "annoy"],
        ["apple", "start", "great", "!"],
        ["hurt", "not", "sad", "⏎"],
        ["again", "?", "angry", "disturb"],
    ],
    start=(1, 1),  # row, col of the start tile
    targets=["happy", "sad", "angry", "scared"],  # collect them all
    labels=["happy", "sad", "angry", "scared"],
    budget=10,
    category="emotion",
    # Few-shot pairs pin the answer to a single lowercase emotion word.
    few_shot=(
        ("I just won the lottery!", "happy"),
        ("My best friend moved away forever.", "sad"),
        ("Stop touching my stuff!", "angry"),
        ("Something is moving in the dark basement.", "scared"),
    ),
    question='What {category} does this sentence express, in one lowercase word: "{sentence}"',
    order=0,
    home=True,
)
