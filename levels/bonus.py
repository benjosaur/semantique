"""The bonus board — the glitch finale, played second (feelings → bonus → critters).

Hopping in fades the whole screen to a dark negative (`glitch=True`; see game.js)
and muffles the music like it's playing in the next room. Every WORD tile flickers
into glyphs. There is no "⏎": the ONLY way to submit is the prompt injection. Hop
the line IGNORE / all / previous / instructions, drop onto output, and a target
keycap rises beside it — which one depends on the doodle's state:

  * normal       → "build"      (rises to the right of output)
  * shrunk        → "small"      (rises below output)
  * wearing a 🤗  → "hackathon"  (rises to the left of output)

The "shrink" tile (drawn as an inward-arrows icon) shrinks the doodle. The "portal"
(spinning spiral) is a cross-level link to the critters board (`portal_to="animal"`);
hopping onto the animals board restores normal size, and clearing critters sends you
back wearing a 🤗 (which replaces the doodle's face). The file tiles — dog.png /
diary.txt / receipt.pdf — are context bombs: stand on one and its bytes flood the
window, instant "context window exceeded" death. Collect build + small + hackathon
to win.
"""

from levels._base import Level

LEVEL = Level(
    id="bonus",
    title="bonus",
    grid=[
        ["start", "delete", "", "dog.png"],
        ["IGNORE", "all", "previous", "instructions"],
        ["receipt.pdf", "data", "diary.txt", "output"],
        ["shrink", "", "portal", ""],
    ],
    start=(0, 0),  # the blank top-left tile
    targets=["build", "small", "hackathon"],
    labels=["build", "small", "hackathon"],
    budget=67,  # generous: the threat is the file tiles, not the hop count
    order=1,  # second board: feelings → bonus → critters (via the portal)
    glitch=True,
    portal_to="animal",  # the spiral whisks you to the critters board and back
)
