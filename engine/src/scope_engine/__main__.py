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
ACTIVE_TASKS_LOCK = threading.Lock()
ACTIVE_TASKS: dict[str, threading.Event] = {}


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
                emit(
                    error_response(
                        "cancelled",
                        "Request was cancelled",
                        request_id=request_id,
                    )
                )
                return
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
    finally:
        with ACTIVE_TASKS_LOCK:
            ACTIVE_TASKS.pop(request_id, None)


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
        cancel_event = threading.Event()
        with ACTIVE_TASKS_LOCK:
            if request_id in ACTIVE_TASKS:
                return error_response(
                    "request_id_in_use",
                    "request_id is already running",
                    request_id=request_id,
                )
            ACTIVE_TASKS[request_id] = cancel_event
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
        with ACTIVE_TASKS_LOCK:
            target_cancel_event = ACTIVE_TASKS.get(target_request_id)
            if target_cancel_event is not None:
                target_cancel_event.set()
        return result_response(
            request_id,
            {
                "target_request_id": target_request_id,
                "accepted": target_cancel_event is not None,
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
