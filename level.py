"""The handcrafted level.

Grid geometry note: a 4x4 grid graph is bipartite, so start/⏎ placement
fixes sentence-length parity. With start at (1,1) and ⏎ at (2,3) (Manhattan
distance 3), walks have odd hop counts and sentences even word counts -- which
is what makes "not sad" and "great !" reachable.
"""

LEVEL = {
    "grid": [
        ["slowly", "very", "fast", "annoy"],
        ["apple", "start", "great", "!"],
        ["hurt", "not", "sad", "⏎"],
        ["again", "?", "angry", "disturb"],
    ],
    "start": [1, 1],  # row, col of the start tile
    "targets": ["happy", "sad", "angry", "scared"],  # collect them all
    "budget": 10,
    "labels": ["happy", "sad", "angry", "scared"],
}
