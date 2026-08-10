from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from build_sidecar import REPOSITORY_ROOT, rust_target_triple


def request(request_id: str, method: str, params: dict[str, Any]) -> str:
    return json.dumps(
        {
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": method,
            "params": params,
        },
        separators=(",", ":"),
    )


def verify(sidecar_path: Path) -> None:
    if not sidecar_path.is_file():
        raise FileNotFoundError(f"Frozen sidecar does not exist: {sidecar_path}")

    environment = os.environ.copy()
    environment.pop("PYTHONHOME", None)
    environment.pop("PYTHONPATH", None)
    environment["PATH"] = ""
    input_lines = [
        request("frozen-describe", "system.describe", {}),
        request("frozen-diagnostic", "diagnostic.run", {"steps": 2, "delay_ms": 0}),
    ]
    completed = subprocess.run(
        [str(sidecar_path)],
        input="\n".join(input_lines) + "\n",
        capture_output=True,
        check=False,
        env=environment,
        text=True,
        timeout=20,
    )
    if completed.returncode != 0:
        raise AssertionError(
            f"Frozen sidecar exited with {completed.returncode}: {completed.stderr}"
        )

    messages = [json.loads(line) for line in completed.stdout.splitlines() if line]
    describe = [
        message for message in messages if message["request_id"] == "frozen-describe"
    ]
    diagnostic = [
        message for message in messages if message["request_id"] == "frozen-diagnostic"
    ]
    if describe != [
        {
            "protocol_version": "0.1",
            "request_id": "frozen-describe",
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
        }
    ]:
        raise AssertionError(f"Unexpected system.describe output: {describe}")

    progress = [
        message["progress"]["current"]
        for message in diagnostic
        if message["type"] == "progress"
    ]
    terminal = [message for message in diagnostic if message["type"] == "result"]
    if progress != [1, 2]:
        raise AssertionError(f"Unexpected progress sequence: {progress}")
    if len(terminal) != 1:
        raise AssertionError(f"Expected one diagnostic result: {terminal}")
    manifest = terminal[0]["result"]["reproducibility_manifest"]
    if manifest["parameters"] != {"steps": 2, "delay_ms": 0}:
        raise AssertionError(f"Unexpected frozen parameters: {manifest['parameters']}")
    if manifest["network_used"] is not False:
        raise AssertionError("Frozen diagnostic unexpectedly reported network use")

    crashed = subprocess.run(
        [str(sidecar_path)],
        input=request("frozen-crash", "diagnostic.crash", {}) + "\n",
        capture_output=True,
        check=False,
        env=environment,
        text=True,
        timeout=20,
    )
    if crashed.returncode == 0:
        raise AssertionError("Frozen diagnostic crash unexpectedly exited successfully")


def default_sidecar_path() -> Path:
    executable_suffix = ".exe" if os.name == "nt" else ""
    return (
        REPOSITORY_ROOT
        / "apps/desktop/src-tauri/binaries"
        / f"scope-engine-dev-{rust_target_triple()}{executable_suffix}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify the frozen SCOPE sidecar contract"
    )
    parser.add_argument("sidecar", nargs="?", type=Path, default=default_sidecar_path())
    arguments = parser.parse_args()
    verify(arguments.sidecar.resolve())
    print(f"Frozen sidecar verified: {arguments.sidecar}")


if __name__ == "__main__":
    main()
