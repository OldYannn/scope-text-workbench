from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import unittest
from pathlib import Path
from typing import Any, TextIO

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


class EngineProcess:
    def __init__(self) -> None:
        environment = os.environ.copy()
        source_path = str(ENGINE_ROOT / "src")
        existing_pythonpath = environment.get("PYTHONPATH")
        environment["PYTHONPATH"] = (
            f"{source_path}{os.pathsep}{existing_pythonpath}"
            if existing_pythonpath
            else source_path
        )
        self.process = subprocess.Popen(
            [sys.executable, "-u", "-m", "scope_engine"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            text=True,
        )
        self.output: queue.Queue[str] = queue.Queue()
        assert self.process.stdout is not None
        self.reader = threading.Thread(
            target=self._read_stdout,
            args=(self.process.stdout,),
            daemon=True,
        )
        self.reader.start()

    def _read_stdout(self, stdout: TextIO) -> None:
        for line in stdout:
            self.output.put(line)

    def __enter__(self) -> EngineProcess:
        return self

    def __exit__(self, *_: object) -> None:
        if self.process.stdin:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=2)
        if self.process.stdout:
            self.process.stdout.close()
        if self.process.stderr:
            self.process.stderr.close()

    def send(self, request: dict[str, Any]) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()

    def read(self) -> dict[str, Any]:
        try:
            line = self.output.get(timeout=2)
        except queue.Empty:
            raise AssertionError(
                f"Engine did not respond; return code: {self.process.poll()}"
            ) from None
        return json.loads(line)


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
                    "capabilities": [
                        "diagnostic.crash",
                        "diagnostic.run",
                        "request.cancel",
                        "system.describe",
                    ],
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

    def test_diagnostic_run_emits_progress_and_reproducibility_manifest(self) -> None:
        request = {
            "protocol_version": "0.1",
            "request_id": "diagnostic-1",
            "method": "diagnostic.run",
            "params": {"steps": 3, "delay_ms": 0},
        }

        with EngineProcess() as engine:
            engine.send(request)
            responses = [engine.read() for _ in range(4)]

        self.assertEqual(
            [
                (response["type"], response.get("progress", {}).get("current"))
                for response in responses
            ],
            [("progress", 1), ("progress", 2), ("progress", 3), ("result", None)],
        )
        self.assertEqual(
            responses[-1]["result"],
            {
                "completed_steps": 3,
                "reproducibility_manifest": {
                    "operation": "diagnostic.run",
                    "operation_version": "1",
                    "parameters": {"steps": 3, "delay_ms": 0},
                    "software": {
                        "engine_version": "0.0.0",
                        "protocol_version": "0.1",
                    },
                    "random_seed": None,
                    "input_hashes": [],
                    "network_used": False,
                },
            },
        )

    def test_running_diagnostic_can_be_cancelled(self) -> None:
        run_request = {
            "protocol_version": "0.1",
            "request_id": "diagnostic-cancel-target",
            "method": "diagnostic.run",
            "params": {"steps": 5, "delay_ms": 200},
        }
        cancel_request = {
            "protocol_version": "0.1",
            "request_id": "cancel-1",
            "method": "request.cancel",
            "params": {"target_request_id": "diagnostic-cancel-target"},
        }

        with EngineProcess() as engine:
            engine.send(run_request)
            first_progress = engine.read()
            engine.send(cancel_request)
            terminal_responses = [engine.read(), engine.read()]

        self.assertEqual(first_progress["type"], "progress")
        by_request_id = {response["request_id"]: response for response in terminal_responses}
        self.assertEqual(
            by_request_id["cancel-1"]["result"],
            {"target_request_id": "diagnostic-cancel-target", "accepted": True},
        )
        self.assertEqual(by_request_id["diagnostic-cancel-target"]["type"], "error")
        self.assertEqual(by_request_id["diagnostic-cancel-target"]["error"]["code"], "cancelled")

    def test_diagnostic_crash_exits_process_without_terminal_message(self) -> None:
        request = {
            "protocol_version": "0.1",
            "request_id": "crash-1",
            "method": "diagnostic.crash",
            "params": {},
        }

        with EngineProcess() as engine:
            engine.send(request)
            return_code = engine.process.wait(timeout=2)

        self.assertEqual(return_code, 70)
        self.assertTrue(engine.output.empty())


if __name__ == "__main__":
    unittest.main()
