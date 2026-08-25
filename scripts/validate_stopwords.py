"""Run the local-only SCOPE draft stopword validation harness."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "engine" / "src"))

from scope_engine.stopword_validation import ValidationError, run_validation


def main() -> int:
    parser = argparse.ArgumentParser(
        description="运行 SCOPE 中文通用 v1 Draft 停用词验证 Harness"
    )
    parser.add_argument(
        "--config", required=True, help="本地 validation config JSON 路径"
    )
    arguments = parser.parse_args()
    try:
        result = run_validation(arguments.config)
    except ValidationError as error:
        print(f"验证未运行：{error}", file=sys.stderr)
        return 2
    print("验证 Harness 已完成；可开始人工方法复核。")
    print(f"输出目录：{result['output_path']}")
    print(f"Run ID：{result['run_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
