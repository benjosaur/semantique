"""The animal board — a 5x5 with a central start and four corner exits.

No walls: the blank tiles ("") are walkable but wordless, so they're free
repositioning hops that still cost budget. The word tiles only hint at the
animals; the puzzle is routing a path whose sentence the judge reads as the
critter you're hunting.
"""

from levels._base import Level

LEVEL = Level(
    id="animal",
    title="critters",
    grid=[
        ["=", "", "cylinder", "ouch", "="],
        ["flying", "!", "loud", "puppy", "?"],
        ["love", "fur", "start", "sea", ""],
        ["small", "hate", "grass", "quiet", "big"],
        ["=", "", "frolick", "", "="],
    ],
    start=(2, 2),  # the centre tile
    targets=["whale", "dolphin", "otter", "cat", "dog", "bear", "owl", "mouse", "lion", "cow"],
    labels=["whale", "dolphin", "otter", "cat", "dog", "bear", "owl", "mouse", "lion", "cow"],
    budget=12,
    order=1,
)
