"""The emotion board — the home level.

Grid geometry note: a 4x4 grid graph is bipartite, so start/= placement
fixes sentence-length parity. With start at (1,1) and = at (2,3) (Manhattan
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
        ["hurt", "not", "sad", "="],
        ["again", "?", "angry", "disturb"],
    ],
    start=(1, 1),  # row, col of the start tile
    targets=["happy", "sad", "angry", "scared"],  # collect them all
    labels=["happy", "sad", "angry", "scared"],
    examples=(  # few-shot calibration for the judge (board words, all four labels)
        ("great!", "happy"),
        ("not great", "sad"),
        ("annoy", "angry"),
        ("disturb", "scared"),
    ),
    budget=10,
    order=0,
    home=True,
)
