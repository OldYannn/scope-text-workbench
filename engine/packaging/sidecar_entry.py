from __future__ import annotations

import argparse

from scope_engine.__main__ import main as protocol_main
from scope_engine.stopword_validation import ValidationError, run_validation

if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--stopword-validation-config")
    arguments, _unknown = parser.parse_known_args()
    if arguments.stopword_validation_config:
        try:
            run_validation(arguments.stopword_validation_config)
        except ValidationError as error:
            raise SystemExit(f"验证未运行：{error}") from error
    else:
        protocol_main()
