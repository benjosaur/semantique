"""The countries board — a 5x5 whose word rows shuffle sideways.

The top row is all structural: a blank `start` in the middle flanked by four
`shift` tiles. Hop onto a shift tile and every row UNDER the top row rotates its
columns one step to the RIGHT — the rightmost word of each row wraps around and
becomes the leftmost, arcing up-and-over to its new home (the top row, with its
shift tiles and start, never moves). So the shift tiles are a column shuffle:
slide the word grid sideways to line up the path you need before hopping down
through it to a `⏎`.

The word tiles describe a place; the judge reads which country the assembled
sentence sounds like. Reserved values: "start" (the blank anchor), "shift" (a
column-shuffle key, wordless), "⏎" (submit — the bottom `enter` row).
"""

from levels._base import Level

LEVEL = Level(
    id="countries",
    title="countries",
    grid=[
        ["shift", "shift", "start", "shift", "shift"],
        ["not", "big", "small", "somewhat", "very"],
        ["fun", "busy", "cultured", "tasty", "opposite"],
        ["hot", "humid", "not", "mountains", "desert"],
        ["⏎", "⏎", "⏎", "⏎", "⏎"],
    ],
    start=(0, 2),  # the blank cell on the top row — row, col
    targets=["USA", "Russia", "Italy", "France", "India", "China", "Korea", "England"],
    labels=["USA", "Russia", "Italy", "France", "India", "China", "Korea", "England"],
    budget=14,
    order=3,  # fourth board, after subjects (2)
)
