"""The animal board — a 5x5 with a central start and four corner exits.

No walls: the word tiles only hint at the animals; the puzzle is routing a path
whose sentence the judge reads as the critter you're hunting.

Three "portal" tiles ring the board — top (0,1), right (2,4), bottom (4,1). Each
teleports to the next one clockwise (top -> right -> bottom -> top), so a portal
is a wordless shortcut across the grid (the hop onto it still costs budget).
"""

from levels._base import Level

LEVEL = Level(
    id="animal",
    title="critters",
    grid=[
        ["⏎", "portal", "ouch", "cylinder", "⏎"],
        ["flying", "fur", "loud", "puppy", "?"],
        ["love", "not", "start", "sea", "portal"],
        ["small", "hate", "winged", "quiet", "big"],
        ["⏎", "portal", "frolick", "grass", "⏎"],
    ],
    start=(2, 2),  # the centre tile
    targets=["whale", "dolphin", "otter", "cat", "dog", "bear", "owl", "mouse", "lion", "cow"],
    labels=["whale", "dolphin", "otter", "cat", "dog", "bear", "owl", "mouse", "lion", "cow"],
    budget=12,
    order=1,
)
