from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from agent_runtime.platform_store import (
    advance_mission,
    create_agent,
    create_mission,
    create_skill,
    get_latest_run,
    get_mission,
    get_snapshot,
    promote_mission_memory,
    run_mission,
    run_quant_flow,
)
from agent_runtime.memory_store import memory_store
from agent_runtime.platform_store import _memory_record_to_platform, get_entity
from agent_runtime.models import QuantState
from agent_runtime.sandbox_executor import StrategySandboxExecutor
from agent_runtime.strategy_lab_store import (
    analyze_strategy_lab_artifact,
    create_strategy_lab_message,
    create_strategy_lab_session,
    get_strategy_lab_message_job,
    get_strategy_lab_session,
    list_strategy_lab_sessions,
    run_strategy_lab_artifact,
    start_strategy_lab_message_job,
    update_strategy_lab_artifact,
)
from agent_runtime.saved_strategy_store import (
    copy_published_strategy,
    get_published_strategy,
    get_saved_strategy,
    list_published_strategies,
    list_saved_strategies,
    save_strategy_from_artifact,
    update_saved_strategy,
)
from agent_runtime.models import StrategySearchQuery
from agent_runtime.strategy_library_store import strategy_library_store


class AgentRuntimeHandler(BaseHTTPRequestHandler):
    server_version = "PaperForgeAgentRuntime/0.1"

    def _set_cors_headers(self):
        """设置 CORS 跨域头"""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")

    def do_OPTIONS(self) -> None:
        """处理 CORS 预检请求"""
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/health":
            self._send_json(
                {
                    "ok": True,
                    "service": "paperforge-python-backend",
                }
            )
            return

        # 记忆相关 API
        if path == "/memories":
            query = urlparse(self.path).query
            scope = None
            if "scope=" in query:
                scope = query.split("scope=")[1].split("&")[0]
            records = memory_store.list_by_scope(scope) if scope else memory_store.list_all()
            self._send_json({"memories": [_memory_record_to_platform(record) for record in records]})
            return

        if path.startswith("/memories/") and not path.endswith("/"):
            memory_id = path.split("/")[2]
            record = memory_store.get(memory_id)
            if not record:
                self._send_json({"error": f"Memory not found: {memory_id}"}, status=404)
                return
            self._send_json({"memory": _memory_record_to_platform(record)})
            return

        # Flow 状态查询 API
        if path.startswith("/flows/") and path.endswith("/state"):
            run_id = path.split("/")[2].replace("/state", "")
            state_data = get_entity("quant_run", run_id)
            if not state_data:
                self._send_json({"error": f"Flow state not found: {run_id}"}, status=404)
                return
            self._send_json({"state": QuantState(**state_data).model_dump()})
            return

        if path == "/platform/snapshot":
            self._send_json(get_snapshot())
            return

        if path == "/strategy-lab/sessions":
            self._send_json({"sessions": list_strategy_lab_sessions()})
            return

        if path.startswith("/strategy-lab/jobs/"):
            job_id = path.split("/")[3]
            job = get_strategy_lab_message_job(job_id)
            if not job:
                self._send_json({"error": f"Strategy Lab job not found: {job_id}"}, status=404)
                return
            self._send_json({"job": job})
            return

        if path.startswith("/strategy-lab/sessions/"):
            session_id = path.split("/")[3]
            detail = get_strategy_lab_session(session_id)
            if not detail:
                self._send_json({"error": f"Strategy Lab session not found: {session_id}"}, status=404)
                return
            self._send_json(detail)
            return

        if path == "/strategies":
            self._send_json({"strategies": list_saved_strategies()})
            return

        if path == "/strategy-library/cards":
            self._send_json({"cards": strategy_library_store.list_cards()})
            return

        if path.startswith("/strategy-library/cards/"):
            card_id = path.split("/")[3]
            detail = strategy_library_store.get_card(card_id)
            if not detail:
                self._send_json({"error": f"Strategy card not found: {card_id}"}, status=404)
                return
            self._send_json(detail)
            return

        if path == "/marketplace":
            self._send_json({"strategies": list_published_strategies()})
            return

        if path.startswith("/marketplace/"):
            strategy_id = path.split("/")[2]
            detail = get_published_strategy(strategy_id)
            if not detail:
                self._send_json({"error": f"Published strategy not found: {strategy_id}"}, status=404)
                return
            self._send_json(detail)
            return

        if path.startswith("/strategies/"):
            strategy_id = path.split("/")[2]
            detail = get_saved_strategy(strategy_id)
            if not detail:
                self._send_json({"error": f"Saved strategy not found: {strategy_id}"}, status=404)
                return
            self._send_json(detail)
            return

        if path.startswith("/missions/") and path.endswith("/latest-run"):
            mission_id = path.split("/")[2]
            self._send_json({"run": get_latest_run(mission_id)})
            return

        if path.startswith("/missions/"):
            mission_id = path.split("/")[2]
            mission = get_mission(mission_id)
            if not mission:
                self._send_json({"error": f"Mission not found: {mission_id}"}, status=404)
                return
            self._send_json({"mission": mission})
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        if path == "/missions":
            try:
                mission = create_mission(self._read_json())
                self._send_json({"mission": mission}, status=201)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        # 记忆操作 API
        if path == "/memories/remember":
            try:
                body = self._read_json()
                record = memory_store.remember(
                    scope=body.get("scope"),
                    title=body.get("title"),
                    summary=body.get("summary"),
                    content=body.get("content"),
                    source_mission_id=body.get("sourceMissionId"),
                    promoted=body.get("promoted", False),
                )
                self._send_json({"memory": _memory_record_to_platform(record)}, status=201)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/memories/recall":
            try:
                body = self._read_json()
                records = memory_store.recall(
                    query=body.get("query"),
                    scope=body.get("scope"),
                    limit=body.get("limit", 10),
                )
                self._send_json({"memories": [_memory_record_to_platform(record) for record in records]})
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/memories/extract":
            try:
                body = self._read_json()
                records = memory_store.extract_memories(
                    long_text=body.get("longText"),
                    scope=body.get("scope"),
                    source_mission_id=body.get("sourceMissionId"),
                )
                self._send_json({"memories": [_memory_record_to_platform(record) for record in records]}, status=201)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/skills":
            try:
                skill = create_skill(self._read_json())
                self._send_json({"skill": skill}, status=201)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/agents":
            try:
                agent = create_agent(self._read_json())
                self._send_json({"agent": agent}, status=201)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/strategy-lab/sessions":
            try:
                session = create_strategy_lab_session(self._read_json())
                detail = get_strategy_lab_session(session["id"])
                self._send_json(detail or {"session": session}, status=201)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/strategies/save":
            try:
                self._send_json(save_strategy_from_artifact(self._read_json()), status=201)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/strategy-library/search":
            try:
                query = StrategySearchQuery.model_validate(self._read_json())
                self._send_json(strategy_library_store.search(query))
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/strategy-library/compare":
            try:
                body = self._read_json()
                self._send_json(
                    strategy_library_store.compare(
                        card_ids=list(body.get("cardIds") or body.get("card_ids") or []),
                        market=str(body.get("market") or ""),
                        timeframe=str(body.get("timeframe") or ""),
                        regime=str(body.get("regime") or ""),
                        trend=str(body.get("trend") or ""),
                        volatility=str(body.get("volatility") or ""),
                        direction=str(body.get("direction") or ""),
                        available_data=list(body.get("availableData") or body.get("available_data") or []),
                        risk_tolerance=str(body.get("riskTolerance") or body.get("risk_tolerance") or ""),
                    )
                )
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path == "/strategy-library/validate-design":
            try:
                body = self._read_json()
                self._send_json(
                    strategy_library_store.validate_design(
                        card_id=str(body.get("cardId") or body.get("card_id") or ""),
                        market=str(body.get("market") or ""),
                        timeframe=str(body.get("timeframe") or ""),
                        regime=str(body.get("regime") or ""),
                        trend=str(body.get("trend") or ""),
                        direction=str(body.get("direction") or ""),
                        available_data=list(body.get("availableData") or body.get("available_data") or []),
                    )
                )
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path.startswith("/marketplace/") and path.endswith("/copy"):
            try:
                strategy_id = path.split("/")[2]
                self._send_json(copy_published_strategy(strategy_id), status=201)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=404)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path.startswith("/strategy-lab/sessions/") and path.endswith("/messages"):
            try:
                session_id = path.split("/")[3]
                detail = create_strategy_lab_message(session_id, self._read_json())
                self._send_json(detail, status=201)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path.startswith("/strategy-lab/sessions/") and path.endswith("/messages/async"):
            try:
                session_id = path.split("/")[3]
                job = start_strategy_lab_message_job(session_id, self._read_json())
                self._send_json({"job": job}, status=202)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path.startswith("/strategy-lab/artifacts/") and path.endswith("/run"):
            try:
                artifact_id = path.split("/")[3]
                result = run_strategy_lab_artifact(artifact_id, self._read_json())
                self._send_json(result, status=200 if result.get("success") else 400)
            except ValueError as error:
                self._send_json({"success": False, "error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"success": False, "error": str(error)}, status=500)
            return

        if path.startswith("/strategy-lab/artifacts/") and path.endswith("/analyze"):
            try:
                artifact_id = path.split("/")[3]
                result = analyze_strategy_lab_artifact(artifact_id)
                self._send_json(result, status=200)
            except ValueError as error:
                self._send_json({"success": False, "error": str(error)}, status=400)
            except Exception as error:
                self._send_json({"success": False, "error": str(error)}, status=500)
            return

        if path == "/sandbox/execute":
            try:
                body = self._read_json()
                strategy_code = str(body.get("strategyCode") or body.get("code") or "")
                if not strategy_code.strip():
                    self._send_json({"success": False, "error": "strategyCode is required", "backtest": None}, status=400)
                    return

                backtest_config = body.get("backtestConfig") or body.get("backtest_config") or {}
                result = StrategySandboxExecutor.execute_strategy(strategy_code, backtest_config)
                self._send_json(result, status=200 if result.get("success") else 400)
            except Exception as error:
                self._send_json({"success": False, "error": str(error), "backtest": None}, status=500)
            return

        if path.startswith("/missions/") and path.endswith("/promote-memory"):
            mission_id = path.split("/")[2]
            try:
                result = promote_mission_memory(mission_id)
                self._send_json(result, status=201)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        # Flow 执行 API
        if path == "/missions/run-flow":
            try:
                body = self._read_json()
                mission_id = body.get("missionId")
                if not mission_id:
                    self._send_json({"error": "missionId is required"}, status=400)
                    return
                result = run_quant_flow(mission_id)
                self._send_json(result, status=201)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path not in {"/missions/run", "/missions/advance"}:
            self._send_json({"error": "Not found"}, status=404)
            return

        try:
            body = self._read_json()
            mission_id = str(body.get("missionId") or body.get("mission_id") or "")
            if not mission_id:
                self._send_json({"error": "missionId is required"}, status=400)
                return
            self._send_json(advance_mission(mission_id) if path == "/missions/advance" else run_mission(mission_id))
        except Exception as error:
            self._send_json({"error": str(error)}, status=500)

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path

        if path.startswith("/strategy-lab/artifacts/"):
            try:
                artifact_id = path.split("/")[3]
                artifact = update_strategy_lab_artifact(artifact_id, self._read_json())
                self._send_json({"artifact": artifact})
            except ValueError as error:
                self._send_json({"error": str(error)}, status=404)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        if path.startswith("/strategies/"):
            try:
                strategy_id = path.split("/")[2]
                strategy = update_saved_strategy(strategy_id, self._read_json())
                self._send_json({"strategy": strategy})
            except ValueError as error:
                self._send_json({"error": str(error)}, status=404)
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path

        if path.startswith("/memories/"):
            memory_id = path.split("/")[2]
            try:
                success = memory_store.delete(memory_id)
                self._send_json({"deleted": success})
            except Exception as error:
                self._send_json({"error": str(error)}, status=500)
            return

        self._send_json({"error": "Not found"}, status=404)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")

    def _read_json(self) -> dict[str, Any]:
        content_length = int(self.headers.get("content-length", "0"))
        if content_length <= 0:
            return {}

        raw = self.rfile.read(content_length)
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._set_cors_headers()
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run_server(host: str = "127.0.0.1", port: int = 8765) -> None:
    server = ThreadingHTTPServer((host, port), AgentRuntimeHandler)
    print(f"PaperForge Python backend listening on http://{host}:{port}")
    server.serve_forever()
