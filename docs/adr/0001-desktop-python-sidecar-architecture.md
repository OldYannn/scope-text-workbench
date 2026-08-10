# ADR 0001: Tauri desktop shell with a Python sidecar

- Status: Accepted for Milestone 0
- Date: 2026-08-10
- Decision owners: SCOPE project maintainers

## Context

SCOPE must provide a cross-platform desktop experience while preserving access to the Python research ecosystem. The application must remain local-first, reproducible, provider-neutral, and maintainable by a small open-source team.

The architecture comparison considered:

1. Tauri 2 with React/TypeScript, a thin Rust host, and a packaged Python sidecar;
2. Electron with React/TypeScript and a packaged Python sidecar;
3. a local FastAPI service with pywebview.

The research engine must remain independent from the user interface. Shipping must not require users to install Python, Node.js, or Rust.

## Decision

Milestone 0 will use:

- React and TypeScript for the user interface;
- Tauri 2 and a thin Rust host for native windows, permissions, approved paths, updates, and sidecar lifecycle;
- a packaged Python sidecar as the sole owner of research algorithms, project storage, SQLite access, result persistence, defaults, and audit records;
- a versioned UTF-8 NDJSON protocol over standard input and standard output;
- project-relative references and hashes instead of large corpus payloads in protocol messages.

Rust and Python must not both write the project database. The Rust host may validate paths and manage processes, but research and project-state behavior belongs to Python.

The local analysis path must work offline. Future online model providers will be optional adapters and will not be part of the local sidecar lifecycle.

## Module boundaries

| Module | Owns | Must not own |
|---|---|---|
| React UI | presentation, user intent, progress display, accessible error messages | research algorithms, SQLite writes, provider secrets |
| Rust host | native capabilities, path approval, sidecar lifecycle, protocol transport | research defaults, research calculations, project database writes |
| Python engine | project state, research methods, parameters, results, provenance | native window behavior, online-provider UI |

## Protocol boundary

The public seam between the desktop application and the Python engine is defined in `docs/architecture/sidecar-protocol.md`. Protocol messages are versioned independently from application releases. Unknown methods, malformed messages, and incompatible versions return structured errors rather than terminating the process silently.

## Packaging rule

Release installers must contain a platform-specific frozen Python executable. Tauri sidecar binary names include the target triple required by the bundler. A successful development run with a system Python does not satisfy the packaging requirement.

Milestone 0 packaging targets are:

- Windows x64;
- macOS arm64;
- macOS x64.

Linux is best-effort during the first public alpha.

## Consequences

Benefits:

- the UI can evolve without changing research implementations;
- Python research dependencies remain behind one process boundary;
- users do not need a Python installation;
- process isolation gives the desktop host an explicit place to handle cancellation and engine failure.

Costs:

- each target needs a frozen Python binary and native packaging validation;
- protocol evolution needs compatibility tests;
- debugging crosses TypeScript, Rust, and Python boundaries;
- code signing, notarization, and antivirus false positives remain release risks.

## Electron fallback conditions

Electron is the documented fallback, not a parallel implementation. Reconsider the host only if a time-boxed Milestone 0 spike demonstrates one or more of the following on required platforms:

- the frozen Python sidecar cannot be packaged or launched reliably;
- code signing or notarization cannot produce an installable artifact;
- WebView differences block required UI behavior without a maintainable workaround;
- the Rust/Tauri toolchain creates a sustained maintenance burden disproportionate to the product.

Any fallback requires a new ADR and project-owner approval. Application branding does not change this architecture decision.

## Development identifiers

Until release identifiers are confirmed, scaffolding may use identifiers explicitly marked as development-only. They must not be published as npm/PyPI packages or treated as stable project-format identifiers. Repository naming is already confirmed as `OldYannn/scope-text-workbench`.
