# SCOPE research engine (development package)

This directory contains the local Python sidecar. The package and distribution names are development-only placeholders and must not be published before the technical identifiers and License are approved.

Run the contract tests from the repository root:

```shell
python3 -m unittest discover -s engine/tests -v
```

Run the development engine with:

```shell
PYTHONPATH=engine/src python3 -m scope_engine
```
