"""The animal board — the home level: a 5x4 you start sitting on a submit key.

The doodle spawns on the central "⏎" (row 2, col 1) but doesn't fire it — you're
parked on the button, free to hop off and write a sentence before hopping back
onto any "⏎" to send it. Three submit keys (the centre start, top-right, and
bottom-right) give you more than one place to lock in.

Two "wings" tiles (top-left and bottom-left) are the clean exits:
hop on and the doodle sprouts wings for three airborne hops (two free glides,
then a descent) — soar over the keys straight onto a "⏎". No portals here; the
word tiles only hint at the critter, and the puzzle is routing a path the judge
reads as the animal you want.
"""

from levels._base import Level

LEVEL = Level(
    id="animal",
    title="critters",
    grid=[
        ["wings", "ouchy", "rough", "⏎"],
        ["silly", "peak", "love", "chill"],
        ["super", "⏎", "slow", "genius"],
        ["happy", "not", "grumpy", "buddy"],
        ["wings", "scrappy", "majestic", "⏎"],
    ],
    start=(2, 1),  # the central submit key — you start on it, it doesn't fire
    targets=["whale", "otter", "cat", "dog", "bear", "owl", "mouse", "lion", "cow"],
    labels=["whale", "otter", "cat", "dog", "bear", "owl", "mouse", "lion", "cow"],
    budget=12,
    order=0,
    home=True,
)
