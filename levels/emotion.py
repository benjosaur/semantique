"""The emotion board — the second level, reached from the animal board.

Grid geometry note: a 4x4 grid graph is bipartite, so start/⏎ placement
fixes sentence-length parity. With start at (1,1) and ⏎ at (2,3) (Manhattan
distance 3), walks have odd hop counts and sentences even word counts -- which
is what makes a two-word read like "not sad" reachable.
"""

from levels._base import Level

LEVEL = Level(
    id="emotion",
    title="feelings",
    grid=[
        ["yikes", "very", "fast", "annoy"],
        ["little", "start", "great", "!"],
        ["hurt", "not", "sad", "⏎"],
        ["again", "?", "angry", "disturb"],
    ],
    start=(1, 1),  # row, col of the start tile
    targets=["happy", "elated", "irked", "scared", "distraught", "furious", "betrayed"],  # collect them all
    labels=["happy", "elated", "irked", "scared", "distraught", "furious", "betrayed"],
    budget=10,
    order=0,  # the boot board; progression is feelings → bonus → critters
    home=True,
    # only "betrayed" is hintable here — its cryptic riddle (the modal slays him
    # à la Et tu Brute); every other feeling you're on your own. See game.js.
    solutions={"betrayed": 'Et tu Brute? I feel "little hurt again ? angry sad" (betrayed)'},
)
