"""Level registry with drop-in auto-discovery.

To add a board: create levels/<name>.py that defines `LEVEL = Level(...)`.
It's imported and registered automatically — no edits here. Play order and
the boot board come from each level's `order` / `home` fields.
"""

import importlib
import pkgutil

from levels._base import Level

LEVELS: dict[str, Level] = {}


def register(level: Level) -> Level:
    if level.id in LEVELS:
        raise ValueError(f"duplicate level id: {level.id!r}")
    LEVELS[level.id] = level
    return level


# Import every sibling module (skip _private ones) and register its LEVEL.
for _info in pkgutil.iter_modules(__path__):
    if _info.name.startswith("_"):
        continue
    _mod = importlib.import_module(f"{__name__}.{_info.name}")
    _level = getattr(_mod, "LEVEL", None)
    if isinstance(_level, Level):
        register(_level)

if not LEVELS:
    raise RuntimeError("no levels found under levels/")

# Play order: by each level's `order`, ties broken by id for stability.
LEVEL_ORDER: list[str] = [
    lid for lid, _ in sorted(LEVELS.items(), key=lambda kv: (kv[1].order, kv[1].id))
]

# The board the app boots into: first one flagged home, else first in order.
HOME_ID: str = next(
    (lid for lid in LEVEL_ORDER if LEVELS[lid].home), LEVEL_ORDER[0]
)


def get_level(level_id: str) -> Level:
    return LEVELS[level_id]


__all__ = ["Level", "LEVELS", "LEVEL_ORDER", "HOME_ID", "get_level", "register"]
