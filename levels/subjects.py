"""The subjects board — a 5x5 with two [wings] tiles that let the doodle fly.

Hop onto a wings tile and the doodle sprouts wings and lifts off: the next two
hops glide free (no word, no budget) while it flaps across the board, and on the
third it descends to land — usually onto a ⏎ to press submit. So wings are a
clean exit: lock in the sentence you've written, then soar over the rest of the
keys to the button without typing them.

The word tiles describe a field of study; the judge reads which subject the
assembled sentence sounds like. Reserved values: "start" (the blank anchor),
"wings" (a flight launchpad, wordless), "⏎" (submit — the two `enter` keys).
"""

from levels._base import Level

LEVEL = Level(
    id="subjects",
    title="subjects",
    grid=[
        ["almost", "flower", "wordy", "slightly", "traumatic"],
        ["?", "dry", "wings", "but", "dialogue"],
        ["⏎", "chaotic", "rigorous", "start", "fun"],
        ["create", "easy", "spicy", "time", "⏎"],
        ["extremely", "wings", "not", "money", "!"],
    ],
    start=(2, 3),  # the blank cell — row, col
    targets=["maths", "science", "philosophy", "economics", "literature", "languages", "art", "music"],
    labels=["maths", "science", "philosophy", "economics", "literature", "languages", "art", "music"],
    budget=12,
    order=2,  # third board, after emotion (0) and animal (1)
)
