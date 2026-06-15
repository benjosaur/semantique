"""The animal board — the home level: a 4x4 with a blank central start.

The doodle spawns on the blank centre tile (row 2, col 1); hop off to write a
sentence, then hop onto a "⏎" to send it. Two submit keys (top-right and
bottom-right) give you a choice of where to lock in.

One "wings" tile (top-left) is the clean exit: hop on and the doodle sprouts
wings for three airborne hops (two free glides, then a descent) — soar over the
keys straight onto a "⏎". No portals here; the word tiles only hint at the
critter, and the puzzle is routing a path the judge reads as the animal you want.
"""

from levels._base import Level

LEVEL = Level(
    id="animal",
    title="critters",
    grid=[
        ["wings", "spicy", "gruff", "⏎"],
        ["silly", "worst", "love", "chill"],
        ["huge", "start", "slow", "lump"],
        ["friend", "not", "grumpy", "⏎"],
    ],
    start=(2, 1),  # the blank central home tile
    targets=["whale", "otter", "cat", "dog", "bear", "owl", "mouse", "cow"],
    labels=["whale", "otter", "cat", "dog", "bear", "owl", "mouse", "cow"],
    budget=12,
    order=2,  # last: reached from the bonus board through the portal
    home=False,
)
