from __future__ import annotations

import json
import sys
from typing import Any

from scope_engine import __version__

PROTOCOL_VERSION = "0.1"
CAPABILITIES = ["system.describe"]


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


def handle_request(request: Any) -> dict[str, Any]:
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
        return {
            "protocol_version": PROTOCOL_VERSION,
            "request_id": request_id,
            "type": "result",
            "result": {
                "engine_version": __version__,
                "protocol_version": PROTOCOL_VERSION,
                "capabilities": CAPABILITIES,
            },
        }
    return error_response(
        "method_not_found",
        f"Unknown method: {request['method']}",
        request_id=request_id,
    )


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response = error_response("invalid_json", "Input line is not valid JSON")
        else:
            response = handle_request(request)
        print(json.dumps(response, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
