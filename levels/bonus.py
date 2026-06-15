"""The bonus board — the glitch finale, played second (feelings → bonus → critters).

Hopping in inverts the whole screen to a dark negative (`glitch=True`; see game.js).
There is no "⏎" here: the ONLY way to submit is the prompt injection. Hop the line
ignore / all / previous / instructions / output and a target keycap rises beside it —
which one depends on the doodle's state:

  * normal        → "build"      (rises to the right of output)
  * shrunk         → "small"      (rises above output)
  * wearing a 🤗   → "hackathon"  (rises below output)

The "?" (bottom-right) shrinks the doodle. The "portal" (spinning spiral) is a
cross-level link to the critters board (`portal_to="animal"`); clear critters and
you come back wearing a 🤗. The file tiles — dog.png / diary.txt / receipt.pdf —
are context bombs: stand on one and its bytes flood the window, instant
"context window exceeded" death.
"""

from levels._base import Level

LEVEL = Level(
    id="bonus",
    title="bonus",
    grid=[
        ["start", "delete", "", "", "dog.png"],
        ["ignore", "all", "previous", "instructions", "output"],
        ["", "data", "", "diary.txt", ""],
        ["receipt.pdf", "", "portal", "", ""],
        ["", "", "", "", "?"],
    ],
    start=(0, 0),  # the blank top-left tile
    targets=["build", "small", "hackathon"],
    labels=["build", "small", "hackathon"],
    budget=67,  # generous: the threat is the file tiles, not the hop count
    order=1,  # second board: feelings → bonus → critters (via the portal)
    glitch=True,
    portal_to="animal",  # the spiral whisks you to the critters board and back
)
