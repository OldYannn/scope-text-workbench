from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any

from scope_engine import __version__

PROTOCOL_VERSION = "0.1"
CAPABILITIES = [
    "diagnostic.crash",
    "diagnostic.run",
    "request.cancel",
    "system.describe",
]
OUTPUT_LOCK = threading.Lock()


class TaskRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tasks: dict[str, threading.Event] = {}

    def start(self, request_id: str) -> threading.Event | None:
        with self._lock:
            if request_id in self._tasks:
                return None
            cancel_event = threading.Event()
            self._tasks[request_id] = cancel_event
            return cancel_event

    def cancel(self, request_id: str) -> bool:
        with self._lock:
            cancel_event = self._tasks.get(request_id)
            if cancel_event is None:
                return False
            cancel_event.set()
            return True

    def finish(self, request_id: str, cancel_event: threading.Event) -> bool:
        with self._lock:
            if self._tasks.get(request_id) is cancel_event:
                self._tasks.pop(request_id)
            return cancel_event.is_set()

    def discard(self, request_id: str, cancel_event: threading.Event) -> None:
        with self._lock:
            if self._tasks.get(request_id) is cancel_event:
                self._tasks.pop(request_id)


ACTIVE_TASKS = TaskRegistry()


def error_response(
    code: str,
    message: str,
    *,
    request_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request_id,
        "type": "error",
        "error": {"code": code, "message": message, "details": details or {}},
    }


def validate_request(request: Any) -> dict[str, Any] | None:
    if not isinstance(request, dict):
        return error_response("invalid_request", "Request must be a JSON object")

    request_id = request.get("request_id")
    recoverable_request_id = request_id if isinstance(request_id, str) and request_id else None
    required_strings = ("protocol_version", "request_id", "method")
    required_values = (request.get(field) for field in required_strings)
    has_invalid_string = any(not isinstance(value, str) or not value for value in required_values)
    if has_invalid_string:
        return error_response(
            "invalid_request",
            "protocol_version, request_id, and method must be non-empty strings",
            request_id=recoverable_request_id,
        )
    if not isinstance(request.get("params"), dict):
        return error_response(
            "invalid_request",
            "params must be a JSON object",
            request_id=recoverable_request_id,
        )
    return None


def emit(response: dict[str, Any]) -> None:
    with OUTPUT_LOCK:
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")), flush=True)


def result_response(request_id: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request_id,
        "type": "result",
        "result": result,
    }


def validate_diagnostic_params(request_id: str, params: dict[str, Any]) -> dict[str, Any] | None:
    steps = params.get("steps")
    delay_ms = params.get("delay_ms")
    if (
        isinstance(steps, bool)
        or not isinstance(steps, int)
        or not 1 <= steps <= 20
        or isinstance(delay_ms, bool)
        or not isinstance(delay_ms, int)
        or not 0 <= delay_ms <= 1000
        or set(params) != {"steps", "delay_ms"}
    ):
        return error_response(
            "invalid_params",
            "diagnostic.run requires steps (1-20) and delay_ms (0-1000)",
            request_id=request_id,
        )
    return None


def run_diagnostic(
    request_id: str,
    steps: int,
    delay_ms: int,
    cancel_event: threading.Event,
) -> None:
    try:
        for current in range(1, steps + 1):
            if cancel_event.wait(delay_ms / 1000):
                break
            emit(
                {
                    "protocol_version": PROTOCOL_VERSION,
                    "request_id": request_id,
                    "type": "progress",
                    "progress": {
                        "current": current,
                        "total": steps,
                        "message": f"Diagnostic step {current} of {steps}",
                    },
                }
            )
        cancelled = ACTIVE_TASKS.finish(request_id, cancel_event)
        if cancelled:
            emit(
                error_response(
                    "cancelled",
                    "Request was cancelled",
                    request_id=request_id,
                )
            )
        else:
            emit(
                result_response(
                    request_id,
                    {
                        "completed_steps": steps,
                        "reproducibility_manifest": {
                            "operation": "diagnostic.run",
                            "operation_version": "1",
                            "parameters": {"steps": steps, "delay_ms": delay_ms},
                            "software": {
                                "engine_version": __version__,
                                "protocol_version": PROTOCOL_VERSION,
                            },
                            "random_seed": None,
                            "input_hashes": [],
                            "network_used": False,
                        },
                    },
                )
            )
    except Exception:
        ACTIVE_TASKS.discard(request_id, cancel_event)
        try:
            emit(
                error_response(
                    "internal_error",
                    "Diagnostic worker failed unexpectedly",
                    request_id=request_id,
                )
            )
        except Exception:
            os._exit(71)


def handle_request(request: Any) -> dict[str, Any] | None:
    validation_error = validate_request(request)
    if validation_error is not None:
        return validation_error

    request_id = request["request_id"]
    if request["protocol_version"] != PROTOCOL_VERSION:
        return error_response(
            "incompatible_protocol",
            f"Unsupported protocol version: {request['protocol_version']}",
            request_id=request_id,
            details={"supported": PROTOCOL_VERSION},
        )
    if request["method"] == "system.describe":
        return result_response(
            request_id,
            {
                "engine_version": __version__,
                "protocol_version": PROTOCOL_VERSION,
                "capabilities": CAPABILITIES,
            },
        )
    if request["method"] == "diagnostic.run":
        params_error = validate_diagnostic_params(request_id, request["params"])
        if params_error is not None:
            return params_error
        cancel_event = ACTIVE_TASKS.start(request_id)
        if cancel_event is None:
            return error_response(
                "request_id_in_use",
                "request_id is already running",
                request_id=request_id,
            )
        threading.Thread(
            target=run_diagnostic,
            args=(
                request_id,
                request["params"]["steps"],
                request["params"]["delay_ms"],
                cancel_event,
            ),
        ).start()
        return None
    if request["method"] == "request.cancel":
        params = request["params"]
        target_request_id = params.get("target_request_id")
        if (
            not isinstance(target_request_id, str)
            or not target_request_id
            or set(params) != {"target_request_id"}
        ):
            return error_response(
                "invalid_params",
                "request.cancel requires a non-empty target_request_id",
                request_id=request_id,
            )
        accepted = ACTIVE_TASKS.cancel(target_request_id)
        return result_response(
            request_id,
            {
                "target_request_id": target_request_id,
                "accepted": accepted,
            },
        )
    if request["method"] == "diagnostic.crash":
        if request["params"]:
            return error_response(
                "invalid_params",
                "diagnostic.crash does not accept parameters",
                request_id=request_id,
            )
        os._exit(70)
    return error_response(
        "method_not_found",
        f"Unknown method: {request['method']}",
        request_id=request_id,
    )


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        response: dict[str, Any] | None
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response = error_response("invalid_json", "Input line is not valid JSON")
        else:
            response = handle_request(request)
        if response is not None:
            emit(response)


if __name__ == "__main__":
    main()
