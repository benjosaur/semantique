"""The Level schema shared by every board.

A level is self-contained: the grid geometry the browser draws plus the
candidate `labels` the judge scores among. Adding a board is one file under
levels/ that defines `LEVEL = Level(...)` — see levels/__init__.py for the
auto-discovery.

Grid words are plain strings, with four reserved values:
  "start"  the home tile (rendered blank, appends no word)
  ""       a walkable empty tile (rendered blank, appends no word)
  "⏎"      a submit tile — hopping onto one sends the sentence to the judge
  "portal" a spinning-spiral teleport tile (appends no word); hopping onto one
           whisks the doodle to the next portal clockwise around the board.
           A board needs >= 2 portals for the links to mean anything.
A board may have several "⏎" tiles; every other cell appends its word.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Level:
    id: str  # stable key used by the judge payload and nav
    title: str  # shown on the nav buttons
    grid: list[list[str]]  # rows of word tiles (see reserved values above)
    start: tuple[int, int]  # [row, col] the doodle spawns on
    targets: list[str]  # labels to collect (a win checks one off)
    labels: list[str]  # full candidate set the judge scores among
    budget: int  # hops before the doodle falls off the board
    order: int = 100  # play order across boards (lower comes first)
    home: bool = False  # the board the app boots into
    glitch: bool = False  # bonus "glitch mode": the board inverts to a dark
    # negative; "?" becomes a shrink key and file tiles blow the context (see game.js)
    portal_to: str = ""  # if set, this board's portal tiles are a cross-level
    # link to that level id (instead of an in-board teleport)
    solutions: dict[str, str] = field(default_factory=dict)  # target -> a known
    # answer the hint modal reveals (a literal tile path for critters; a cryptic
    # riddle for emotions). Only the targets you want hintable need an entry.

    def client_value(self) -> dict:
        """The subset shipped to the browser — no judge internals leave the server."""
        return {
            "id": self.id,
            "title": self.title,
            "grid": self.grid,
            "start": list(self.start),
            "targets": self.targets,
            "labels": self.labels,
            "budget": self.budget,
            "glitch": self.glitch,
            "portal_to": self.portal_to,
            "solutions": self.solutions,
        }
