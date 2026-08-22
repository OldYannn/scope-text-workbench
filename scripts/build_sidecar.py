from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def rust_target_triple() -> str:
    host_tuple = subprocess.run(
        ["rustc", "--print", "host-tuple"],
        capture_output=True,
        check=False,
        text=True,
    )
    if host_tuple.returncode == 0 and host_tuple.stdout.strip():
        return host_tuple.stdout.strip()

    verbose_version = subprocess.run(
        ["rustc", "-vV"],
        capture_output=True,
        check=True,
        text=True,
    )
    for line in verbose_version.stdout.splitlines():
        if line.startswith("host: "):
            return line.removeprefix("host: ").strip()
    raise RuntimeError("rustc did not report a host target triple")


def build(expected_target: str | None = None) -> Path:
    target_triple = rust_target_triple()
    if expected_target is not None and target_triple != expected_target:
        raise RuntimeError(
            f"Runner target mismatch: expected {expected_target}, rustc reported {target_triple}"
        )
    executable_suffix = ".exe" if os.name == "nt" else ""
    binary_name = f"scope-engine-dev-{target_triple}"
    binaries_directory = REPOSITORY_ROOT / "apps/desktop/src-tauri/binaries"
    build_directory = REPOSITORY_ROOT / "build/sidecar" / target_triple
    binaries_directory.mkdir(parents=True, exist_ok=True)
    build_directory.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--clean",
            "--noconfirm",
            "--onefile",
            "--noupx",
            "--name",
            binary_name,
            "--distpath",
            str(binaries_directory),
            "--workpath",
            str(build_directory / "work"),
            "--specpath",
            str(build_directory / "spec"),
            "--paths",
            str(REPOSITORY_ROOT / "engine/src"),
            "--add-data",
            f"{REPOSITORY_ROOT / 'engine/src/scope_engine/resources/stopwords'}{os.pathsep}scope_engine/resources/stopwords",
            str(REPOSITORY_ROOT / "engine/packaging/sidecar_entry.py"),
        ],
        check=True,
        cwd=REPOSITORY_ROOT,
    )
    output = binaries_directory / f"{binary_name}{executable_suffix}"
    if not output.is_file():
        raise FileNotFoundError(f"PyInstaller did not create {output}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Freeze the SCOPE Python sidecar")
    parser.add_argument("--expected-target")
    arguments = parser.parse_args()
    output = build(arguments.expected_target)
    print(output)


if __name__ == "__main__":
    main()
