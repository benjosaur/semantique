"""The Level schema shared by every board.

A level is self-contained: the grid geometry the browser draws plus the
candidate `labels` the judge scores among. Adding a board is one file under
levels/ that defines `LEVEL = Level(...)` — see levels/__init__.py for the
auto-discovery.

Grid words are plain strings, with three reserved values:
  "start"  the home tile (rendered blank, appends no word)
  ""       a walkable empty tile (rendered blank, appends no word)
  "⏎"      a submit tile — hopping onto one sends the sentence to the judge
A board may have several "⏎" tiles; every other cell appends its word.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Level:
    id: str  # stable key used by the judge payload and nav
    title: str  # shown on the nav buttons
    grid: list[list[str]]  # rows of word tiles (see reserved values above)
    start: tuple[int, int]  # [row, col] the doodle spawns on
    targets: list[str]  # labels to collect (a win checks one off)
    labels: list[str]  # full candidate set the judge scores among
    budget: int  # hops before the doodle falls off the board
    # Few-shot (sentence, label) pairs prepended to the judge prompt to calibrate
    # its read of this board. Judge-only — never shipped to the client (no spoilers).
    examples: tuple[tuple[str, str], ...] = ()
    order: int = 100  # play order across boards (lower comes first)
    home: bool = False  # the board the app boots into

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
        }
