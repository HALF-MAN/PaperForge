from __future__ import annotations

import argparse
import json
import sys

from agent_runtime.env import load_dotenv
from agent_runtime.models import MissionInput
from agent_runtime.server import run_server
from agent_runtime.workflows import run_quant_mission

# Load project .env.local before anything else
load_dotenv()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the PaperForge Python agent runtime.")
    parser.add_argument("--mission-id", default="mission-python-demo")
    parser.add_argument("--title", default="Evaluate BTC EMA strategy")
    parser.add_argument(
        "--objective",
        default="Evaluate BTC 1h EMA20/EMA60 strategy for paper deployment.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    parser.add_argument("--serve", action="store_true", help="Start the HTTP backend service.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    if args.serve:
        run_server(args.host, args.port)
        return 0

    result = run_quant_mission(
        MissionInput(
            mission_id=args.mission_id,
            title=args.title,
            objective=args.objective,
        )
    )

    json.dump(
        result.to_dict(),
        sys.stdout,
        ensure_ascii=False,
        indent=2 if args.pretty else None,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
