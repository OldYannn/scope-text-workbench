from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]


def invoke_engine(line: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    source_path = str(ENGINE_ROOT / "src")
    existing_pythonpath = environment.get("PYTHONPATH")
    if existing_pythonpath:
        environment["PYTHONPATH"] = f"{source_path}{os.pathsep}{existing_pythonpath}"
    else:
        environment["PYTHONPATH"] = source_path
    return subprocess.run(
        [sys.executable, "-m", "scope_engine"],
        input=f"{line}\n",
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )


class SidecarProtocolContractTest(unittest.TestCase):
    def test_system_describe_reports_protocol_and_capability(self) -> None:
        request = {
            "protocol_version": "0.1",
            "request_id": "describe-1",
            "method": "system.describe",
            "params": {},
        }

        completed = invoke_engine(json.dumps(request))

        self.assertEqual(completed.returncode, 0, completed.stderr)
        response = json.loads(completed.stdout)
        self.assertEqual(
            response,
            {
                "protocol_version": "0.1",
                "request_id": "describe-1",
                "type": "result",
                "result": {
                    "engine_version": "0.0.0",
                    "protocol_version": "0.1",
                    "capabilities": ["system.describe"],
                },
            },
        )

    def test_invalid_json_returns_structured_error(self) -> None:
        completed = invoke_engine("not-json")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        response = json.loads(completed.stdout)
        self.assertEqual(
            response,
            {
                "protocol_version": "0.1",
                "request_id": None,
                "type": "error",
                "error": {
                    "code": "invalid_json",
                    "message": "Input line is not valid JSON",
                    "details": {},
                },
            },
        )

    def test_incompatible_protocol_returns_structured_error(self) -> None:
        request = {
            "protocol_version": "9.9",
            "request_id": "version-1",
            "method": "system.describe",
            "params": {},
        }

        completed = invoke_engine(json.dumps(request))

        self.assertEqual(completed.returncode, 0, completed.stderr)
        response = json.loads(completed.stdout)
        self.assertEqual(response["request_id"], "version-1")
        self.assertEqual(response["type"], "error")
        self.assertEqual(response["error"]["code"], "incompatible_protocol")
        self.assertEqual(response["error"]["details"], {"supported": "0.1"})

    def test_unknown_method_returns_structured_error(self) -> None:
        request = {
            "protocol_version": "0.1",
            "request_id": "unknown-1",
            "method": "example.unknown",
            "params": {},
        }

        completed = invoke_engine(json.dumps(request))

        self.assertEqual(completed.returncode, 0, completed.stderr)
        response = json.loads(completed.stdout)
        self.assertEqual(response["request_id"], "unknown-1")
        self.assertEqual(response["type"], "error")
        self.assertEqual(response["error"]["code"], "method_not_found")

    def test_invalid_request_envelopes_return_structured_errors(self) -> None:
        invalid_requests = [
            [],
            {"protocol_version": "0.1", "request_id": "missing-method", "params": {}},
            {
                "protocol_version": "0.1",
                "request_id": "invalid-params",
                "method": "system.describe",
                "params": [],
            },
            {
                "protocol_version": "0.1",
                "request_id": "",
                "method": "system.describe",
                "params": {},
            },
        ]

        for request in invalid_requests:
            with self.subTest(request=request):
                completed = invoke_engine(json.dumps(request))
                self.assertEqual(completed.returncode, 0, completed.stderr)
                response = json.loads(completed.stdout)
                self.assertEqual(response["type"], "error")
                self.assertEqual(response["error"]["code"], "invalid_request")


if __name__ == "__main__":
    unittest.main()
