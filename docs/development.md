# Development setup

SCOPE is a Pre-alpha project. The current scaffold validates the desktop boundary only and must not be used to produce research conclusions.

## Prerequisites

- Node.js 24;
- Python 3.11 or newer (CI currently uses Python 3.12);
- the stable Rust toolchain with `rustfmt` and `clippy`;
- Tauri 2 platform prerequisites for macOS or Windows.

End users will not need these tools. Release installers must eventually include the compiled frontend, Rust host, and frozen Python sidecar.

## Install dependencies

From the repository root:

```shell
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -e "engine[dev]"
```

On Windows, activate the virtual environment and use its `python` executable instead of `.venv/bin/python`.

## Quality checks

```shell
npm run check
npm run lint
npm run format:check
npm run build

.venv/bin/ruff check engine
.venv/bin/ruff format --check engine
.venv/bin/mypy engine/src engine/tests
.venv/bin/python -m unittest discover -s engine/tests -v

cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Run the development shell

```shell
npm run tauri -- dev
```

The browser-only frontend can be inspected with:

```shell
npm run dev --workspace @scope-workbench/desktop-dev
```

## Build the native shell without an installer

```shell
npm run tauri -- build --no-bundle
```

This command validates the current native shell but does not yet satisfy Milestone 0 packaging requirements. The frozen Python sidecar, signing, installers, and required architecture matrix remain outstanding.

## Development-only identifiers

The npm workspace package, Python distribution, Rust crate, and Tauri Bundle ID currently contain `dev` or are otherwise documented as development placeholders. Do not publish them to a package registry or use them for a public release.

The generated Tauri application icons are also temporary development assets. They must be replaced with approved SCOPE brand assets before any public build.
