"""The handcrafted level.

Grid geometry note: a 4x4 grid graph is bipartite, so <bos>/<eos> placement
fixes sentence-length parity. With <bos> at (1,1) and <eos> at (2,3) (Manhattan
distance 3), walks have odd hop counts and sentences even word counts -- which
is what makes "not sad" and "great !" reachable.
"""

LEVEL = {
    "grid": [
        ["slowly", "very", "fast", "annoy"],
        ["apple", "<bos>", "great", "!"],
        ["hurt", "not", "sad", "<eos>"],
        ["again", "?", "angry", "disturb"],
    ],
    "start": [1, 1],  # row, col of <bos>
    "target": "happy",
    "budget": 10,
    "labels": ["happy", "sad", "angry", "scared"],
}
