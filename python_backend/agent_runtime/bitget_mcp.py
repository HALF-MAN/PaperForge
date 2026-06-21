from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from agent_framework import MCPStdioTool


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SERVER_COMMAND = REPOSITORY_ROOT / "node_modules" / ".bin" / "bitget-mcp-server"

# Public, read-only exchange evidence used by the research agent. Private account
# reads remain excluded even though the server's --read-only mode exposes them.
BITGET_RESEARCH_TOOLS = (
    "spot_get_ticker",
    "spot_get_depth",
    "spot_get_candles",
    "spot_get_trades",
    "spot_get_symbols",
    "futures_get_ticker",
    "futures_get_depth",
    "futures_get_candles",
    "futures_get_trades",
    "futures_get_contracts",
    "futures_get_funding_rate",
    "futures_get_open_interest",
    "system_get_capabilities",
)


def _parse_bitget_result(result: Any) -> str:
    """Prefer one structured payload over duplicate text and structured results."""

    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        return json.dumps(structured, ensure_ascii=False)

    text_parts = [
        str(content.text)
        for content in getattr(result, "content", [])
        if getattr(content, "text", None) is not None
    ]
    return "\n".join(text_parts)


def create_bitget_research_mcp() -> MCPStdioTool:
    """Create the read-only Bitget MCP connection used during one agent turn."""

    configured_command = os.getenv("BITGET_MCP_COMMAND", "").strip()
    command = configured_command or str(DEFAULT_SERVER_COMMAND)
    if not configured_command and not DEFAULT_SERVER_COMMAND.exists():
        command = "npx"
        args = [
            "-y",
            "bitget-mcp-server",
            "--modules",
            "spot,futures",
            "--read-only",
        ]
    else:
        args = ["--modules", "spot,futures", "--read-only"]

    return MCPStdioTool(
        name="bitget_research",
        command=command,
        args=args,
        description="Read-only Bitget spot and futures market research tools.",
        allowed_tools=BITGET_RESEARCH_TOOLS,
        approval_mode="never_require",
        parse_tool_results=_parse_bitget_result,
        load_prompts=False,
        request_timeout=20,
    )
