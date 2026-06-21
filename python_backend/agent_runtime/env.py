from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]  # project root


def load_dotenv(dotenv_path: str | Path | None = None) -> dict[str, str]:
    """Load a .env / .env.local file into os.environ.

    This is a lightweight alternative to python-dotenv. It reads
    ``KEY=VALUE`` lines, skips comments (``#``) and blank lines, and
    trims surrounding whitespace.  Values containing ``#`` must be
    quoted with ``"`` or ``'``.
    """
    if dotenv_path is None:
        dotenv_path = ROOT_DIR / ".env.local"

    dotenv_path = Path(dotenv_path)
    if not dotenv_path.is_file():
        return {}

    loaded: dict[str, str] = {}
    text = dotenv_path.read_text(encoding="utf-8")

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, _, raw_value = line.partition("=")
        key = key.strip()
        if not key:
            continue

        value = _unquote(raw_value.strip())
        # Only set if not already present in the real environment
        if key not in os.environ:
            os.environ[key] = value
            loaded[key] = value

    return loaded


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value
