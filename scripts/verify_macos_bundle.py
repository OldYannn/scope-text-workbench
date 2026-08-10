from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from verify_sidecar import verify


def verify_bundle(app_path: Path) -> None:
    macos_directory = app_path / "Contents/MacOS"
    host_path = macos_directory / "scope-desktop-dev"
    sidecar_path = macos_directory / "scope-engine-dev"
    for executable in (host_path, sidecar_path):
        if not executable.is_file():
            raise FileNotFoundError(
                f"Expected bundled executable does not exist: {executable}"
            )

    verify(sidecar_path)
    subprocess.run(
        ["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app_path)],
        capture_output=True,
        check=True,
        text=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify the packaged macOS SCOPE app")
    parser.add_argument("app", type=Path)
    arguments = parser.parse_args()
    verify_bundle(arguments.app.resolve())
    print(f"macOS app bundle verified: {arguments.app}")


if __name__ == "__main__":
    main()
